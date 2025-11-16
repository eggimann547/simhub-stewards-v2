// api/analyze-intranet.js
import { z } from 'zod';
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';

const schema = z.object({ url: z.string().url() });

export async function POST(req) {
  try {
    const { url } = schema.parse(await req.json());

    // 1. Get YouTube title
    const videoId = url.match(/(?:v=|\/embed\/|\/watch\?v=|\/shorts\/)([0-9A-Za-z_-]{11})/)?.[1];
    if (!videoId) throw new Error('Invalid YouTube URL');

    let title = 'unknown incident';
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=${url}&format=json`);
      if (res.ok) title = (await res.json()).title || title;
    } catch (e) {
      console.log('oEmbed failed:', e);
    }

    const lower = title.toLowerCase();
    const isNASCAR = lower.includes('nascar');
    const incidentType = isNASCAR
      ? 'oval contact (NASCAR)'
      : lower.includes('dive') || lower.includes('bomb') ? 'divebomb'
      : lower.includes('vortex') ? 'vortex exit'
      : 'general contact';

    console.log('DEBUG:', { title, isNASCAR, incidentType });

    // 2. Load CSV – VERCEL-SAFE
    let matches = [];
    let baseFaultA = isNASCAR ? 65 : 81;

    try {
      const csvPath = path.join(__dirname, '..', 'public', 'simracingstewards_28k.csv');
      console.log('CSV path:', csvPath); // DEBUG
      const text = fs.readFileSync(csvPath, 'utf8');
      const data = Papa.parse(text, { header: true }).data;

      for (const row of data) {
        if (!row.title || !row.reason) continue;
        const txt = `${row.title} ${row.reason}`.toLowerCase();
        let score = lower.split(' ').filter(w => txt.includes(w)).length;
        if (txt.includes(incidentType.replace(' (NASCAR)', ''))) score += 3;
        if (score > 0) matches.push({ ...row, score });
      }

      matches.sort((a, b) => b.score - a.score);
      matches = matches.slice(0, 5);

      const faults = matches
        .map(r => parseFloat(r.fault_pct_driver_a || 0))
        .filter(v => !isNaN(v));
      baseFaultA = faults.length
        ? Math.round(faults.reduce((a, b) => a + b, 0) / faults.length)
        : baseFaultA;

      console.log('CSV loaded – matches:', matches.length, 'faultA:', baseFaultA);
    } catch (e) {
      console.log('CSV load failed:', e);
    }

    const confidence = matches.length >= 3 ? 'High' : matches.length ? 'Medium' : 'Low';

    // 3. Rules
    const rules = isNASCAR
      ? `NASCAR RULES:
1. 10.8.3: Stay above yellow line.
2. Inside Line Priority: Car in bottom groove has corner right.`
      : `GENERAL RULES:
1. iRacing 8.1.1.8: No advantage off track.
2. SCCA: Overtaker must be alongside at apex.`;

    // 4. Prompt – clean
    const prompt = `You are a pro sim racing steward.

TITLE: "${title}"
TYPE: ${incidentType}
NASCAR: ${isNASCAR ? 'YES' : 'NO'}
BASE FAULT: ${baseFaultA}% on Car A

RULES:
${rules}

Use these phrases:
- Dive bomb
- Vortex of Danger
- left the door open
- he was never going to make that pass
- you aren't required to leave the door open
- a lunge at the last second does not mean you have to give him space
- its the responsibility of the overtaking car to do so safely
- you didn't have space to make that move
- turn off the racing line

OUTPUT ONLY JSON:
{
  "rule": "quote one rule",
  "fault": { "Car A": "XX%", "Car B": "XX%" },
  "car_identification": "Car A: Overtaker. Car B: Defender.",
  "explanation": "3-4 sentences: what happened, why, teaching point.",
  "overtake_tip": "Tip for Car A.",
  "defend_tip": "Tip for Car B.",
  "spotter_advice": { "overtaker": "...", "defender": "..." },
  "confidence": "${confidence}",
  "flags": ["${incidentType.split(' ')[0].toLowerCase()}"]
}`;

    // 5. Call Grok
    const grok = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-3',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.7,
        top_p: 0.9,
      }),
    });

    if (!grok.ok) throw new Error(`Grok ${grok.status}`);

    const raw = (await grok.json()).choices?.[0]?.message?.content?.trim() || '';

    // 6. Parse
    let verdict = {
      rule: isNASCAR ? 'NASCAR Inside Line Priority' : 'iRacing 8.1.1.8',
      fault: { 'Car A': `${baseFaultA}%`, 'Car B': `${100 - baseFaultA}%` },
      car_identification: 'Car A: Overtaker. Car B: Defender.',
      explanation: 'Contact occurred. Overtake safely.',
      overtake_tip: 'Build overlap.',
      defend_tip: 'Hold line.',
      spotter_advice: { overtaker: 'Wait for clear.', defender: 'Call inside!' },
      confidence,
      flags: [incidentType.split(' ')[0].toLowerCase()],
    };

    try {
      const parsed = JSON.parse(raw);
      verdict = { ...verdict, ...parsed };
      verdict.fault = parsed.fault || verdict.fault;
    } catch (e) {
      console.log('Parse failed:', e);
    }

    return Response.json({ verdict, matches, isNASCAR });

  } catch (err) {
    return Response.json(
      {
        verdict: {
          rule: 'Error',
          fault: { 'Car A': '0%', 'Car B': '0%' },
          explanation: `Error: ${err.message}`,
          confidence: 'N/A',
        },
      },
      { status: 500 }
    );
  }
}
