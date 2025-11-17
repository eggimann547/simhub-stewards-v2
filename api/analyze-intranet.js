// api/analyze-intranet.js
import { z } from 'zod';
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';

const schema = z.object({ url: z.string().url() });

export async function POST(req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    // === 1. SAFELY PARSE REQUEST BODY ===
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return Response.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    let url;
    try {
      url = schema.parse(body).url;
    } catch (e) {
      return Response.json(
        { error: "Invalid or missing 'url' field" },
        { status: 400 }
      );
    }

    // === 2. YouTube Title & Incident Type ===
    let title = 'incident';
    let incidentType = 'general contact';

    const videoId = url.match(/v=([0-9A-Za-z_-]{11})/)?.[1];
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

    const lower = title.toLowerCase();
    if (lower.includes('dive') || lower.includes('brake')) incidentType = 'divebomb';
    else if (lower.includes('vortex') || lower.includes('exit')) incidentType = 'vortex exit';
    else if (lower.includes('weave') || lower.includes('block')) incidentType = 'weave block';
    else if (lower.includes('rejoin') || lower.includes('spin')) incidentType = 'unsafe rejoin';
    else if (lower.includes('apex') || lower.includes('cut')) incidentType = 'track limits';
    else if (lower.includes('netcode') || lower.includes('lag') || lower.includes('teleport')) incidentType = 'netcode';
    else if (lower.includes('barrier') || lower.includes('wall') || lower.includes('used you')) incidentType = 'used as barrier';
    else if (lower.includes('pit') && lower.includes('maneuver')) incidentType = 'pit maneuver';

    // === 3. FAULT ENGINE ===
    let finalFaultA = 60;
    let matches = [];
    let ruleMatch = null;

    const BMW_RULES = [
      { keywords: ['dive', 'late', 'lunge', 'brake', 'underbraking', 'punting'], faultA: 90, desc: "Under-braking and punting (BMW SIM GT Rule 5)" },
      { keywords: ['block', 'weave', 'reactionary'], faultA: 20, desc: "Blocking (BMW SIM GT Rule 2)" },
      { keywords: ['rejoin', 'off-track', 'spin'], faultA: 85, desc: "Unsafe rejoin (BMW SIM GT Rule 7)" },
      { keywords: ['overlap', 'apex', 'door open'], faultA: 95, desc: "Side-by-side rule violation (BMW SIM GT Rule 4)" },
      { keywords: ['netcode', 'lag', 'teleport'], faultA: 50, desc: "Netcode-related incident" },
      { keywords: ['barrier', 'used you'], faultA: 95, desc: "Using another car as a barrier" },
      { keywords: ['pit maneuver'], faultA: 98, desc: "Pit maneuver (Intentional wrecking)" }
    ];

    for (const rule of BMW_RULES) {
      if (rule.keywords.some(k => lower.includes(k))) {
        ruleMatch = rule;
        break;
      }
    }

    const heuristicMap = {
      'divebomb': 92, 'vortex exit': 88, 'weave block': 15, 'unsafe rejoin': 80,
      'track limits': 70, 'netcode': 50, 'used as barrier': 95, 'pit maneuver': 98
    };
    const heuristicFaultA = heuristicMap[incidentType] || 70;
    const ruleFaultA = ruleMatch?.faultA || 60;

    // === CSV (Safe) ===
    try {
      const csvPath = path.join(process.cwd(), 'public', 'simracingstewards_28k.csv');
      if (fs.existsSync(csvPath)) {
        const text = fs.readFileSync(csvPath, 'utf8');
        const parsed = Papa.parse(text, { header: true }).data;
        const queryWords = title.toLowerCase().split(' ').filter(w => w.length > 2);

        for (const row of parsed) {
          if (!row.title || !row.reason) continue;
          const rowText = `${row.title} ${row.reason} ${row.ruling || ''}`.toLowerCase();
          let score = 0;
          queryWords.forEach(w => { if (rowText.includes(w)) score += 3; });
          if (rowText.includes(incidentType)) score += 5;
          if (score > 0) matches.push({ ...row, score });
        }
        matches.sort((a, b) => b.score - a.score);
        matches = matches.slice(0, 5);

        const validFaults = matches.map(m => parseFloat(m.fault_pct_driver_a)).filter(f => !isNaN(f));
        const csvFaultA = validFaults.length > 0 ? validFaults.reduce((a, b) => a + b, 0) / validFaults.length : 60;
        finalFaultA = Math.round((csvFaultA * 0.4) + (ruleFaultA * 0.4) + (heuristicFaultA * 0.2));
      }
    } catch (e) {
      console.log('CSV failed:', e);
    }

    finalFaultA = Math.min(98, Math.max(5, finalFaultA));
    const confidence = matches.length >= 3 && ruleMatch ? 'High' : matches.length >= 1 || ruleMatch ? 'Medium' : 'Low';
    const selectedRule = ruleMatch?.desc || 'iRacing Sporting Code';

    const titleForPrompt = title === 'incident' ? 'incident' : `"${title}"`;

    const prompt = `You are a neutral sim racing steward.
Video: ${url}
Title: ${titleForPrompt}
Type: ${incidentType}
Confidence: ${confidence}
RULE: ${selectedRule}
Tone: calm, educational, no blame.
1. Quote the rule.
2. State fault %.
3. Explain in 3–4 sentences.
4. Overtaking tip for Car A.
5. Defense tip for Car B.
6. Spotter advice.
RETURN ONLY JSON.`;

    // === Grok Call ===
    if (!process.env.GROK_API_KEY) {
      throw new Error("GROK_API_KEY missing");
    }

    const grok = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-3',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.7
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!grok.ok) {
      const text = await grok.text();
      throw new Error(`Grok API error ${grok.status}: ${text}`);
    }

    const data = await grok.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    let verdict = {
      rule: selectedRule,
      fault: { "Car A": `${finalFaultA}%`, "Car B": `${100 - finalFaultA}%` },
      car_identification: "Car A: Overtaker. Car B: Defender.",
      explanation: "Contact occurred. Overtaker must pass safely.",
      overtake_tip: "Wait for overlap.",
      defend_tip: "Hold your line.",
      spotter_advice: {
        overtaker: "Listen to spotter.",
        defender: "React to 'car inside!'"
      },
      confidence
    };

    try {
      const parsed = JSON.parse(raw);
      verdict = { ...verdict, ...parsed };
    } catch (e) {
      console.log('Grok JSON parse failed:', e);
    }

    return Response.json({ verdict, matches });

  } catch (err) {
    clearTimeout(timeout);
    console.error("Server error:", err);
    return Response.json(
      {
        verdict: {
          rule: "Error",
          fault: { "Car A": "0%", "Car B": "0%" },
          explanation: `Server error: ${err.message}`,
          confidence: "N/A"
        },
        matches: []
      },
      { status: 500 }
    );
  }
}
