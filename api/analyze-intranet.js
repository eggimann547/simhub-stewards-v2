// api/analyze-intranet.js
import { z } from 'zod';
import Papa from 'papaparse';

const schema = z.object({ url: z.string().url() });

export async function POST(req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const { url } = schema.parse(await req.json());

    // 1. YouTube Title & Incident Type
    const videoId = url.match(/v=([0-9A-Za-z_-]{11})/)?.[1] || '';
    let title = 'unknown incident';
    let incidentType = 'general contact';
    let isNASCAR = false;

    if (videoId) {
      try {
        const oembed = await fetch(`https://www.youtube.com/oembed?url=${url}&format=json`, { signal: controller.signal });
        if (oembed.ok) {
          const data = await oembed.json();
          title = data.title || 'unknown';
        }
        const lower = title.toLowerCase();
        if (lower.includes('nascar')) {
          isNASCAR = true;
          incidentType = `${incidentType} (NASCAR)`;
        }
        if (lower.includes('dive') || lower.includes('brake')) incidentType = 'divebomb';
        else if (lower.includes('vortex') || lower.includes('exit')) incidentType = 'vortex exit';
        else if (lower.includes('weave') || lower.includes('block')) incidentType = 'weave block';
        else if (lower.includes('rejoin') || lower.includes('spin')) incidentType = 'unsafe rejoin';
        else if (lower.includes('apex') || lower.includes('cut')) incidentType = 'track limits';
      } catch (e) {
        console.log('YouTube oembed failed:', e);
      }
    }

    // 2. Dataset Search & Stats
    let matches = [];
    let datasetAvgFaultA = 81;
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
          if (rowText.includes(incidentType.replace(' (NASCAR)', ''))) score += 2;
          if (score > 0) matches.push({ ...row, score });
        }

        matches.sort((a, b) => b.score - a.score);
        matches = matches.slice(0, 5);

        const validFaults = matches
          .map(m => parseFloat(m.fault_pct_driver_a || 0))
          .filter(f => !isNaN(f) && f >= 0);
        datasetAvgFaultA = validFaults.length > 0
          ? Math.round(validFaults.reduce((a, b) => a + b, 0) / validFaults.length)
          : isNASCAR ? 65 : 81;
      }
    } catch (e) {
      console.log('CSV load failed:', e);
    }

    const datasetNote = matches.length
      ? `Dataset: ${matches.length}/5 matches. Avg Car A fault: ${datasetAvgFaultA}%. Top: "${matches[0].title}" (${matches[0].ruling})`
      : `Dataset: No matches. Using default for ${incidentType}: ~${datasetAvgFaultA}% Car A fault`;

    const confidence = matches.length >= 3 ? 'High' : matches.length >= 1 ? 'Medium' : 'Low';

    // 3. RULES (NASCAR or General)
    const generalRules = `
1. iRacing 8.1.1.8: "A driver may not gain an advantage by leaving the racing surface or racing below the white line."
2. SCCA Appendix P: "Overtaker must be alongside at apex. One safe move only."
3. BMW SIM GT: "Predictable lines. Yield on rejoins."
4. F1 Art. 27.5: "More than 50% overlap required to claim space. Avoid contact."`;

    const nascarRules = `
1. NASCAR 10.8.3 (Yellow Line): "Vehicles must race above the double yellow lines. Below to gain position = black flag."
2. NASCAR Inside Line Priority: "Car establishing inside/bottom groove has right to corner."`;

    const rulesSection = isNASCAR ? nascarRules : generalRules;

    // 4. PROMPT – CLEAN, FORMAL, DATA-DRIVEN
    const prompt = `You are a professional, neutral sim racing steward.

### DATASET PRIOR (MUST USE AS BASELINE)
${datasetNote}
**FAULT BASELINE: ${datasetAvgFaultA}% Car A / ${100 - datasetAvgFaultA}% Car B**
→ Adjust ±20% max only if video clearly contradicts.
→ Must sum to 100%.
${isNASCAR ? 'NASCAR: Minor contact in pack racing often shared ("rubbing is racing").' : ''}

INCIDENT:
- Video: ${url}
- Title: "${title}"
- Type: ${incidentType}

RULES (Quote 1–2 most relevant):
${rulesSection}

OUTPUT ONLY VALID JSON (NO EXTRA TEXT, NO SLANG):
{
  "rule": "iRacing 8.1.1.8",
  "fault": { "Car A": "78%", "Car B": "22%" },
  "car_identification": "Car A: Overtaker. Car B: Defender.",
  "explanation": "Car A initiated a late overtaking maneuver without sufficient overlap at the apex, resulting in contact. Car B maintained a consistent racing line.",
  "overtake_tip": "Establish at least 50% overlap before committing to the inside line.",
  "defend_tip": "Maintain a predictable line when a spotter calls 'car inside'.",
  "spotter_advice": {
    "overtaker": "Wait for 'clear inside' before turning in.",
    "defender": "Call 'car inside!' early and hold your line."
  },
  "confidence": "${confidence}",
  "flags": ["divebomb", "no_overlap_at_apex"]
}`;

    // 5. Call Grok
    const grok = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-3',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.2,
        top_p: 0.7
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!grok.ok) throw new Error(`Grok API error: ${grok.status}`);

    const data = await grok.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    // 6. Parse with Dataset Fallback
    let verdict = {
      rule: `${incidentType} incident`,
      fault: { 
        "Car A": `${datasetAvgFaultA}%`, 
        "Car B": `${100 - datasetAvgFaultA}%` 
      },
      car_identification: "Car A: Overtaker. Car B: Defender.",
      explanation: `Contact occurred during an overtaking attempt.\n\nTip A: Establish overlap before turning in.\nTip B: Hold racing line when under pressure.`,
      overtake_tip: "Wait for overlap at apex",
      defend_tip: "Stay predictable on defense",
      spotter_advice: {
        overtaker: "Listen for 'clear inside'",
        defender: "Call 'car inside!' early"
      },
      confidence,
      flags: [incidentType.replace(/ /g, '_').replace('_(nascar)', '_nascar')]
    };

    try {
      const parsed = JSON.parse(raw);

      const a = parseInt((parsed.fault?.["Car A"] || '').replace('%', ''));
      const b = parseInt((parsed.fault?.["Car B"] || '').replace('%', ''));
      const sumValid = !isNaN(a) && !isNaN(b) && a + b === 100;

      verdict = {
        rule: parsed.rule || verdict.rule,
        fault: sumValid ? parsed.fault : verdict.fault,
        car_identification: parsed.car_identification || verdict.car_identification,
        explanation: parsed.explanation || verdict.explanation,
        overtake_tip: parsed.overtake_tip || verdict.overtake_tip,
        defend_tip: parsed.defend_tip || verdict.defend_tip,
        spotter_advice: parsed.spotter_advice || verdict.spotter_advice,
        confidence: parsed.confidence || confidence,
        flags: Array.isArray(parsed.flags) ? parsed.flags : verdict.flags
      };
    } catch (e) {
      console.log('JSON parse failed, using dataset prior:', e);
    }

    return Response.json({ verdict, matches, isNASCAR });

  } catch (err) {
    clearTimeout(timeout);
    return Response.json({
      verdict: {
        rule: "Analysis Error",
        fault: { "Car A": "0%", "Car B": "0%" },
        car_identification: "",
        explanation: `Error: ${err.message}`,
        overtake_tip: "",
        defend_tip: "",
        spotter_advice: { overtaker: "", defender: "" },
        confidence: "N/A",
        flags: []
      },
      matches: [],
      isNASCAR: false
    }, { status: 500 });
  }
}
