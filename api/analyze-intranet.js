// api/analyze-intranet.js
// Version: 1.0.0
// Date:    2025-11-17
import { z } from 'zod';
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';

const schema = z.object({ url: z.string().url() });

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
    const { url } = schema.parse(await req.json());

    // 1. YouTube title
    const videoId = url.match(/v=([0-9A-Za-z_-]{11})/)?.[1] || url.match(/youtu\.be\/([0-9A-Za-z_-]{11})/)?.[1] || '';
    let title = 'incident';
    if (videoId) {
      try {
        const oembed = await fetch(`https://www.youtube.com/oembed?url=${url}&format=json`, { signal: controller.signal });
        if (oembed.ok) title = (await oembed.json()).title || 'incident';
      } catch {}
    }

    const lower = title.toLowerCase();
    let incidentType = 'general contact';
    if (lower.includes('dive') || lower.includes('brake')) incidentType = 'divebomb';
    else if (lower.includes('vortex') || lower.includes('exit')) incidentType = 'vortex exit';
    else if (lower.includes('weave') || lower.includes('block')) incidentType = 'weave block';
    else if (lower.includes('rejoin') || lower.includes('spin')) incidentType = 'unsafe rejoin';
    else if (lower.includes('netcode') || lower.includes('lag') || lower.includes('teleport')) incidentType = 'netcode';
    else if (lower.includes('barrier') || lower.includes('wall') || lower.includes('used you')) incidentType = 'used as barrier';
    else if (lower.includes('pit') && lower.includes('maneuver')) incidentType = 'pit maneuver';

    // 2. CSV + fault
    let matches = [];
    let finalFaultA = 60;
    try {
      const csvPath = path.join(process.cwd(), 'public', 'simracingstewards_28k.csv');
      const text = fs.readFileSync(csvPath, 'utf8');
      const parsed = Papa.parse(text, { header: true }).data;
      const queryWords = title.toLowerCase().split(' ').filter(w => w.length > 2);
      for (const row of parsed) {
        if (!row.title) continue;
        const rowText = `${row.title} ${row.reason || ''} ${row.ruling || ''}`.toLowerCase();
        let score = 0;
        queryWords.forEach(w => { if (rowText.includes(w)) score += 3; });
        if (rowText.includes(incidentType)) score += 5;
        if (score > 0) matches.push({ ...row, score });
      }
      matches.sort((a, b) => b.score - a.score);
      matches = matches.slice(0, 5);
      const validFaults = matches.map(m => parseFloat(m.fault_pct_driver_a)).filter(f => !isNaN(f));
      const csvFaultA = validFaults.length > 0 ? validFaults.reduce((a, b) => a + b, 0) / validFaults.length : 60;
      finalFaultA = Math.round(csvFaultA * 0.5 + 70 * 0.5);
    } catch (e) {}

    finalFaultA = Math.min(98, Math.max(5, finalFaultA));
    const confidence = matches.length >= 3 ? 'High' : matches.length >= 1 ? 'Medium' : 'Low';

    // 3. Random tip
    let proTip = "Both drivers can improve situational awareness.";
    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      const res = await fetch(`${baseUrl}/tips2.txt`, { signal: controller.signal });
      if (res.ok) {
        const lines = (await res.text()).split('\n').map(l => l.trim()).filter(l => l && l.includes('|'));
        if (lines.length) proTip = lines[Math.floor(Math.random() * lines.length)].split('|')[0].trim();
      }
    } catch {}

    // 4. Car roles
    let carA = "the passing car", carB = "the defending car";
    if (incidentType === 'weave block') { carA = "the defending car"; carB = "the passing car"; }
    else if (incidentType === 'unsafe rejoin') { carA = "the rejoining car"; carB = "the on-track car"; }
    else if (incidentType === 'netcode') { carA = "the teleporting car"; carB = "the affected car"; }
    else if (incidentType === 'used as barrier') { carA = "the car using another as a barrier"; carB = "the car used as a barrier"; }
    else if (incidentType === 'pit maneuver') { carA = "the car initiating the spin"; carB = "the car being spun"; }

    const carIdentification = `Car A is ${carA}. Car B is ${carB}.`;

    // 5. Grok prompt – forces clean phrasing
    const prompt = `You are a neutral sim racing steward.
Video: ${url}
Title: "${title}"
Incident type: ${incidentType}
${carIdentification}
Fault: Car A ${finalFaultA}%, Car B ${100-finalFaultA}%
Confidence: ${confidence}
Tip: "${proTip}"

Start your explanation with: "In this incident involving"

Return ONLY valid JSON with this exact structure:
{
  "rule": "relevant rule",
  "fault": { "Car A": "${finalFaultA}%", "Car B": "${100-finalFaultA}%" },
  "car_identification": "${carIdentification}",
  "explanation": "Start with 'In this incident involving' – 3-4 sentences using Car A and Car B",
  "overtake_tip": "short tip",
  "defend_tip": "short tip",
  "spotter_advice": { "overtaker": "short", "defender": "short" },
  "confidence": "${confidence}"
}`;

    const grokRes = await fetchWithRetry('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'grok-3', messages: [{ role: 'user', content: prompt }], max_tokens: 600, temperature: 0.7 }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const data = await grokRes.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    // 6. Final verdict
    let verdict = {
      rule: "iRacing Sporting Code",
      fault: { "Car A": `${finalFaultA}%`, "Car B": `${100-finalFaultA}%` },
      explanation: `In this incident involving ${incidentType.toLowerCase()}, contact occurred. ${proTip}`,
      overtake_tip: "Establish overlap before committing.",
      defend_tip: "Hold your line firmly.",
      spotter_advice: { overtaker: "Listen to spotter.", defender: "React immediately." },
      confidence
    };

    try {
      const parsed = JSON.parse(raw);
      verdict = { ...verdict, ...parsed };
    } catch (e) {}

    // Guarantee clean start + support all frontend keys
    if (!verdict.explanation.toLowerCase().startsWith("in this incident involving")) {
      verdict.explanation = `In this incident involving ${incidentType.toLowerCase()}, ${verdict.explanation}`;
    }

    verdict.car_identification = carIdentification;
    verdict.car_roles = carIdentification;
    verdict.carRoles = carIdentification;

    verdict.explanation += `\n\n${proTip}`;
    verdict.pro_tip = proTip;

    return Response.json({ verdict, matches });
  } catch (err) {
    clearTimeout(timeout);
    return Response.json({
      verdict: {
        rule: "Error", fault: { "Car A": "0%", "Car B": "0%" },
        car_identification: "Unable to determine roles", car_roles: "Unable to determine roles",
        explanation: "Temporary issue – please try again",
        overtake_tip: "", defend_tip: "", spotter_advice: { overtaker: "", defender: "" },
        confidence: "N/A"
      },
      matches: []
    }, { status: 500 });
  }
}
