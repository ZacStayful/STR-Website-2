#!/usr/bin/env node
/**
 * Outlier verification sweep.
 *
 * For each of the top-3 outliers from the V2 calibration run, re-runs the
 * analysis at bedroom counts 1..5 and compares each against the PMI baseline.
 *
 * Goal: determine whether the outlier was caused by wrong bedroom inference
 * (shipping is safe) or by a real V2 bug (needs tuning).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
const envPath = path.join(__dirname, '..', '.env');
const envText = fs.readFileSync(envPath, 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const BYPASS = process.env.CALIBRATION_BYPASS_SECRET;
const API = 'http://localhost:3000/api/analyse';

const OUTLIERS = [
  { address: 'Barking Road, London, E13 8NX',      postcode: 'E13 8NX',  pmi: 36_000 },
  { address: 'Maidenhead Road, Maidenhead, SL6 8RL', postcode: 'SL6 8RL', pmi: 45_000 },
  { address: 'Warwick Road, Stretford, Manchester, M16 0XX', postcode: 'M16 0XX', pmi: 27_000 },
];

async function analyse(address, postcode, bedrooms) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-calibration-bypass': BYPASS,
    },
    body: JSON.stringify({
      address, postcode, bedrooms,
      guests: bedrooms * 2,
      bathrooms: Math.max(1, Math.floor(bedrooms * 0.75)),
      parking: 'no_parking',
      outdoorSpace: 'none',
      finishQuality: 'average',
      propertyType: 'Terraced',
      monthlyMortgage: 0,
      monthlyBills: 0,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`API ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let final = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() || '';
    for (const f of frames) {
      const dl = f.split('\n').find((l) => l.startsWith('data: '));
      if (!dl) continue;
      try {
        const p = JSON.parse(dl.slice(6));
        if (p.stage === 'complete' && p.data) final = p.data;
      } catch {}
    }
  }
  if (!final) throw new Error('No complete event');
  return final;
}

async function main() {
  for (const o of OUTLIERS) {
    console.log(`\n━━━ ${o.postcode} — PMI baseline £${o.pmi.toLocaleString()} ━━━`);
    console.log('bed | annual     | Δ vs PMI  | ADR  | occ  | comps');
    console.log('----+------------+-----------+------+------+------');
    for (const bedrooms of [1, 2, 3, 4, 5]) {
      try {
        const r = await analyse(o.address, o.postcode, bedrooms);
        const ann = r.shortLet?.annualRevenue ?? 0;
        const div = ((ann - o.pmi) / o.pmi) * 100;
        const adr = r.shortLet?.averageDailyRate ?? 0;
        const occ = Math.round((r.shortLet?.occupancyRate ?? 0) * 100);
        const comps = r.dataQuality?.comparablesFound ?? 0;
        const divStr = (div >= 0 ? '+' : '') + div.toFixed(0) + '%';
        console.log(
          `  ${bedrooms} | £${String(ann.toLocaleString()).padStart(8)} | ${divStr.padStart(9)} | £${String(adr).padStart(3)} | ${String(occ).padStart(3)}% | ${comps}`,
        );
      } catch (err) {
        console.log(`  ${bedrooms} | FAILED: ${err.message}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
