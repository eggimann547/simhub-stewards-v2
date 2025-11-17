// api/analyze-intranet.js
import { z } from 'zod';
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';

const schema = z.object({ url: z.string().url() });

export async function POST(req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const { url } = schema.parse(await req.json());

    // === 1. YouTube Title & Incident Type ===
    const videoId = url.match(/v=([0-9A-Za-z_-]{11})/)?.[1] || url.match(/youtu\.be\/([0-9A-Za-z_-]{11})/)?.[1] || '';
    let title = 'incident';
    let incidentType = 'general contact';

    if (videoId) {
      try {
        const oembed = await fetch(`https://www.youtube.com/oembed?url=${url}&format=json`, { signal: controller.signal });
        if (oembed.ok) {
          const data = await oembed.json();
          title = data.title || 'incident';
        }
      } catch (e) {
        console.log('oEmbed failed (non-critical):', e.message);
      }

      const lower = title.toLowerCase();
      if (lower.includes('dive') || lower.includes('brake')) incidentType = 'divebomb';
      else if (lower.includes('vortex') || lower.includes('exit')) incidentType = 'vortex exit';
      else if (lower.includes('weave') || lower.includes('block')) incidentType = 'weave block';
      else if (lower.includes('rejoin') || lower.includes('spin')) incidentType = 'unsafe rejoin';
      else if (lower.includes('apex') || lower.includes('cut')) incidentType = 'track limits';
      else if (lower.includes('netcode') || lower.includes('lag') || lower.includes('teleport')) incidentType = 'netcode';
      else if (lower.includes('barrier') || lower.includes('wall') || lower.includes('used you')) incidentType = 'used as barrier';
      else if (lower.includes('pit') && lower.includes('maneuver')) incidentType = 'pit maneuver';
    }

    // === 2. FAULT ENGINE ===
    let matches = [];
    let finalFaultA = 60;
    let ruleMatch = null;

    const BMW_RULES = [
      { keywords: ['dive', 'late', 'lunge', 'brake', 'underbraking', 'punting'], faultA: 90, desc: "Under-braking and punting (BMW SIM GT Rule 5)" },
      { keywords: ['block', 'weave', 'reactionary', 'move under braking'], faultA: 20, desc: "Blocking (BMW SIM GT Rule 2)" },
      { keywords: ['rejoin', 'off-track', 'merge', 'spin', 'dropped wheels'], faultA: 85, desc: "Unsafe rejoin (BMW SIM GT Rule 7)" },
      { keywords: ['side-by-side', 'overlap', 'apex', 'cut', 'door open', 'left the door open', 'closed the door'], faultA: 95, desc: "Side-by-side rule violation (BMW SIM GT Rule 4)" },
      { keywords: ['blue flag', 'yield', 'lapped', 'faster car'], faultA: 70, desc: "Failure to yield blue flag (BMW SIM GT Rule 3)" },
      { keywords: ['vortex', 'exit', 'overtake', 'closing'], faultA: 88, desc: "Vortex of Danger (SCCA Appendix P)" },
      { keywords: ['track limits', 'cut', 'white line', 'off-track'], faultA: 75, desc: "Track limits violation (iRacing 8.1.1.8)" },
      { keywords: ['netcode', 'lag', 'teleport', 'desync'], faultA: 50, desc: "Netcode-related incident (No fault assignable)" },
      { keywords: ['barrier', 'wall', 'used you', 'used as barrier'], faultA: 95, desc: "Using another car as a barrier (Intentional contact)" },
      { keywords: ['pit', 'maneuver', 'pit maneuver', 'spin out'], faultA: 98, desc: "Pit maneuver (Intentional wrecking)" }
    ];

    const lowerTitle = title.toLowerCase();
    for (const rule of BMW_RULES) {
      if (rule.keywords.some(k => lowerTitle.includes(k))) {
        ruleMatch = rule;
        break;
      }
    }

    const heuristicMap = {
      'divebomb': 92, 'vortex exit': 88, 'weave block': 15, 'unsafe rejoin': 80,
      'track limits': 70, 'netcode': 50, 'used as barrier': 95, 'pit maneuver': 98
    };
    const heuristicFaultA = heuristicMap[incidentType] || 70;
    const ruleFaultA = ruleMatch?.faultA || 60;

    // CSV Matching
    try {
      const csvPath = path.join(process.cwd(), 'public', 'simracingstewards_28k.csv');
      const text = fs.readFileSync(csvPath, 'utf8');
      const parsed = Papa.parse(text, { header: true }).data;
      const queryWords = title.toLowerCase().split(' ').filter(w => w.length > 2);

      for (const row of parsed) {
        if (!row.title || !row.reason) continue;
        const rowText = `${row.title} ${row.reason} ${row.ruling || ''}`.toLowerCase();
        let score = 0;
        queryWords.forEach(w => { if (rowText.includes(w)) score += 3; });
        if (rowText.includes(incidentType)) score += 5;
        if (score > 0) matches.push({ ...row, score });
      }
      matches.sort((a, b) => b.score - a.score);
      matches = matches.slice(0, 5);

      const validFaults = matches.map(m => parseFloat(m.fault_pct_driver_a)).filter(f => !isNaN(f));
      const csvFaultA = validFaults.length > 0 ? validFaults.reduce((a, b) => a + b, 0) / validFaults.length : 60;
      finalFaultA = Math.round((csvFaultA * 0.4) + (ruleFaultA * 0.4) + (heuristicFaultA * 0.2));
    } catch (e) {
      console.log('CSV failed:', e);
    }

    finalFaultA = Math.min(98, Math.max(5, finalFaultA));
    const confidence = matches.length >= 3 && ruleMatch ? 'High' : matches.length >= 1 || ruleMatch ? 'Medium' : 'Low';
    const selectedRule = ruleMatch?.desc || 'iRacing Sporting Code';
    const titleForPrompt = title === 'incident' ? 'incident' : `"${title}"`;

    // === 3. SAFE tips2.txt LOADER ===
    let proTip = '';
    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      const tipsRes = await fetch(`${baseUrl}/tips2.txt`, { 
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' }
      });

      if (tipsRes.ok) {
        const text = await tipsRes.text();
        const lines = text.split('\n');
        const tips = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.includes('|')) continue;

          const parts = trimmed.split('|').map(p => p.trim());
          if (parts.length < 2) continue;

          const tip = parts[0];
          const category = parts[1].toLowerCase();
          const source = parts.slice(2).join(' | ').trim() || '(Stewards AI)';

          if (tip && category) {
            tips.push({ tip, category, source });
          }
        }

        if (tips.length > 0) {
          const map = {
            divebomb: ['braking', 'overtaking'],
            'vortex exit': ['overtaking'],
            'weave block': ['defense'],
            'unsafe rejoin': ['rejoin', 'general'],
            'track limits': ['general'],
            netcode: ['netcode'],
            'used as barrier': ['defense'],
            'pit maneuver': ['general'],
            'general contact': ['general', 'defense', 'vision']
          };
          const targets = map[incidentType] || ['general'];
          const matched = tips.filter(t => targets.includes(t.category));
          const pool = matched.length > 0 ? matched : tips;
          const selected = pool[Math.floor(Math.random() * pool.length)];
          proTip = selected.source ? `${selected.tip} ${selected.source}` : selected.tip;
        }
      }
    } catch (e) {
      console.log('tips2.txt failed (non-critical):', e.message);
    }

    // === 4. PROMPT ===
    const prompt = `You are a neutral, educational sim racing steward.
Video: ${url}
Title: ${titleForPrompt}
Type: ${incidentType}
Confidence: ${confidence}
RULE: ${selectedRule}
${proTip ? `Include: "${proTip}"` : ''}
Tone: calm, educational. Teach, don’t blame.
1. Quote the rule.
2. State fault %.
3. Explain in 3–4 sentences.
4. Overtaking tip for Car A.
5. Defense tip for Car B.
6. Spotter advice.
RETURN ONLY JSON:
{
  "rule": "...",
  "fault": { "Car A": "${finalFaultA}%", "Car B": "${100 - finalFaultA}%" },
  "car_identification": "Car A: Overtaker. Car B: Defender.",
  "explanation": "...",
  "overtake_tip": "...",
  "defend_tip": "...",
  "spotter_advice": { "overtaker": "...", "defender": "..." },
  "confidence": "${confidence}"
}`;

    // === 5. Call Grok ===
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
        temperature: 0.7
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!grok.ok) throw new Error(`Grok: ${grok.status}`);
    const data = await grok.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    // === 6. Parse & Finalize ===
    let verdict = {
      rule: selectedRule,
      fault: { "Car A": `${finalFaultA}%`, "Car B": `${100 - finalFaultA}%` },
      car_identification: "Car A: Overtaker. Car B: Defender.",
      explanation: `Contact in ${incidentType}. Both can improve.`,
      overtake_tip: "Brake earlier.",
      defend_tip: "Hold line.",
      spotter_advice: { overtaker: "Listen to spotter.", defender: "React fast." },
      confidence
    };

    try {
      const parsed = JSON.parse(raw);
      verdict = { ...verdict, ...parsed };
    } catch (e) {
      console.log('Parse failed:', e);
    }

    if (proTip) {
      verdict.explanation += `\n\n${proTip}`;
      verdict.pro_tip = proTip;
    }

    return Response.json({ verdict, matches });
  } catch (err) {
    clearTimeout(timeout);
    return Response.json({
      verdict: {
        rule: "Error", fault: { "Car A": "0%", "Car B": "0%" },
        explanation: err.message || "Server error",
        overtake_tip: "", defend_tip: "", spotter_advice: { overtaker: "", defender: "" },
        confidence: "N/A"
      },
      matches: []
    }, { status: 500 });
  }
}
