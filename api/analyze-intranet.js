// pages/api/analyze-intranet.js
// Version: 2.2.0 — Full Human-in-the-Loop Steward Mode (Pages Router)
// Date: 2025-12-02
// Works perfectly with your new /steward page + old public form

import { z } from 'zod';
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';

const schema = z.object({
  url: z.string().url(),
  incidentType: z.string().min(1, "Please select an incident type"),
  carA: z.string().optional().default(""),
  carB: z.string().optional().default(""),
  stewardNotes: z.string().optional().default(""),           // ← NEW – long human notes
  overrideFaultA: z.coerce.number().min(0).max(100).optional().nullable(), // ← NEW – full override
  description: z.string().optional().default("")             // kept for backward compatibility
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
    const body = req.body;
    const {
      url,
      incidentType: userType,
      carA = "",
      carB = "",
      stewardNotes = "",
      overrideFaultA = null,
      description = ""
    } = schema.parse(body);

    const humanInput = stewardNotes.trim() || description.trim();

    // 1. Title (display only)
    const videoId = url.match(/(?:v=|youtu\.be\/)([0-9A-Za-z_-]{11})/)?.[1] || '';
    let title = 'Sim racing incident';
    if (videoId) {
      try {
        const oembed = await fetch(`https://www.youtube.com/oembed?url=${url}&format=json`, { signal: controller.signal });
        if (oembed.ok) title = (await oembed.json()).title || title;
      } catch {}
    }

    // 2. Incident key mapping
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
      "Racing incident (no fault)": "racing incident"
    };
    const incidentKey = typeMap[userType] || "general contact";

    // 3. Fault calculation
    let finalFaultA = 60;
    let confidence = "Low";
    let matches = [];

    if (overrideFaultA !== null) {
      // Steward override wins everything
      finalFaultA = Math.round(overrideFaultA);
      confidence = "Human Override";
    } else {
      // Existing CSV logic (unchanged)
      try {
        const csvPath = path.join(process.cwd(), 'public', 'simracingstewards_28k.csv');
        const text = fs.readFileSync(csvPath, 'utf8');
        const parsed = Papa.parse(text, { header: true }).data;

        for (const row of parsed) {
          if (!row.title) continue;
          const rowText = `${row.title} ${row.reason || ''} ${row.ruling || ''}`.toLowerCase();
          let score = 0;
          if (rowText.includes(incidentKey)) score += 10;
          if (humanInput && rowText.includes(humanInput.toLowerCase().substring(0, 30))) score += 8;
          if (score > 0) matches.push({ ...row, score });
        }
        matches.sort((a, b) => b.score - a.score);
        matches = matches.slice(0, 5);

        const validFaults = matches.map(m => parseFloat(m.fault_pct_driver_a)).filter(f => !isNaN(f));
        const csvFaultA = validFaults.length > 0 ? validFaults.reduce((a, b) => a + b, 0) / validFaults.length : 60;
        finalFaultA = Math.round(csvFaultA * 0.7 + 50 * 0.3);
        confidence = matches.length >= 4 ? 'Very High' : matches.length >= 2 ? 'High' : matches.length >= 1 ? 'Medium' : 'Low';
      } catch (e) {
        console.error(e);
      }
    }

    finalFaultA = Math.min(98, Math.max(2, finalFaultA));

    // 4. Pro tip
    let proTip = "Both drivers can improve situational awareness.";
    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      const tipRes = await fetch(`${baseUrl}/tips2.txt`, { signal: controller.signal });
      if (tipRes.ok) {
        const lines = (await tipRes.text()).split('\n').map(l => l.trim()).filter(l => l.includes('|'));
        const candidates = lines.filter(l =>
          l.toLowerCase().includes(incidentKey) ||
          (humanInput && l.toLowerCase().includes(humanInput.toLowerCase().split(' ')[0]))
        );
        if (candidates.length) proTip = candidates[Math.floor(Math.random() * candidates.length)].split('|')[0].trim();
      }
    } catch {}

    // 5. Car roles & identifiers
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

    // 6. Grok prompt – human notes are authoritative
    const humanContext = humanInput ? `HUMAN STEWARD OBSERVATIONS (must be reflected exactly, no contradictions):\n"${humanInput}"\n\n` : "";

    const prompt = `You are a senior, neutral sim-racing steward.

${humanContext}Video: ${url}
Incident type: ${userType}
Car roles: ${carIdentification}
Fault split: Car A${carAIdentifier} ${finalFaultA}% — Car B${carBIdentifier} ${100 - finalFaultA}%
Confidence: ${confidence}

Write a calm, professional verdict in 3–5 sentences.
Start with: "In this ${userType.toLowerCase()}..."
Use the exact car identifiers throughout.
If human observations are provided above, base everything on them.
End with this exact pro tip: "${proTip}"

Return ONLY valid JSON with these exact keys:
{
  "rule": "relevant rule(s)",
  "fault": { "Car A${carAIdentifier}": "${finalFaultA}%", "Car B${carBIdentifier}": "${100-finalFaultA}%" },
  "car_identification": "${carIdentification}",
  "explanation": "3–5 sentences",
  "pro_tip": "${proTip}",
  "confidence": "${confidence}"
}`;

    const grokRes = await fetchWithRetry('https://api.x.ai/v1/chat/completions', {
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

    verdict.video_title = title;

    res.status(200).json({ verdict, matches: matches.slice(0, 5) });

  } catch (err) {
    clearTimeout(timeout);
    console.error(err);
    res.status(500).json({
      verdict: {
        rule: "Error",
        fault: { "Car A": "—", "Car B": "—" },
        car_identification: "Processing failed",
        explanation: "Something went wrong – try again.",
        pro_tip: "",
        confidence: "N/A"
      },
      matches: []
    });
  }
}
