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
    const videoId = url.match(/v=([0-9A-Za-z_-]{11})/)?.[1] || '';
    let title = 'incident';
    let incidentType = 'general contact';

    if (videoId) {
      try {
        const oembed = await fetch(`https://www.youtube.com/oembed?url=${url}&format=json`, { signal: controller.signal });
        if (oembed.ok) {
          const data = await oembed.json();
          title = data.title || 'incident';
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
      } catch (e) {
        console.log('oEmbed failed:', e);
      }
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

    // CSV
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

    // === 3. LOAD tips2.txt (SAFE + SMART) ===
    let proTip = '';
    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      const tipsRes = await fetch(`${baseUrl}/tips2.txt`, { signal: controller.signal });
      if (tipsRes.ok) {
        const text = await tipsRes.text();
        const tips = text.split('\n')
          .map(l => l.trim())
          .filter(l => l && l.includes('|'))
          .map(l => {
            const [tip, cat, src] = l.split('|').map(s => s.trim());
            return { tip, category: cat?.toLowerCase(), source: src };
          })
          .filter(t => t.tip && t.category);

        if (tips.length > 0) {
          const map = {
            divebomb: ['braking', 'overtaking'],
            'vortex exit': ['overtaking'],
            'weave block': ['defense'],
            'unsafe rejoin': ['general'],
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
      console.log('tips2.txt failed (non-critical):', e);
    }

    // === 4. PROMPT: FULL A + B HYBRID ===
    const prompt = `You are a neutral, educational sim racing steward for r/simracingstewards.
Video: ${url}
Title: ${titleForPrompt}
Type: ${incidentType}
Confidence: ${confidence}
RULE: ${selectedRule}
${proTip ? `Include this pro tip naturally in the explanation: "${proTip}"` : ''}
Tone: calm, educational, community-focused. Teach, don’t blame.
1. Quote the rule.
2. State fault %.
3. Explain what happened in 3–4 detailed sentences.
4. Give one actionable overtaking tip for Car A.
5. Give one actionable defense tip for Car B.
6. Always include spotter advice.
7. Make it educational and helpful.
RETURN ONLY JSON:
{
  "rule": "Text",
  "fault": { "Car A": "${finalFaultA}%", "Car B": "${100 - finalFaultA}%" },
  "car_identification": "Car A: Overtaker. Car B: Defender.",
  "explanation": "3–4 sentence summary\\n\\nTip A: ...\\nTip B: ...\\n\\n${proTip ? proTip : ''}",
  "overtake_tip": "Actionable tip for A",
  "defend_tip": "Actionable tip for B",
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
        temperature: 0.7,
        top_p: 0.9
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
      explanation: `Contact occurred in a ${incidentType} incident. The overtaking car must complete passes safely. Both drivers can improve with better awareness.\n\nTip A: Brake earlier when no overlap.\nTip B: Hold your line firmly.`,
      overtake_tip: "Establish overlap before committing.",
      defend_tip: "Stay predictable — don’t weave.",
      spotter_advice: {
        overtaker: "Listen to spotter for defender's line before committing.",
        defender: "React to 'car inside!' call immediately."
      },
      confidence
    };

    try {
      const parsed = JSON.parse(raw);
      verdict = { ...verdict, ...parsed };
    } catch (e) {
      console.log('Parse failed:', e);
    }

    // Ensure pro tip is in explanation
    if (proTip && !verdict.explanation.includes(proTip)) {
      verdict.explanation += `\n\n${proTip}`;
    }
    verdict.pro_tip = proTip;

    return Response.json({ verdict, matches });
  } catch (err) {
    clearTimeout(timeout);
    return Response.json({
      verdict: {
        rule: "Error", fault: { "Car A": "0%", "Car B": "0%" },
        explanation: err.message, confidence: "N/A"
      },
      matches: []
    }, { status: 500 });
  }
}
