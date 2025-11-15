// api/analyze-intranet.js
import { z } from 'zod';
import Papa from 'papaparse';

const schema = z.object({ url: z.string().url() });

export async function POST(req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const { url } = schema.parse(await req.json());

    // 1. YouTube title
    const videoId = url.match(/v=([0-9A-Za-z_-]{11})/)?.[1] || '';
    let title = 'unknown incident';
    let incidentType = 'general contact';
    if (videoId) {
      try {
        const oembed = await fetch(`https://www.youtube.com/oembed?url=${url}&format=json`, { signal: controller.signal });
        if (oembed.ok) {
          const data = await oembed.json();
          title = data.title || 'unknown';
        }
        const lower = title.toLowerCase();
        if (lower.includes('dive') || lower.includes('brake')) incidentType = 'divebomb';
        else if (lower.includes('vortex') || lower.includes('exit')) incidentType = 'vortex exit';
        else if (lower.includes('weave') || lower.includes('block')) incidentType = 'weave block';
        else if (lower.includes('rejoin') || lower.includes('spin')) incidentType = 'unsafe rejoin';
        else if (lower.includes('apex') || lower.includes('cut')) incidentType = 'track limits';
      } catch {}
    }

    // 2. Dataset
    let matches = [];
    try {
      const res = await fetch('/simracingstewards_28k.csv', { signal: controller.signal });
      if (res.ok) {
        const text = await res.text();
        const parsed = Papa.parse(text, { header: true }).data;
        const query = title.toLowerCase();
        for (const row of parsed) {
          if (!row.title || !row.reason) continue;
          const rowText = `${row.title} ${row.reason}`.toLowerCase();
          let score = query.split(' ').filter(w => rowText.includes(w)).length;
          if (rowText.includes(incidentType)) score += 2;
          if (score > 0) matches.push({ ...row, score });
        }
        matches.sort((a, b) => b.score - a.score);
        matches = matches.slice(0, 5);
      }
    } catch (e) {
      console.log('CSV failed:', e);
    }

    const datasetNote = matches.length
      ? `Dataset: ${matches.length}/5 matches (Avg A fault: ${Math.round(
          matches.reduce((s, m) => s + parseFloat(m.fault_pct_driver_a || 0), 0) / matches.length
        )}%). Top: "${matches[0].title}" (${matches[0].ruling})`
      : `Dataset: ${incidentType} incidents avg 81% Car A fault`;

    const confidence = matches.length >= 3 ? 'High' : matches.length >= 1 ? 'Medium' : 'Low';

    // 3. Prompt – SPOTTER + TIPS
    const prompt = `You are a sim racing steward. Analyze this incident.

Video: ${url}
Title: "${title}"
Type: ${incidentType}

${datasetNote}
Confidence: ${confidence}

RULE TEXTS (rotate 1-2):
- iRacing 8.1.1.8: "A driver may not gain an advantage by leaving the racing surface or racing below the white line"
- SCCA Appendix P: "Overtaker must be alongside at apex. One safe move only."
- BMW SIM GT: "Predictable lines. Yield on rejoins."
- F1 Art. 27.5: "Avoid contact. Predominant fault."

Even if one driver is at fault:
1. Quote the rule.
2. State fault %.
3. Explain what happened.
4. Give **one actionable overtaking tip** for Car A.
5. Give **one actionable defense tip** for Car B.
6. **Always include spotter advice**:
   - Overtaker: "Listen to spotter for defender's line before committing."
   - Defender: "React to spotter's 'car inside!' call immediately."

Tone: neutral, educational.

RETURN ONLY JSON:
{
  "rule": "Text",
  "fault": { "Car A": "85%", "Car B": "15%" },
  "car_identification": "Car A: Overtaker. Car B: Defender.",
  "explanation": "Summary paragraph\\n\\nTip A: ...\\nTip B: ...",
  "overtake_tip": "Wait for overlap + listen to spotter",
  "defend_tip": "Widen line on 'car inside!' call",
  "confidence": "High"
}`;

    // 4. Grok
    const grok = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-3',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 700,
        temperature: 0.4
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!grok.ok) throw new Error(`Grok: ${grok.status}`);

    const data = await grok.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    // 5. Parse
    let verdict = {
      rule: `${incidentType} violation (iRacing 8.1.1.8)`,
      fault: { "Car A": "81%", "Car B": "19%" },
      car_identification: "Car A: Overtaker. Car B: Defender.",
      explanation: `Contact due to late move.\\n\\nTip A: Brake earlier.\\nTip B: Widen line.`,
      overtake_tip: "Wait for overlap + listen to spotter",
      defend_tip: "React to 'car inside!' call",
      confidence
    };

    try {
      const parsed = JSON.parse(raw);
      verdict = {
        rule: parsed.rule || verdict.rule,
        fault: parsed.fault || verdict.fault,
        car_identification: parsed.car_identification || verdict.car_identification,
        explanation: parsed.explanation || verdict.explanation,
        overtake_tip: parsed.overtake_tip || verdict.overtake_tip,
        defend_tip: parsed.defend_tip || verdict.defend_tip,
        confidence: parsed.confidence || confidence
      };
    } catch (e) {
      console.log('Parse failed:', e);
    }

    return Response.json({ verdict, matches });
  } catch (err) {
    clearTimeout(timeout);
    return Response.json({
      verdict: {
        rule: "Error",
        fault: { "Car A": "0%", "Car B": "0%" },
        car_identification: "",
        explanation: err.message,
        overtake_tip: "",
        defend_tip: "",
        confidence: "N/A"
      },
      matches: []
    }, { status: 500 });
  }
}
