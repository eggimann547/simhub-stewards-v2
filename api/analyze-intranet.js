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
    // === 1. SAFELY PARSE BODY ===
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return Response.json({
        verdict: { rule: "Error", fault: { "Car A": "0%", "Car B": "0%" }, explanation: "Invalid JSON in request", confidence: "N/A" },
        matches: []
      }, { status: 400 });
    }

    const { url } = schema.parse(body);

    // === 2. YouTube Title & Incident Type ===
    let title = 'incident';
    let incidentType = 'general contact';

    const videoId = url.match(/v=([0-9A-Za-z_-]{11})/)?.[1];
    if (videoId) {
      try {
        const oembed = await fetch(`https://www.youtube.com/oembed?url=${url}&format=json`, { signal: controller.signal });
        if (oembed.ok) {
          const data = await oembed.json();
          title = data.title || 'incident';
        }
      } catch (e) {
        console.log('oEmbed failed:', e);
      }
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

    // === 3. FAULT ENGINE ===
    let finalFaultA = 60;
    let matches = [];
    let ruleMatch = null;

    const BMW_RULES = [
      { keywords: ['dive', 'late', 'lunge', 'brake', 'underbraking', 'punting'], faultA: 90, desc: "Under-braking and punting (BMW SIM GT Rule 5)" },
      { keywords: ['block', 'weave', 'reactionary'], faultA: 20, desc: "Blocking (BMW SIM GT Rule 2)" },
      { keywords: ['rejoin', 'off-track', 'spin'], faultA: 85, desc: "Unsafe rejoin (BMW SIM GT Rule 7)" },
      { keywords: ['overlap', 'apex', 'door open'], faultA: 95, desc: "Side-by-side rule violation (BMW SIM GT Rule 4)" },
      { keywords: ['netcode', 'lag', 'teleport'], faultA: 50, desc: "Netcode-related incident" },
      { keywords: ['barrier', 'used you'], faultA: 95, desc: "Using another car as a barrier" },
      { keywords: ['pit maneuver'], faultA: 98, desc: "Pit maneuver (Intentional wrecking)" }
    ];

    for (const rule of BMW_RULES) {
      if (rule.keywords.some(k => lower.includes(k))) {
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

    // === CSV (Safe) ===
    try {
      const csvPath = path.join(process.cwd(), 'public', 'simracingstewards_28k.csv');
      if (fs.existsSync(csvPath)) {
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
        finalFaultA = Math.round((csvFaultA * 0.4) + (ruleFaultA *
