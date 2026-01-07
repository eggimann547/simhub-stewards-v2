// pages/api/analyze-intranet.js
// Version: 2.7.1 — Curated Precedents With Randomization
// January 07, 2026

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

// Simple Fisher-Yates shuffle
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
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

    // 2. Incident key mapping (unchanged)
    const typeMap = {
      "Divebomb / Late lunge": "divebomb",
      "Weave / Block / Defending move": "weave block",
      "Unsafe rejoin": "unsafe rejoin",
      "Vortex of Danger": "vortex exit",
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
      "Side-by-side contact / Mid-corner": "side contact",
      "Track rejoin blocking racing line": "rejoin block",
      "Unsportsmanlike conduct / Chat abuse": "unsportsmanlike",
      "Wrong way / Ghosting violation": "wrong way"
    };
    const incidentKey = typeMap[userType] || "general contact";

    // 3. Load curated precedents
let precedentCases = [];
let confidence = "Medium";

try {
  const curatedPath = path.join(process.cwd(), 'public', 'precedents_real.csv');
  const text = fs.readFileSync(curatedPath, 'utf8');
  const parsed = Papa.parse(text, { header: true }).data;

  let matches = parsed.filter(row => row.incident_type === userType);
  matches = shuffleArray(matches).slice(0, 5);  // Shuffle for variety, take up to 5

  precedentCases = matches.map(m => ({
  title: m.title || "Sim Racing Incident",
  ruling: m.ruling || "No ruling",
  reason: m.reason || "No reason provided",
  faultA: parseInt(m.fault_a) || 50,
  thread: m.thread_id ? `https://old.reddit.com/r/simracingstewards/comments/${m.thread_id}/` : null
}));

  if (precedentCases.length >= 4) confidence = "Very High";
  else if (precedentCases.length === 3) confidence = "High";
  else if (precedentCases.length === 2) confidence = "Medium";
  else if (precedentCases.length === 1) confidence = "Low";
  else confidence = "Low (using defaults)";
} catch (e) {
  console.warn("Curated precedents failed:", e.message);
}

    // 4. Fault % — simple average from curated precedents
    let finalFaultA = 60;
    if (overrideFaultA !== null) {
      finalFaultA = Math.round(overrideFaultA);
      confidence = "Human Override";
    } else if (precedentCases.length > 0) {
      const avg = precedentCases.reduce((sum, p) => sum + p.faultA, 0) / precedentCases.length;
      finalFaultA = Math.round(avg);
    }
    finalFaultA = Math.min(98, Math.max(2, finalFaultA));

    // 5. Pro Tip — unchanged, perfect as-is
    let proTip = "";
    try {
      const tipPath = path.join(process.cwd(), 'public', 'tips2.txt');
      const text = fs.readFileSync(tipPath, 'utf8');
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.includes('|') && l.split('|')[0].length > 10);

      const aliases = {
        "divebomb": ["divebomb", "dive", "lunge", "late lunge"],
        "weave block": ["weave block", "weave", "block", "blocking", "defending", "defense"],
        "unsafe rejoin": ["unsafe rejoin", "rejoin", "re-join", "rejoining"],
        "vortex exit": ["vortex", "draft lift-off", "lift-off", "lift in draft", "vortex of danger"],
        "netcode": ["netcode", "lag", "teleport", "desync"],
        "used as barrier": ["used as barrier", "squeeze", "barrier"],
        "pit-lane incident": ["pit-lane", "pit lane"],
        "t1 chaos": ["t1", "start-line", "lap 1", "pile-up"],
        "intentional wreck": ["intentional wreck", "revenge", "wrecking"],
        "racing incident": ["racing incident", "no fault", "50/50", "both at fault"],
        "accordion": ["accordion", "crowd-strike", "concertina"],
        "blue flag block": ["blue flag block", "lapped block"],
        "blue flag": ["blue flag", "lapped", "yield"],
        "brake test": ["brake test", "brake check"],
        "track limits": ["track limits", "cutting", "track cut"],
        "jump start": ["jump start", "false start"],
        "illegal overtake sc": ["illegal overtake", "sc", "vsc", "fcy"],
        "move under braking": ["move under braking"],
        "aggressive defense": ["aggressive defense", "2+ moves"],
        "punt": ["punt", "rear-end", "shunt"],
        "rejoin advantage": ["rejoin advantage", "gaining advantage"],
        "side contact": ["side contact", "side-by-side", "mid-corner"],
        "rejoin block": ["rejoin block", "blocking racing line"],
        "unsportsmanlike": ["unsportsmanlike", "chat abuse"],
        "wrong way": ["wrong way", "ghosting"]
      };

      const terms = aliases[incidentKey] || [incidentKey];
      const candidates = lines.filter(line => terms.some(t => line.toLowerCase().includes(t)));

      if (candidates.length > 0) {
        const chosen = candidates[Math.floor(Math.random() * candidates.length)].split('|')[0].trim();
        proTip = `Tip: ${chosen}`;
      }
    } catch (e) {
      console.warn("Pro tip failed:", e.message);
    }
    if (!proTip) proTip = "Tip: Both drivers can improve situational awareness.";

    // 6. Car roles
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

    // 7. Grok verdict
    const humanContext = humanInput ? `HUMAN STEWARD OBSERVATIONS:\n"${humanInput}"\n\n` : "";
    const prompt = `You are a senior, neutral sim-racing steward.
${humanContext}Incident type: ${userType}
Car identification: ${carIdentification}
Fault allocation: Car A${carAIdentifier} ${finalFaultA}% — Car B${carBIdentifier} ${100 - finalFaultA}%
Confidence: ${confidence}

Write a unique, calm, educational verdict in 3–5 sentences.
Start with: "In this ${userType.toLowerCase()}..."
End with: "${proTip}"

Return ONLY valid JSON:
{
  "rule": "relevant rule",
  "fault": { "Car A${carAIdentifier}": "${finalFaultA}%", "Car B${carBIdentifier}": "${100-finalFaultA}%" },
  "car_identification": "${carIdentification}",
  "explanation": "3–5 sentences",
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

    res.status(200).json({
      verdict,
      precedents: precedentCases,     // ← Now perfect, curated, working links
      matches: []                     // Legacy field — kept for compatibility
    });

  } catch (err) {
    clearTimeout(timeout);
    console.error(err);
    res.status(500).json({
      verdict: { rule: "Error", fault: { "Car A": "—", "Car B": "—" }, explanation: "Something went wrong.", pro_tip: "", confidence: "N/A" },
      precedents: [],
      matches: []
    });
  }
}
