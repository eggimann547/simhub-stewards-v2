// pages/api/analyze-intranet.js
// Version: 2.5.0 — Full Reddit Auto-Parse + YouTube + Manual Title (December 03, 2025)

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 29000);

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

    // === 1. Determine effective title & extra context ===
    let effectiveTitle = "Sim racing incident";
    let extraContext = "";  // For Grok prompt

    // Priority order: Manual → Reddit → YouTube → Fallback
    if (manualTitle.trim()) {
      effectiveTitle = manualTitle.trim();
      extraContext = "Manual title provided by steward.";
    }
    else if (url.includes("reddit.com") || url.includes("redd.it")) {
      // Reddit post detected
      try {
        const redditApiUrl = url.replace(/(\.reddit|reddit)\.com/, 'old.reddit.com').replace(/\?.*$/, '') + '.json';
        const redditRes = await fetch(redditApiUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'SimRacingStewardsAI/1.0' }
        });

        if (redditRes.ok) {
          const json = await redditRes.json();
          const post = json[0]?.data?.children?.[0]?.data;
          if (post) {
            effectiveTitle = post.title || effectiveTitle;
            const body = post.selftext || "";
            if (body) extraContext = `Post body: "${body.substring(0, 600)}${body.length > 600 ? '...' : ''}"`;
          }
        }
      } catch (e) {
        console.warn("Reddit fetch failed:", e.message);
      }
    }
    else if (url.includes("youtube.com") || url.includes("youtu.be")) {
      // YouTube fallback (existing)
      const videoId = url.match(/(?:v=|youtu\.be\/|embed\/)([0-9A-Za-z_-]{11})/)?.[1];
      if (videoId) {
        try {
          const oembed = await fetch(`https://www.youtube.com/oembed?url=${url}&format=json`, { signal: controller.signal });
          if (oembed.ok) {
            const data = await oembed.json();
            effectiveTitle = data.title || effectiveTitle;
          }
        } catch {}
      }
    }

    // === 2. Incident type mapping (unchanged + brake check) ===
    const typeMap = {
      "Divebomb / Late lunge": "divebomb",
      "Weave / Block / Defending move": "weave block",
      "Unsafe rejoin": "unsafe rejoin",
      "Vortex exit / Draft lift-off": "vortex exit",
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

    // === 3. CSV Precedent Matching (uses effectiveTitle + human notes) ===
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

        const titleWords = effectiveTitle.toLowerCase().match(/\w+/g) || [];
        const inputWords = humanInput.toLowerCase().match(/\w+/g) || [];

        for (const row of parsed) {
          if (!row.title) continue;
          const rowText = `${row.title} ${row.reason || ''} ${row.ruling || ''}`.toLowerCase();
          let score = 0;

          if (rowText.includes(incidentKey)) score += 15;
          inputWords.slice(0, 12).forEach(w => { if (rowText.includes(w)) score += 3; });
          titleWords.slice(0, 8).forEach(w => { if (rowText.includes(w)) score += 1.5; });

          if (score > 0) matches.push({ ...row, score });
        }

        matches.sort((a, b) => b.score - a.score);
        matches = matches.slice(0, 5);

        const valid = matches.map(m => parseFloat(m.fault_pct_driver_a)).filter(n => !isNaN(n));
        const avg = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 60;
        finalFaultA = Math.round(avg * 0.75 + 50 * 0.25);
        confidence = matches.length >= 4 ? "Very High" : matches.length >= 2 ? "High" : matches.length >= 1 ? "Medium" : "Low";
      } catch (e) {
        console.error("CSV error:", e);
      }
    }

    finalFaultA = Math.min(98, Math.max(2, finalFaultA));

    // === 4. Pro Tip & Car Roles (unchanged) ===
    let proTip = "Both drivers can improve situational awareness.";
    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      const tipRes = await fetch(`${baseUrl}/tips2.txt`, { signal: controller.signal });
      if (tipRes.ok) {
        const lines = (await tipRes.text()).split('\n').filter(l => l.includes('|'));
        const candidates = lines.filter(l => l.toLowerCase().includes(incidentKey));
        if (candidates.length) proTip = candidates[Math.floor(Math.random() * candidates.length)].split('|')[0].trim();
      }
    } catch {}

    let carARole = "the overtaking car", carBRole = "the defending car";
    switch (incidentKey) {
      case "weave block": [carARole, carBRole] = ["the defending car", "the overtaking car"]; break;
      case "unsafe rejoin": [carARole, carBRole] = ["the rejoining car", "the on-track car"]; break;
y: "the braking car", "the following car"]; break;
      case "racing incident": [carARole, carBRole] = ["Car A", "Car B"]; break;
    }

    const carAId = carA ? ` (${carA.trim()})` : "";
    const carBId = carB ? ` (${carB.trim()})` : "";
    const carIdentification = `Car A${carAId} is ${carARole}. Car B${carBId} is ${carBRole}.`;

    // === 5. Final Grok Prompt ===
    const humanContext = humanInput ? `HUMAN STEWARD OBSERVATIONS (must be reflected exactly):\n"${humanInput}"\n\n` : "";
    const sourceContext = effectiveTitle !== "Sim racing incident" ? `SUBMITTER TITLE: "${effectiveTitle}"\n${extraContext ? extraContext + "\n" : ""}` : "";

    const prompt = `${humanContext}${sourceContext}
You are a senior, neutral sim-racing steward.

Incident type: ${userType}
Car roles: ${carIdentification}
Fault split: Car A${carAId} ${finalFaultA}% — Car B${carBId} ${100 - finalFaultA}%
Confidence: ${confidence}

Write a calm, professional 3–5 sentence verdict.
Start with: "In this ${userType.toLowerCase()}..."
End with this exact pro tip: "${proTip}"

Return ONLY valid JSON with these keys:
{
  "rule": "relevant rule(s)",
  "fault": { "Car A${carAId}": "${finalFaultA}%", "Car B${carBId}": "${100-finalFaultA}%" },
  "car_identification": "${carIdentification}",
  "explanation": "3–5 sentences",
  "pro_tip": "${proTip}",
  "confidence": "${confidence}"
}`;

    const grokRes = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-3',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 700,
        temperature: 0.7
      })
    });

    clearTimeout(timeout);
    const data = await grokRes.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    let verdict = {
      rule: "iRacing Sporting Code / LFM Regulations",
      fault: { [`Car A${carAId}`]: `${finalFaultA}%`, [`Car B${carBId}`]: `${100-finalFaultA}%` },
      car_identification: carIdentification,
      explanation: `In this ${userType.toLowerCase()}, contact occurred. ${proTip}`,
      pro_tip: proTip,
      confidence
    };

    try { Object.assign(verdict, JSON.parse(raw)); } catch {}

    res.status(200).json({ verdict, matches: matches.slice(0, 5) });

  } catch (err) {
    clearTimeout(timeout);
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}
