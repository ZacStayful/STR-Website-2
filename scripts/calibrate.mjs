#!/usr/bin/env node
/**
 * V2 PMI Calibration Harness
 *
 * Runs a subset of the PMI calibration dataset through our local /api/analyse
 * endpoint and compares short-let annual revenue vs the PMI baseline.
 *
 * Prereqs:
 *   - `npm run dev` running on :3000
 *   - CALIBRATION_BYPASS_SECRET set in .env (rate-limit bypass)
 *
 * Usage:
 *   node scripts/calibrate.mjs [limit] [csvPath]
 *
 * Writes: scripts/calibration-results.json + prints summary.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIMIT = parseInt(process.argv[2] || '10', 10);
const CSV_PATH =
  process.argv[3] ||
  '/Users/rahul/Downloads/pmi-calibration-dataset-clean.csv';
const API_URL = process.env.CALIBRATION_API_URL || 'http://localhost:3000/api/analyse';

// Load .env manually
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const BYPASS_SECRET = process.env.CALIBRATION_BYPASS_SECRET;
if (!BYPASS_SECRET) {
  console.error('ERROR: CALIBRATION_BYPASS_SECRET not set in .env');
  process.exit(1);
}

// ───────────────────────────────────────────────────────────────
// CSV parser (tolerant of quoted commas)
// ───────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === ',' && !inQ) {
        cells.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

function parsePmiCurrency(s) {
  if (!s) return 0;
  const clean = s.replace(/[^0-9.]/g, '');
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
function extractPostcode(address) {
  const m = address.match(UK_POSTCODE_RE);
  if (!m) return null;
  return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
}

// Infer bedrooms/guests from PMI estimate (rough brackets)
function inferBedGuest(pmi) {
  if (pmi < 25_000) return { bedrooms: 1, guests: 2 };
  if (pmi < 35_000) return { bedrooms: 2, guests: 4 };
  if (pmi < 55_000) return { bedrooms: 3, guests: 6 };
  if (pmi < 85_000) return { bedrooms: 4, guests: 8 };
  return { bedrooms: 5, guests: 10 };
}

// ───────────────────────────────────────────────────────────────
// SSE client for /api/analyse
// ───────────────────────────────────────────────────────────────
async function runAnalysis(property) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-calibration-bypass': BYPASS_SECRET,
    },
    body: JSON.stringify({
      address: property.address,
      postcode: property.postcode,
      bedrooms: property.bedrooms,
      guests: property.guests,
      bathrooms: Math.max(1, Math.floor(property.bedrooms * 0.75)),
      parking: 'no_parking',
      outdoorSpace: 'none',
      finishQuality: 'average',
      propertyType: 'Terraced',
      monthlyMortgage: 0,
      monthlyBills: 0,
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let final = null;
  let lastError = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() || '';
    for (const frame of frames) {
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      try {
        const payload = JSON.parse(dataLine.slice(6));
        if (payload.stage === 'complete' && payload.data) final = payload.data;
        if (payload.stage === 'error') lastError = payload.message;
      } catch {
        /* ignore malformed frame */
      }
    }
  }

  if (!final) throw new Error(lastError || 'No complete event received');
  return final;
}

