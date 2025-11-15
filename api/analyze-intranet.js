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
          if (rowText.includes(incidentType)) score += 2;
          if (score > 0) matches.push({ ...row, score });
        }

        matches.sort((a, b) => b.score - a.score);
        matches = matches.slice(0, 5);

        const validFaults = matches
          .map(m => parseFloat(m.fault_pct_driver_a || 0))
          .filter(f => !isNaN(f) && f >= 0);
        datasetAvgFaultA = validFaults.length > 0
          ? Math.round(validFaults.reduce((a, b) => a + b, 0) / validFaults.length)
          : 81;
      }
    } catch (e) {
      console.log('CSV load failed:', e);
    }

    const datasetNote = matches.length
      ? `Dataset: ${matches.length}/5 matches. Avg Car A fault: ${datasetAvgFaultA}%. Top: "${matches[0].title}" (${matches[0].ruling})`
      : `Dataset: No matches. Using default for ${incidentType}: ~${datasetAvgFaultA}% Car A fault`;

    const confidence = matches.length >= 3 ? 'High' : matches.length >= 1 ? 'Medium' : 'Low';

    // 3. PROMPT – FRIENDLY, UNBIASED, COMMUNITY SLANG (APPROVED ONLY)
    const approvedSlang = `
COMMUNITY LANGUAGE (use 1–2 naturally in explanation/tips):
- "turned in like you weren't even there"
- "used you as a guardrail"
- "divebombed the chicane"
- "locked up and collected"
- "held your line like a champ"
Tone: Friendly, neutral, educational — like a helpful r/simracingstewards mod.
No drama, no rage, no sarcasm. Just clear, fair, and relatable.
`;

    const prompt = `You are a friendly, experienced sim racing steward helping drivers improve.

INCIDENT:
- Video: ${url}
- Title: "${title}"
- Type: ${incidentType}

DATASET PRIOR:
${datasetNote}
→ Start fault at ${datasetAvgFaultA}% Car A / ${100 - datasetAvgFaultA}% Car B
→ Adjust ±20% only if video clearly shows otherwise. Must sum to 100%.

RULES (Quote 1–2 most relevant):
1. iRacing 8.1.1.8: "A driver may not gain an advantage by leaving the racing surface or racing below the white line."
2. SCCA Appendix P: "Overtaker must be alongside at apex. One safe move only."
3. BMW SIM GT: "Predictable lines. Yield on rejoins."
4. F1 Art. 27.5: "More than 50% overlap required to claim space. Avoid contact."

ANALYSIS:
1. Quote rule(s).
2. Fault % (sum 100%, dataset-guided).
3. Car A = overtaker/inside, Car B = defender/outside.
4. Explain in 2–3 short sentences — use 1–2 approved slang terms naturally.
5. One clear overtaking tip for Car A.
6. One clear defense tip for Car B.
7. Spotter callouts.

${approvedSlang}

CHECK IF RELEVANT:
- Was there overlap at apex?
- Did anyone cut the corner and gain time?
- Was the rejoin safe and predictable?

OUTPUT ONLY VALID JSON:
{
  "rule": "iRacing 8.1.1.8",
  "fault": { "Car A": "82%", "Car B": "18%" },
  "car_identification": "Car A: Overtaker. Car B: Defender.",
  "explanation": "Car A turned in like you weren't even there, causing contact at the apex.\\n\\nTip A: Wait for overlap before committing.\\nTip B: Hold your line like a champ on 'car inside!'",
  "overtake_tip": "Build overlap before turning in",
  "defend_tip": "Stay predictable when spotter calls 'inside'",
  "spotter_advice": {
    "overtaker": "Wait for 'clear inside' from spotter",
    "defender": "Call 'car inside!' early and hold line"
  },
  "confidence": "${confidence}",
  "flags": ["divebomb", "no_overlap"]
}`;

    // 4. Call Grok
    const grok = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-3',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 750,
        temperature: 0.35,
        top_p: 0.8
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!grok.ok) throw new Error(`Grok API error: ${grok.status}`);

    const data = await grok.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    // 5. Parse with Dataset Fallback
    let verdict = {
      rule: `${incidentType.charAt(0).toUpperCase() + incidentType.slice(1)} incident`,
      fault: { 
        "Car A": `${datasetAvgFaultA}%`, 
        "Car B": `${100 - datasetAvgFaultA}%` 
      },
      car_identification: "Car A: Overtaker. Car B: Defender.",
      explanation: `Contact occurred due to late move.\\n\\nTip A: Brake earlier for safer entry.\\nTip B: Hold racing line firmly.`,
      overtake_tip: "Wait for overlap at apex",
      defend_tip: "Stay predictable on defense",
      spotter_advice: {
        overtaker: "Listen for 'clear inside'",
        defender: "Call 'car inside!' early"
      },
      confidence,
      flags: [incidentType.replace(/ /g, '_')]
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

    return Response.json({ verdict, matches });

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
      matches: []
    }, { status: 500 });
  }
}
