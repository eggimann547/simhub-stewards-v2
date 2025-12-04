// pages/api/analyze-intranet.js
// Version: 2.6.0 — Rich Precedents + Video Links (100% backward compatible)
// December 04, 2025

import { z } from 'zod';
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';

const schema = z.object({
  url: z.string().optional().default(""),
  incidentType: z.string().min(1, "Please select an incident type"),
  carA: z.string().optional().default(""),
  carB: z.string().optional().default(""),
  stewardNotes: z.string().optional().default(""),
  overrideFaultA: z.coerce.number().min(0).max(100).optional().nullable(),
  manualTitle: z.string().optional().default("")
});

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...options });
      if (res.ok) return res;
      if (i === retries - 1) throw new Error(`Fetch failed: ${res.status}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    } catch (e) {
      if (i === retries - 1) throw e;
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const {
      url = "",
      incidentType: userType,
      carA = "",
      carB = "",
      stewardNotes = "",
      overrideFaultA = null,
      manualTitle = ""
    } = schema.parse(req.body);

    const humanInput = stewardNotes.trim();

    // 1. Title resolution
    let title = 'Sim racing incident';
    const videoId = url.match(/(?:v=|youtu\.be\/)([0-9A-Za-z_-]{11})/)?.[1];
    if (videoId) {
      try {
        const oembed = await fetch(`https://www.youtube.com/oembed?url=${url}&format=json`, { signal: controller.signal });
        if (oembed.ok) title = (await oembed.json()).title || title;
      } catch {}
    }
    const effectiveTitle = manualTitle.trim() || title;

    // 2. Incident key mapping
    const typeMap = {
      "Divebomb / Late lunge": "divebomb",
      "Weave / Block / Defending move": "weave block",
      "Unsafe rejoin": "unsafe rejoin",
      "Vortex of Danger": "vortex exit",                    // ← unified
      "Netcode / Lag / Teleport": "netcode",
      "Used as a barrier / Squeeze": "used as barrier",
      "Pit-lane incident": "pit-lane incident",
      "Start-line chaos / T1 pile-up": "t1 chaos",
      "Intentional wreck / Revenge": "intentional wreck",
      "Racing incident (no fault)": "racing incident",
      "Crowd-strike / Accordion effect": "accordion",
      "Blocking while being lapped": "blue flag block",
      "Blue-flag violation / Ignoring blue flags": "blue flag",
      "Brake test": "brake test",
      "Brake check": "brake test",
      "Cutting the track / Track limits abuse": "track limits",
      "False start / Jump start": "jump start",
      "Illegal overtake under SC/VSC/FCY": "illegal overtake sc",
      "Move under braking": "move under braking",
      "Over-aggressive defense (2+ moves)": "aggressive defense",
      "Punt / Rear-end under braking": "punt",
      "Re-entry after off-track (gaining advantage)": "rejoin advantage",
      "Side-by-side contact mid-corner": "side contact",
      "Track rejoin blocking racing line": "rejoin block",
      "Unsportsmanlike conduct / Chat abuse": "unsportsmanlike",
      "Wrong way / Ghosting violation": "wrong way"
    };
    const incidentKey = typeMap[userType] || "general contact";

    // 3. CSV precedent matching
    let matches = [];
    let finalFaultA = 60;
    let confidence = "Low";

    if (overrideFaultA !== null) {
      finalFaultA = Math.round(overrideFaultA);
      confidence = "Human Override";
    } else {
      try {
        const csvPath = path.join(process.cwd(), 'public', 'simracingstewards_28k.csv');
        const text = fs.readFileSync(csvPath, 'utf8');
        const parsed = Papa.parse(text, { header: true }).data;

        for (const row of parsed) {
          if (!row.title) continue;
          const rowText = `${row.title} ${row.reason || ''} ${row.ruling || ''}`.toLowerCase();
          
          let score = 0;

        // 1. Strong match on incident key + known synonyms
        const keyTerms = {
          "vortex exit": ["vortex", "draft lift", "vortex of danger", "exit vortex"],
          "divebomb": ["divebomb", "dive bomb", "late lunge", "dive"],
          "unsafe rejoin": ["rejoin", "re-joined", "came back on", "returned to track"],
          "brake test": ["brake test", "brake check", "brake checked"],
          "weave block": ["weave", "block", "blocking", "defending move"]
          // add more only if you want — not required
        };
        const searchTerms = keyTerms[incidentKey] || [incidentKey];

        if (searchTerms.some(t => rowText.includes(t))) score += 15;

        // 2. Title match — much more forgiving
        if (effectiveTitle) {
          const titleLower = effectiveTitle.toLowerCase();
          if (row.title && row.title.toLowerCase().includes(titleLower)) score += 20;
          else if (rowText.includes(titleLower)) score += 8;
        }

        // 3. Steward notes — full text, not just first 30 chars
        if (humanInput) {
          const notesLower = humanInput.toLowerCase();
          if (rowText.includes(notesLower)) score += 12;
        }
          
          if (score > 0) matches.push({ ...row, score });
        }

        matches.sort((a, b) => b.score - a.score);
        matches = matches.slice(0, 5);

        const validFaults = matches.map(m => parseFloat(m.fault_pct_driver_a)).filter(f => !isNaN(f));
        const csvFaultA = validFaults.length > 0 ? validFaults.reduce((a, b) => a + b, 0) / validFaults.length : 60;
        finalFaultA = Math.round(csvFaultA * 0.7 + 50 * 0.3);
        confidence = matches.length >= 4 ? 'Very High' : matches.length >= 2 ? 'High' : matches.length >= 1 ? 'Medium' : 'Low';
      } catch (e) {
        console.error("CSV error:", e);
      }
    }

    finalFaultA = Math.min(98, Math.max(2, finalFaultA));

    // 4. Pro Tip — branded, bulletproof
    let proTip = "";

    try {
      const tipPath = path.join(process.cwd(), 'public', 'tips2.txt');
      const text = fs.readFileSync(tipPath, 'utf8');
      const lines = text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.includes('|') && l.split('|')[0].length > 10);

      const aliases = {
        "divebomb": ["divebomb", "dive", "lunge", "late lunge"],
        "weave block": ["weave block", "weave", "block", "blocking", "defending", "defense"],
        "unsafe rejoin": ["unsafe rejoin", "rejoin", "re-join", "rejoining", "came back on", "returned to track"],
        "vortex exit": ["vortex", "draft lift-off", "lift-off", "lift in draft", "vortex of danger"],
        "netcode": ["netcode", "lag", "teleport", "desync", "latency"],
        "used as barrier": ["used as barrier", "squeeze", "barrier", "squeezed"],
        "pit-lane incident": ["pit-lane", "pit lane", "pit entry", "pit exit"],
        "t1 chaos": ["t1", "start-line", "lap 1", "pile-up", "t1 pile-up", "start chaos"],
        "intentional wreck": ["intentional wreck", "revenge", "wrecking", "punish", "pit maneuver"],
        "racing incident": ["racing incident", "no fault", "50/50", "both at fault"],
        "accordion": ["accordion", "crowd-strike", "concertina"],
        "blue flag block": ["blue flag block", "blocking while lapped", "lapped block"],
        "blue flag": ["blue flag", "lapped", "yield", "blue flags"],
        "brake test": ["brake test", "brake check", "brake checked"],
        "track limits": ["track limits", "cutting", "track cut", "off-track", "corner cut"],
        "jump start": ["jump start", "false start", "rolling start"],
        "illegal overtake sc": ["illegal overtake", "sc", "vsc", "fcy", "safety car", "yellow"],
        "move under braking": ["move under braking", "dive under braking", "braking move"],
        "aggressive defense": ["aggressive defense", "over-aggressive", "2+ moves", "weaving"],
        "punt": ["punt", "rear-end", "shunt", "nose to tail"],
        "rejoin advantage": ["rejoin advantage", "gaining advantage", "off-track gain"],
        "side contact": ["side contact", "side-by-side", "wheel to wheel", "mid-corner"],
        "rejoin block": ["rejoin block", "blocking racing line", "rejoin across"],
        "unsportsmanlike": ["unsportsmanlike", "chat abuse", "toxicity", "toxic", "abuse"],
        "wrong way": ["wrong way", "ghosting", "reverse", "driving backwards"]
      };

      const terms = aliases[incidentKey] || [incidentKey];
      const candidates = lines.filter(line =>
        terms.some(t => line.toLowerCase().includes(t))
      );

      if (candidates.length > 0) {
        const chosen = candidates[Math.floor(Math.random() * candidates.length)].split('|')[0].trim();
        proTip = `TheSimRacingStewards Tip: ${chosen}`;
      }
    } catch (e) {
      console.warn("Pro tip failed:", e.message);
    }

    if (!proTip) proTip = "TheSimRacingStewards Tip: Both drivers can improve situational awareness.";

    // 5. NEW: Rich precedent cases (safe addition)
    const precedentCases = matches.slice(0, 3).map(m => ({
      video: m.youtube_url || null,
      title: m.title || "Sim racing incident",
      ruling: m.ruling || "No ruling recorded",
      reason: m.reason || "No reason recorded",
      faultA: parseFloat(m.fault_pct_driver_a) || 50,
      thread: m.thread_id ? `https://old.reddit.com/r/simracingstewards/comments/${m.thread_id}/` : null
    }));

    // 6. Car roles (unchanged)
    let carARole = "the overtaking car", carBRole = "the defending car";
    switch (incidentKey) {
      case 'weave block': [carARole, carBRole] = ["the defending car", "the overtaking car"]; break;
      case 'unsafe rejoin': [carARole, carBRole] = ["the rejoining car", "the on-track car"]; break;
      case 'netcode': [carARole, carBRole] = ["the teleporting car", "the affected car"]; break;
      case 'used as barrier': [carARole, carBRole] = ["the car using another as a barrier", "the car used as a barrier"]; break;
      case 'intentional wreck': [carARole, carBRole] = ["the aggressor", "the victim"]; break;
      case 'racing incident': [carARole, carBRole] = ["Car A", "Car B"]; break;
    }

    const carAIdentifier = carA ? ` (${carA.trim()})` : "";
    const carBIdentifier = carB ? ` (${carB.trim()})` : "";
    const carIdentification = `Car A${carAIdentifier} is ${carARole}. Car B${carBIdentifier} is ${carBRole}.`;

    // 7. Grok verdict (unchanged except proTip is now branded)
    const humanContext = humanInput ? `HUMAN STEWARD OBSERVATIONS (must be reflected exactly, no contradictions):\n"${humanInput}"\n\n` : "";
    const titleContext = effectiveTitle ? `SUBMITTER PERSPECTIVE (title): "${effectiveTitle}"\n` : "";

    const prompt = `You are a senior, neutral sim-racing steward writing an official verdict.
${humanContext}${titleContext}Video URL (if provided): ${url}
Incident type: ${userType}
Car identification: ${carIdentification}
Fault allocation: Car A${carAIdentifier} ${finalFaultA}% — Car B${carBIdentifier} ${100 - finalFaultA}%
Confidence: ${confidence}

Write a unique, calm, educational verdict in 3–5 sentences.
Start with: "In this ${userType.toLowerCase()}..."
Use Car A${carAIdentifier} and Car B${carBIdentifier} throughout.
If human observations were provided, base the entire explanation on them — do not contradict or ignore them.
End with this exact pro tip: "${proTip}"

Return ONLY valid JSON:
{
  "rule": "relevant rule(s)",
  "fault": { "Car A${carAIdentifier}": "${finalFaultA}%", "Car B${carBIdentifier}": "${100-finalFaultA}%" },
  "car_identification": "${carIdentification}",
  "explanation": "3–5 unique sentences",
  "pro_tip": "${proTip}",
  "confidence": "${confidence}"
}`;

    const grokRes = await fetchWithRetry('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'grok-3',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 700,
        temperature: 0.7
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const data = await grokRes.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    let verdict = {
      rule: "iRacing Sporting Code / ACC LFM Regulations",
      fault: { [`Car A${carAIdentifier}`]: `${finalFaultA}%`, [`Car B${carBIdentifier}`]: `${100-finalFaultA}%` },
      car_identification: carIdentification,
      explanation: `In this ${userType.toLowerCase()}, contact occurred between Car A${carAIdentifier} and Car B${carBIdentifier}.\n\n${proTip}`,
      pro_tip: proTip,
      confidence
    };

    try { Object.assign(verdict, JSON.parse(raw)); } catch {}

    verdict.video_title = effectiveTitle;

    // ← NEW: Rich precedents included safely
    res.status(200).json({
      verdict,
      precedents: precedentCases,    // ← safe new field
      matches: matches.slice(0, 5)   // ← kept for backward compatibility
    });

  } catch (err) {
    clearTimeout(timeout);
    console.error(err);
    res.status(500).json({
      verdict: {
        rule: "Error",
        fault: { "Car A": "—", "Car B": "—" },
        car_identification: "Unable to process",
        explanation: "Something went wrong — please try again.",
        pro_tip: "",
        confidence: "N/A"
      },
      precedents: [],
      matches: []
    });
  }
}
