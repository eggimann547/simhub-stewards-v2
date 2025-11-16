// api/analyze-intranet.js
import { z } from 'zod';
import Papa from 'papaparse';

const schema = z.object({ url: z.string().url() });

export async function POST(req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const { url } = schema.parse(await req.json());

    // -------------------------------------------------
    // 1. YouTube title + incident type
    // -------------------------------------------------
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
        console.log('oEmbed failed:', e);
      }
    }

    // -------------------------------------------------
    // 2. Dataset – DYNAMIC FAULT %
    // -------------------------------------------------
    let matches = [];
    let avgFaultA = 81;

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
          .filter(f => !isNaN(f) && f > 0);
        avgFaultA = validFaults.length > 0
          ? Math.round(validFaults.reduce((a, b) => a + b, 0) / validFaults.length)
          : 81;
      }
    } catch (e) {
      console.log('CSV failed:', e);
    }

    const datasetNote = matches.length
      ? `Dataset: ${matches.length}/5 matches. Avg Car A fault: ${avgFaultA}%. Top: "${matches[0].title}" (${matches[0].ruling})`
      : `Dataset: No matches. Using default for ${incidentType}: ${avgFaultA}% Car A fault`;

    const confidence = matches.length >= 3 ? 'High' : matches.length >= 1 ? 'Medium' : 'Low';

    // -------------------------------------------------
    // 3. Approved Phrases
    // -------------------------------------------------
    const phrases = [
      "Vortex of Danger",
      "Dive bomb",
      "left the door open",
      "he was never going to make that pass",
      "you aren't required to leave the door open",
      "a lunge at the last second does not mean you have to give him space",
      "its the responsibility of the overtaking car to do so safely",
      "you didn't have space to make that move",
      "turn off the racing line"
    ];

    const shuffled = [...phrases].sort(() => Math.random() - 0.5);
    const selectedPhrases = shuffled.slice(0, Math.floor(Math.random() * 2) + 1);

    // -------------------------------------------------
    // 4. Prompt – NOW WITH SCCA APPENDIX P
    // -------------------------------------------------
    const prompt = `You are a neutral, educational sim racing steward for r/simracingstewards.

Video: ${url}
Title: "${title}"
Type: ${incidentType}
${datasetNote}
Confidence: ${confidence}

RULES (quote 1–2, prioritize SCCA Appendix P when relevant):
- iRacing 8.1.1.8: "A driver may not gain an advantage by leaving the racing surface or racing below the white line"
- SCCA Appendix P (Racing Room & Passing): "The overtaking car must have a reasonable chance of completing the pass safely. Late moves into the 'Vortex of Danger' are not allowed."
- BMW SIM GT: "Predictable lines. Yield on rejoins."
- F1 Art. 27.5: "Avoid contact. Predominant fault."

Use ONLY these phrases naturally (1–2 max):
${selectedPhrases.map(p => `- "${p}"`).join('\n')}

Tone: calm, educational, community-focused. No blame.

OUTPUT ONLY VALID JSON:
{
  "rule": "Quote one rule (favor SCCA Appendix P for Vortex/divebomb)",
  "fault": { "Car A": "${avgFaultA}%", "Car B": "${100 - avgFaultA}%" },
  "car_identification": "Car A: Overtaker. Car B: Defender.",
  "explanation": "3–4 sentences: what happened, why, teaching point. Use selected phrase(s).",
  "overtake_tip": "One actionable tip for Car A.",
  "defend_tip": "One actionable tip for Car B.",
  "spotter_advice": {
    "overtaker": "Listen for 'clear inside' before turning in.",
    "defender": "Call 'car inside!' early and hold line."
  },
  "confidence": "${confidence}"
}`;

    // -------------------------------------------------
    // 5. Call Grok
    // -------------------------------------------------
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
        temperature: 0.7,
        top_p: 0.9
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!grok.ok) throw new Error(`Grok: ${grok.status}`);

    const data = await grok.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    // -------------------------------------------------
    // 6. Parse + Fallback
    // -------------------------------------------------
    let verdict = {
      rule: `iRacing 8.1.1.8`,
      fault: { "Car A": `${avgFaultA}%`, "Car B": `${100 - avgFaultA}%` },
      car_identification: "Car A: Overtaker. Car B: Defender.",
      explanation: `Car A entered the Vortex of Danger with a late Dive bomb. You didn't have space to make that move. Its the responsibility of the overtaking car to do so safely.\n\nTip A: Wait for overlap.\nTip B: Hold line on 'car inside!' call.`,
      overtake_tip: "Build 50% overlap before turning in.",
      defend_tip: "Stay predictable when spotter calls 'car inside!'.",
      spotter_advice: {
        overtaker: "Listen for 'clear inside' before committing.",
        defender: "Call 'car inside!' early and hold line."
      },
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
        spotter_advice: parsed.spotter_advice || verdict.spotter_advice,
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
        spotter_advice: { overtaker: "", defender: "" },
        confidence: "N/A"
      },
      matches: []
    }, { status: 500 });
  }
}
