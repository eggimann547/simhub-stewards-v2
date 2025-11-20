// api/analyze-intranet.js
// Version: 2.1.0 — Human-in-the-loop + Car A/B Identifiers
// Date: 2025-11-20
// Features:
//   • Human selects incident type (no title bias)
//   • Optional short description
//   • Optional Car A & Car B identifiers (e.g. "Red Porsche #24")
//   • Output: "Car A (Red Porsche #24) is the overtaking car..."

import { z } from 'zod';
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';

const schema = z.object({
  url: z.string().url(),
  incidentType: z.string().min(1, "Please select an incident type"),
  description: z.string().optional().default(""),
  carA: z.string().optional().default(""),
  carB: z.string().optional().default("")
});

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: options.signal });
      if (res.ok) return res;
      if (i === retries - 1) throw new Error(`Fetch failed: ${res.status}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    } catch (e) {
      if (i === retries - 1) throw e;
    }
  }
}

export async function POST(req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const { url, incidentType: userType, description, carA, carB } = schema.parse(await req.json());

    // 1. Fetch video title (only for display — NOT used in logic)
    const videoId = url.match(/v=([0-9A-Za-z_-]{11})/)?.[1] || url.match(/youtu\.be\/([0-9A-Za-z_-]{11})/)?.[1] || '';
    let title = 'Sim racing incident';
    if (videoId) {
      try {
        const oembed = await fetch(`https://www.youtube.com/oembed?url=${url}&format=json`, { signal: controller.signal });
        if (oembed.ok) title = (await oembed.json()).title || title;
      } catch {}
    }

    // 2. Map human-selected type to internal key
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

    // 3. CSV lookup using human-selected type + description
    let matches = [];
    let finalFaultA = 60;
    try {
      const csvPath = path.join(process.cwd(), 'public', 'simracingstewards_28k.csv');
      const text = fs.readFileSync(csvPath, 'utf8');
      const parsed = Papa.parse(text, { header: true }).data;

      for (const row of parsed) {
        if (!row.title) continue;
        const rowText = `${row.title} ${row.reason || ''} ${row.ruling || ''}`.toLowerCase();
        let score = 0;
        if (rowText.includes(incidentKey)) score += 10;
        if (description && rowText.includes(description.toLowerCase())) score += 8;
        if (score > 0) matches.push({ ...row, score });
      }
      matches.sort((a, b) => b.score - a.score);
      matches = matches.slice(0, 5);

      const validFaults = matches.map(m => parseFloat(m.fault_pct_driver_a)).filter(f => !isNaN(f));
      const csvFaultA = validFaults.length > 0 ? validFaults.reduce((a, b) => a + b, 0) / validFaults.length : 60;
      finalFaultA = Math.round(csvFaultA * 0.7 + 50 * 0.3);
    } catch (e) {}

    finalFaultA = Math.min(98, Math.max(2, finalFaultA));
    const confidence = matches.length >= 4 ? 'Very High' : matches.length >= 2 ? 'High' : matches.length >= 1 ? 'Medium' : 'Low';

    // 4. Tip from tips2.txt
    let proTip = "Both drivers can improve situational awareness.";
    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      const res = await fetch(`${baseUrl}/tips2.txt`, { signal: controller.signal });
      if (res.ok) {
        const lines = (await res.text()).split('\n').map(l => l.trim()).filter(l => l && l.includes('|'));
        const candidates = lines.filter(l =>
          l.toLowerCase().includes(incidentKey) ||
          (description && l.toLowerCase().includes(description.toLowerCase().split(' ')[0]))
        );
        if (candidates.length > 0) {
          proTip = candidates[Math.floor(Math.random() * candidates.length)].split('|')[0].trim();
        } else if (lines.length > 0) {
          proTip = lines[Math.floor(Math.random() * lines.length)].split('|')[0].trim();
        }
      }
    } catch {}

    // 5. Car roles + optional identifiers
    let carARole = "the overtaking car", carBRole = "the defending car";
    switch (incidentKey) {
      case 'weave block': carARole = "the defending car"; carBRole = "the overtaking car"; break;
      case 'unsafe rejoin': carARole = "the rejoining car"; carBRole = "the on-track car"; break;
      case 'netcode': carARole = "the teleporting car"; carBRole = "the affected car"; break;
      case 'used as barrier': carARole = "the car using another as a barrier"; carBRole = "the car used as a barrier"; break;
      case 'pit maneuver': carARole = "the car initiating the spin"; carBRole = "the car being spun"; break;
      case 'intentional wreck': carARole = "the aggressor"; carBRole = "the victim"; break;
      case 'racing incident': carARole = "Car A"; carBRole = "Car B"; break;
    }

    const carAIdentifier = carA ? ` (${carA.trim()})` : "";
    const carBIdentifier = carB ? ` (${carB.trim()})` : "";
    const carIdentification = `Car A${carAIdentifier} is ${carARole}. Car B${carBIdentifier} is ${carBRole}.`;

    // 6. Grok prompt — now includes car identifiers
    const userContext = description ? `Human description: "${description}"\n` : "";
    const prompt = `You are a senior, neutral sim-racing steward.

Video URL: ${url}
Video title (context only): "${title}"
Incident type: ${userType}
${userContext}
Car roles: ${carIdentification}
Suggested fault: Car A ${finalFaultA}%, Car B ${100-finalFaultA}%
Confidence: ${confidence}

Write a unique, calm, educational verdict in 3–5 sentences.
Start with: "In this ${userType.toLowerCase()}..."
Use Car A${carAIdentifier} and Car B${carBIdentifier} throughout.
Include one actionable lesson.

Return ONLY valid JSON:
{
  "rule": "relevant rule",
  "fault": { "Car A": "${finalFaultA}%", "Car B": "${100-finalFaultA}%" },
  "car_identification": "${carIdentification}",
  "explanation": "3–5 unique sentences",
  "overtake_tip": "specific tip for Car A${carAIdentifier}",
  "defend_tip": "specific tip for Car B${carBIdentifier}",
  "spotter_advice": { "overtaker": "tip", "defender": "tip" },
  "confidence": "${confidence}"
}`;

    const grokRes = await fetchWithRetry('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'grok-3',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 700,
        temperature: 0.8
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const data = await grokRes.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    let verdict = {
      rule: "iRacing Sporting Code / ACC Regulations",
      fault: { "Car A": `${finalFaultA}%`, "Car B": `${100-finalFaultA}%` },
      car_identification: carIdentification,
      explanation: `In this ${userType.toLowerCase()}, contact occurred between Car A${carAIdentifier} and Car B${carBIdentifier}. ${proTip}`,
      overtake_tip: "Establish overlap before committing.",
      defend_tip: "Hold your line predictably.",
      spotter_advice: { overtaker: "Wait for clear overlap.", defender: "Don't overreact." },
      confidence
    };

    try {
      const parsed = JSON.parse(raw);
      verdict = { ...verdict, ...parsed };
    } catch (e) {}

    verdict.explanation += `\n\n${proTip}`;
    verdict.pro_tip = proTip;
    verdict.video_title = title;

    return Response.json({ verdict, matches });

  } catch (err) {
    clearTimeout(timeout);
    return Response.json({
      verdict: {
        rule: "Error",
        fault: { "Car A": "—", "Car B": "—" },
        car_identification: "Unable to process",
        explanation: "Something went wrong — please try again.",
        overtake_tip: "", defend_tip: "", spotter_advice: { overtaker: "", defender: "" },
        confidence: "N/A"
      },
      matches: []
    }, { status: 500 });
  }
}
