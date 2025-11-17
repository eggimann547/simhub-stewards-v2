// api/analyze-intranet.js
// KNOWN WORKING — DO NOT CHANGE
import { z } from 'zod';
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';

const schema = z.object({ url: z.string().url() });

export async function POST(req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const { url } = schema.parse(await req.json());

    // === 1. YouTube Title ===
    const videoId = url.match(/v=([0-9A-Za-z_-]{11})/)?.[1] || url.match(/youtu\.be\/([0-9A-Za-z_-]{11})/)?.[1] || '';
    let title = 'incident';
    if (videoId) {
      try {
        const oembed = await fetch(`https://www.youtube.com/oembed?url=${url}&format=json`, { signal: controller.signal });
        if (oembed.ok) {
          const data = await oembed.json();
          title = data.title || 'incident';
        }
      } catch (e) {
        console.log('oEmbed failed:', e);
      }
    }

    // === 2. Incident Type ===
    const lower = title.toLowerCase();
    let incidentType = 'general contact';
    if (lower.includes('dive') || lower.includes('brake')) incidentType = 'divebomb';
    else if (lower.includes('vortex') || lower.includes('exit')) incidentType = 'vortex exit';
    else if (lower.includes('weave') || lower.includes('block')) incidentType = 'weave block';
    else if (lower.includes('rejoin') || lower.includes('spin')) incidentType = 'unsafe rejoin';
    else if (lower.includes('netcode') || lower.includes('lag')) incidentType = 'netcode';

    // === 3. CSV Matching ===
    let matches = [];
    let finalFaultA = 60;
    try {
      const csvPath = path.join(process.cwd(), 'public', 'simracingstewards_28k.csv');
      const text = fs.readFileSync(csvPath, 'utf8');
      const parsed = Papa.parse(text, { header: true }).data;
      const queryWords = title.toLowerCase().split(' ').filter(w => w.length > 2);

      for (const row of parsed) {
        if (!row.title) continue;
        const rowText = `${row.title} ${row.reason || ''}`.toLowerCase();
        let score = 0;
        queryWords.forEach(w => { if (rowText.includes(w)) score += 3; });
        if (rowText.includes(incidentType)) score += 5;
        if (score > 0) matches.push({ ...row, score });
      }
      matches.sort((a, b) => b.score - a.score);
      matches = matches.slice(0, 5);

      const validFaults = matches.map(m => parseFloat(m.fault_pct_driver_a)).filter(f => !isNaN(f));
      const csvFaultA = validFaults.length > 0 ? validFaults.reduce((a, b) => a + b, 0) / validFaults.length : 60;
      finalFaultA = Math.round(csvFaultA * 0.6 + 70 * 0.4);
    } catch (e) {
      console.log('CSV failed:', e);
    }

    finalFaultA = Math.min(98, Math.max(5, finalFaultA));
    const confidence = matches.length >= 3 ? 'High' : matches.length >= 1 ? 'Medium' : 'Low';

    // === 4. Simple Tip (No tips2.txt) ===
    const tips = {
      divebomb: "Brake earlier when no overlap.",
      'vortex exit': "Avoid late moves in the vortex.",
      'weave block': "Hold your line — don’t weave.",
      'unsafe rejoin': "Rejoin parallel to track.",
      netcode: "Lag is no one’s fault — restart clean."
    };
    const proTip = tips[incidentType] || "Both drivers can improve with awareness.";

    // === 5. Prompt ===
    const prompt = `You are a neutral sim racing steward.
Video: ${url}
Title: "${title}"
Type: ${incidentType}
Fault: Car A ${finalFaultA}%, Car B ${100 - finalFaultA}%
Confidence: ${confidence}
Include tip: "${proTip}"
Return ONLY JSON:
{
  "rule": "iRacing Sporting Code",
  "fault": { "Car A": "${finalFaultA}%", "Car B": "${100 - finalFaultA}%" },
  "explanation": "3-4 sentence educational summary.",
  "overtake_tip": "Tip for A",
  "defend_tip": "Tip for B",
  "spotter_advice": { "overtaker": "...", "defender": "..." },
  "confidence": "${confidence}"
}`;

    // === 6. Grok ===
    const grok = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-3',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!grok.ok) throw new Error('Grok failed');

    const data = await grok.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    let verdict = {
      rule: "iRacing Sporting Code",
      fault: { "Car A": `${finalFaultA}%`, "Car B": `${100 - finalFaultA}%` },
      explanation: `Contact in ${incidentType}. ${proTip}`,
      overtake_tip: "Brake earlier.",
      defend_tip: "Hold line.",
      spotter_advice: { overtaker: "Listen to spotter.", defender: "React fast." },
      confidence
    };

    try {
      const parsed = JSON.parse(raw);
      verdict = { ...verdict, ...parsed };
    } catch (e) {
      console.log('Parse failed:', e);
    }

    verdict.explanation += `\n\n${proTip}`;

    return Response.json({ verdict, matches });
  } catch (err) {
    clearTimeout(timeout);
    return Response.json({
      verdict: {
        rule: "Error",
        fault: { "Car A": "0%", "Car B": "0%" },
        explanation: "Server error. Try again.",
        overtake_tip: "",
        defend_tip: "",
        spotter_advice: { overtaker: "", defender: "" },
        confidence: "N/A"
      },
      matches: []
    }, { status: 500 });
  }
}
