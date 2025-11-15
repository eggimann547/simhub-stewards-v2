// api/analyze-intranet.js
import { z } from 'zod';
import Papa from 'papaparse';

const schema = z.object({ url: z.string().url() });

export async function POST(req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const { url } = schema.parse(await req.json());

    // 1. Extract YouTube Video ID & Title
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

    // 2. Load & Search Dataset
    let matches = [];
    let datasetAvgFaultA = 81; // fallback
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

        // Calculate real average fault % for Car A
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

    // 3. ENHANCED PROMPT — DATA-DRIVEN + SIM RACING SLANG
    const slangExamples = `
SIM RACING LINGO (use 2-3 naturally in explanation/tips like r/simracingstewards comments):
- Divebomb/Dove in late/Pulled the pin
- Turned in like you weren't there/Turned across your nose
- Used you as a guardrail/Collected you
- Locked up the brakes/Smoke show
- Held your line like a champ/Straight-lined it
- Chicane police/Bus stop blues (for chicanes)
- Rear-ended/T-boned meat
- No overlap at apex/Off-throttle dive
Tone: Neutral but sounds like a salty steward - conversational, no BS.
`;

    const prompt = `You are a grizzled sim racing steward from r/simracingstewards (10+ years iRacing/ACC).

INCIDENT:
- Video: ${url}
- Title: "${title}"
- Type: ${incidentType}

DATASET PRIOR (BASELINE FAULT %):
${datasetNote}
→ Start fault split at ${datasetAvgFaultA}% Car A / ${100 - datasetAvgFaultA}% Car B
→ Adjust ±20% ONLY if video clearly shows otherwise. MUST sum to 100%.

RULES (Quote 1-2 relevant):
1. iRacing 8.1.1.8: "A driver may not gain an advantage by leaving the racing surface or racing below the white line."
2. SCCA Appendix P: "Overtaker must be alongside at apex. One safe move only."
3. BMW SIM GT: "Predictable lines. Yield on rejoins."
4. F1 Art. 27.5: "More than 50% overlap required to claim space. Avoid contact."

ANALYSIS:
1. Quote rule(s).
2. Fault % (sum 100%, dataset-based).
3. Car A = overtaker/inside, Car B = defender/outside.
4. Explain in 2-3 sentences USING SLANG naturally.
5. ONE overtaking tip for A (slangy/actionable).
6. ONE defense tip for B (slangy/actionable).
7. Spotter calls.

${slangExamples}

CHECK:
- Overlap at apex? Defender weave? Track cut for time? Safe rejoin?

OUTPUT ONLY JSON:
{
  "rule": "iRacing 8.1.1.8",
  "fault": { "Car A": "78%", "Car B": "22%" },
  "car_identification": "Car A: Divebomber. Car B: Line holder.",
  "explanation": "Car A dove in late, turned across B's nose like they weren't there - classic no-overlap meat at apex.\\n\\nTip A: Don't pull the pin without side-by-side.\\nTip B: Hold that line like a champ on spotter 'inside!'",
  "overtake_tip": "Wait for real overlap, no off-throttle dives",
  "defend_tip": "Straight-line it, don't squeeze the meat",
  "spotter_advice": {
    "overtaker": "Spotter: 'Clear inside or clear off!'",
    "defender": "Spotter: 'Car inside - hold firm!'"
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
        max_tokens: 800,
        temperature: 0.4,  // Slightly higher for natural slang flow
        top_p: 0.85
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!grok.ok) throw new Error(`Grok API error: ${grok.status}`);

    const data = await grok.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    // 5. Parse with Fallbacks
    let verdict = {
      rule: `${incidentType.charAt(0).toUpperCase() + incidentType.slice(1)} violation`,
      fault: { 
        "Car A": `${datasetAvgFaultA}%`, 
        "Car B": `${100 - datasetAvgFaultA}%` 
      },
      car_identification: "Car A: Overtaker. Car B: Defender.",
      explanation: `Analyzed via dataset - ${incidentType} style contact.\\n\\nTip A: Build real overlap.\\nTip B: Don't move under braking.`,
      overtake_tip: "Earn the apex with overlap",
      defend_tip: "Predictable line, no gifts",
      spotter_advice: {
        overtaker: "Spotter: 'He's holding middle!'",
        defender: "Spotter: 'Inside threat!'"
      },
      confidence,
      flags: [incidentType.replace(/ /g, '_')]
    };

    try {
      const parsed = JSON.parse(raw);

      // Fault sum validation
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
      console.log('JSON parse failed, dataset fallback:', e);
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