// ───────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────
async function main() {
  const raw = fs.readFileSync(CSV_PATH);
  const text = raw.toString('latin1');

  const rows = parseCsv(text);
  const header = rows.shift();
  console.log(`CSV header: ${header.join(' | ')}`);
  console.log(`Total rows: ${rows.length}`);

  const candidates = [];
  for (const row of rows) {
    const [address, pmiRaw, mondayId] = row;
    if (!address) continue;
    const postcode = extractPostcode(address);
    if (!postcode) continue;
    const pmi = parsePmiCurrency(pmiRaw);
    if (pmi <= 0) continue;
    const { bedrooms, guests } = inferBedGuest(pmi);
    candidates.push({
      address: address.trim(),
      postcode,
      bedrooms,
      guests,
      pmiEstimate: pmi,
      mondayId: (mondayId || '').trim(),
    });
  }

  console.log(`Properties with valid postcode: ${candidates.length}`);
  const subset = candidates.slice(0, LIMIT);
  console.log(`Running calibration on ${subset.length} properties...\n`);

  const results = [];
  for (let i = 0; i < subset.length; i++) {
    const p = subset[i];
    const tStart = Date.now();
    process.stdout.write(
      `[${i + 1}/${subset.length}] ${p.postcode} (${p.bedrooms}bed) pmi=£${p.pmiEstimate.toLocaleString()} ... `,
    );
    try {
      const result = await runAnalysis(p);
      const our = result.shortLet?.annualRevenue ?? 0;
      const divergencePct = ((our - p.pmiEstimate) / p.pmiEstimate) * 100;
      const absDiv = Math.abs(divergencePct);
      const comps = result.dataQuality?.comparablesFound ?? 0;
      const radius = result.dataQuality?.searchRadiusKm ?? 0;
      const adr = result.shortLet?.averageDailyRate ?? 0;
      const occ = result.shortLet?.occupancyRate ?? 0;
      const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
      console.log(
        `ours=£${our.toLocaleString()} Δ=${divergencePct >= 0 ? '+' : ''}${divergencePct.toFixed(1)}% ` +
        `(${comps} comps, ${radius}km, ADR £${adr}, occ ${(occ * 100).toFixed(0)}%) ${elapsed}s`,
      );
      results.push({
        ...p,
        ourEstimate: our,
        ourAdr: adr,
        ourOccupancy: occ,
        divergencePct,
        absDivergencePct: absDiv,
        comparablesFound: comps,
        searchRadiusKm: radius,
        elapsedSec: parseFloat(elapsed),
        ok: true,
      });
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      results.push({ ...p, ok: false, error: String(err.message) });
    }
  }

  // ── Summary ───────────────────────────────────────────────────
  const ok = results.filter((r) => r.ok && r.ourEstimate > 0);
  if (ok.length === 0) {
    console.log('\nNo successful results to summarise.');
    process.exit(1);
  }

  const divs = ok.map((r) => r.divergencePct);
  const absDivs = ok.map((r) => r.absDivergencePct);
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };

  const within = (threshold) =>
    (ok.filter((r) => r.absDivergencePct <= threshold).length / ok.length) * 100;

  console.log('\n══════════════════════════════════════════════');
  console.log('  V2 CALIBRATION SUMMARY');
  console.log('══════════════════════════════════════════════');
  console.log(`Properties analysed:   ${ok.length}/${subset.length}`);
  console.log(`Mean divergence:       ${mean(divs).toFixed(1)}%  (signed)`);
  console.log(`Median divergence:     ${median(divs).toFixed(1)}%  (signed)`);
  console.log(`Mean |divergence|:     ${mean(absDivs).toFixed(1)}%`);
  console.log(`Median |divergence|:   ${median(absDivs).toFixed(1)}%`);
  console.log(`Within ±10%:           ${within(10).toFixed(0)}%`);
  console.log(`Within ±20%:           ${within(20).toFixed(0)}%`);
  console.log(`Within ±30%:           ${within(30).toFixed(0)}%`);

  const highDivergence = ok.filter((r) => r.absDivergencePct > 30);
  if (highDivergence.length) {
    console.log(`\nOutliers (>30% divergence): ${highDivergence.length}`);
    for (const r of highDivergence) {
      console.log(
        `  ${r.postcode}: ours=£${r.ourEstimate.toLocaleString()} vs pmi=£${r.pmiEstimate.toLocaleString()} (${r.divergencePct.toFixed(0)}%)`,
      );
    }
  }

  const outPath = path.join(__dirname, 'calibration-results.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        limit: LIMIT,
        totalCandidates: candidates.length,
        subsetSize: subset.length,
        successCount: ok.length,
        summary: {
          meanDivergencePct: mean(divs),
          medianDivergencePct: median(divs),
          meanAbsDivergencePct: mean(absDivs),
          medianAbsDivergencePct: median(absDivs),
          within10Pct: within(10),
          within20Pct: within(20),
          within30Pct: within(30),
        },
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\nResults written to: ${outPath}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
