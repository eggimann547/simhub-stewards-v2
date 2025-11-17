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

    // === 2. ENHANCED FAULT ENGINE ===
    let matches = [];
    let finalFaultA = 60;

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

    let ruleMatch = null;
    let ruleScore = 0;
    const lowerTitle = title.toLowerCase();
    for (const rule of BMW_RULES) {
      const matchCount = rule.keywords.filter(k => lowerTitle.includes(k)).length;
      if (matchCount > 0) {
        const weighted = matchCount * 10;
        if (weighted > ruleScore) {
          ruleScore = weighted;
          ruleMatch = rule;
        }
      }
    }
    const ruleFaultA = ruleMatch ? ruleMatch.faultA : 60;

    const heuristicMap = {
      'divebomb': 92, 'vortex exit': 88, 'weave block': 15, 'unsafe rejoin': 80,
      'track limits': 70, 'netcode': 50, 'used as barrier': 95, 'pit maneuver': 98
    };
    const heuristicFaultA = heuristicMap[incidentType] || 70;

    // CSV Matching
    try {
      const csvPath = path.join(process.cwd(), 'public', 'simracingstewards_28k.csv');
      const text = fs.readFileSync(csvPath, 'utf8');
      const parsed = Papa.parse(text, { header: true }).data;
      const query = title.toLowerCase();
      const queryWords = query.split(' ').filter(w => w.length > 2);

      for (const row of parsed) {
        if (!row.title || !row.reason) continue;
        const rowText = `${row.title} ${row.reason} ${row.ruling || ''}`.toLowerCase();
        let score = 0;
        queryWords.forEach(word => { if (rowText.includes(word)) score += 3; });
        if (rowText.includes(incidentType)) score += 5;
        if (rowText.includes('no further action') || rowText.includes('racing incident')) score -= 4;
        if (rowText.includes('fault') || rowText.includes('divebomb') || rowText.includes('punted')) score += 4;
        if (score > 0) matches.push({ ...row, score });
      }
      matches.sort((a, b) => b.score - a.score);
      matches = matches.slice(0, 5);

      const validFaults = matches
        .map(m => parseFloat(m.fault_pct_driver_a))
        .filter(f => !isNaN(f) && f >= 0 && f <= 100);
      const csvFaultA = validFaults.length > 0
        ? validFaults.reduce((a, b) => a + b, 0) / validFaults.length
        : 60;

      finalFaultA = Math.round((csvFaultA * 0.4) + (ruleFaultA * 0.4) + (heuristicFaultA * 0.2));
      finalFaultA = Math.min(98, Math.max(5, finalFaultA));
    } catch (e) {
      console.log('CSV failed:', e);
    }

    const datasetNote = matches.length
      ? `Dataset: ${matches.length}/5 matches. Top: "${matches[0]?.title}" (${matches[0]?.ruling})`
      : `No dataset match. Using rule: ${ruleMatch?.desc || 'iRacing Sporting Code'}`;

    const confidence = matches.length >= 3 && ruleMatch ? 'High' :
                       matches.length >= 1 || ruleMatch ? 'Medium' : 'Low';

    const selectedRule = ruleMatch?.desc || (
      incidentType === 'divebomb' ? 'SCCA Appendix P: Late moves into Vortex of Danger not allowed' :
      incidentType === 'weave block' ? 'BMW SIM GT Rule 2: No blocking or reactionary moves' :
      'iRacing 8.1.1.8: No advantage by leaving racing surface'
    );

    // === 3. Dynamic Phrases ===
    const phrases = [
      "Vortex of Danger", "Dive bomb", "left the door open", "closed the door",
      "ran into you like you weren't there", "netcode", "used you as a barrier",
      "pit maneuver", "he was never going to make that pass", "you aren't required to leave the door open",
      "a lunge at the last second does not mean you have to give him space",
      "its the responsibility of the overtaking car to do so safely",
      "you didn't have space to make that move", "turn off the racing line"
    ];
    const shuffled = [...phrases].sort(() => Math.random() - 0.5);
    const selectedPhrases = shuffled.slice(0, Math.floor(Math.random() * 2) + 1);

    const titleForPrompt = title === 'incident' ? 'incident' : `"${title}"`;

    // === 4. SAFELY LOAD tips2.txt ===
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
          const categoryMap = {
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

          const targets = categoryMap[incidentType] || ['general'];
          const matched = tips.filter(t => targets.includes(t.category));
          const pool = matched.length > 0 ? matched : tips;
          const selected = pool[Math.floor(Math.random() * pool.length)];
          proTip = selected.source ? `${selected.tip} ${selected.source}` : selected.tip;
        }
      }
    } catch (e) {
      console.log('tips2.txt failed (non-critical):', e);
    }

    const prompt = `You are a neutral, educational sim racing steward for r/simracingstewards.
Video: ${url}
Title: ${titleForPrompt}
Type: ${incidentType}
${datasetNote}
Confidence: ${confidence}
RULES (use the most relevant):
- ${selectedRule}
Use ONLY these phrases naturally (1–2 max):
${selectedPhrases.map(p => `- "${p}"`).join('\n')}
${proTip ? `Include this tip: "${proTip}"` : ''}
Tone: calm, educational, community-focused. No blame.
1. Quote the rule.
2. State fault %.
3. Explain what happened (3–4 sentences, use title/type, 1–2 phrases).
4. Give one actionable overtaking tip for Car A.
5. Give one actionable defense tip for Car B.
6. Always include spotter advice.
RETURN ONLY JSON:
{
  "rule": "Text",
  "fault": { "Car A": "${finalFaultA}%", "Car B": "${100 - finalFaultA}%" },
  "car_identification": "Car A: Overtaker. Car B: Defender.",
  "explanation": "Summary\n\nTip A: ...\nTip B: ...",
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

    // === 6. Parse & Enhance ===
    let verdict = {
      rule: selectedRule,
      fault: { "Car A": `${finalFaultA}%`, "Car B": `${100 - finalFaultA}%` },
      car_identification: "Car A: Overtaker. Car B: Defender.",
      explanation: `Contact occurred. Its the responsibility of the overtaking car to do so safely.\n\nTip A: Establish overlap.\nTip B: Hold line.`,
      overtake_tip: "Wait for overlap + listen to spotter",
      defend_tip: "React to 'car inside!' call",
      spotter_advice: {
        overtaker: "Listen to spotter for defender's line before committing.",
        defender: "React to spotter's 'car inside!' call immediately."
      },
      confidence
    };

    try {
      const parsed = JSON.parse(raw);
      verdict = { ...verdict, ...parsed };
    } catch (e) {
      console.log('Parse failed:', e);
    }

    // Inject pro tip
    if (proTip && confidence !== 'Low') {
      verdict.explanation += `\n\n${proTip}`;
      verdict.pro_tip = proTip;
    }

    return Response.json({ verdict, matches });
  } catch (err) {
    clearTimeout(timeout);
    return Response.json({
      verdict: {
        rule: "Error", fault: { "Car A": "0%", "Car B": "0%" },
        car_identification: "", explanation: err.message,
        overtake_tip: "", defend_tip: "", spotter_advice: { overtaker: "", defender: "" },
        confidence: "N/A"
      },
      matches: []
    }, { status: 500 });
  }
}
