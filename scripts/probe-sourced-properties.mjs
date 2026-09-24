#!/usr/bin/env node
/**
 * Prints what PropertyData's /sourced-properties endpoint actually returns.
 *
 * Its request is documented; its response is not, and its `list` slugs are
 * given inconsistently across PropertyData's own pages. So src/lib/listing/
 * cohorts.ts reads every field tolerantly, through several plausible
 * spellings. This script replaces that guesswork with the real answer.
 *
 *   PROPERTYDATA_API_KEY=... node scripts/probe-sourced-properties.mjs "OX3 9DW"
 *
 * It reports, per cohort: whether the slug was accepted, how many properties
 * came back, the union of keys across the rows, and one full row. Then tighten
 * the accessors in cohorts.ts — and in particular answer the question that
 * decides how much this feed is worth:
 *
 *   DOES A ROW CARRY A PORTAL URL?
 *
 * With one, a cohort property can become a pick in its own right. Without one,
 * the feed can only enrich listings we already hold — which is still worth
 * having, because its months-on-market and reduction figures are measured
 * rather than inferred, but it is a smaller feature.
 *
 * Costs one API credit per cohort tried.
 */
import { COHORT_SLUGS, DEFAULT_COHORTS } from '../src/lib/listing/cohorts.ts';

const key = process.env.PROPERTYDATA_API_KEY;
if (!key) {
  console.error('Set PROPERTYDATA_API_KEY.');
  process.exit(1);
}
const postcode = process.argv[2] ?? 'OX3 9DW';
const radius = process.argv[3] ?? '10';

const urlFor = (slug) => {
  const u = new URL('https://api.propertydata.co.uk/sourced-properties');
  u.searchParams.set('key', key);
  u.searchParams.set('list', slug);
  u.searchParams.set('postcode', postcode);
  u.searchParams.set('radius', radius);
  u.searchParams.set('results', '5');
  u.searchParams.set('exclude_sstc', 'true');
  return u;
};

const URL_KEYS = ['url', 'listing_url', 'portal_url', 'link', 'source_url'];

for (const cohort of DEFAULT_COHORTS) {
  console.log(`\n═══ ${cohort} ═══`);
  for (const slug of COHORT_SLUGS[cohort]) {
    const res = await fetch(urlFor(slug).toString(), { cache: 'no-store' }).catch((e) => {
      console.log(`  ${slug}: fetch failed — ${e.message}`);
      return null;
    });
    if (!res) continue;
    const body = await res.json().catch(() => null);
    if (!body) {
      console.log(`  ${slug}: HTTP ${res.status}, unparseable body`);
      continue;
    }
    if (body.status === 'error') {
      console.log(`  ${slug}: rejected — ${body.message ?? 'no message'}`);
      continue;
    }
    const rows = body.properties ?? body.data ?? body.results ?? body.result ?? [];
    const list = Array.isArray(rows) ? rows : [];
    console.log(`  ${slug}: ACCEPTED · ${list.length} rows · top-level keys: [${Object.keys(body).join(', ')}]`);
    if (list.length === 0) break;
    const keys = [...new Set(list.flatMap((r) => Object.keys(r ?? {})))].sort();
    console.log(`  row keys: ${keys.join(', ')}`);
    const urlKey = URL_KEYS.find((k) => list.some((r) => typeof r?.[k] === 'string' && r[k]));
    console.log(`  PORTAL URL: ${urlKey ? `yes, under "${urlKey}" → ${list.find((r) => r[urlKey])[urlKey]}` : 'NO — enrichment only'}`);
    console.log(`  first row: ${JSON.stringify(list[0], null, 2)}`);
    break; // the first slug that works is the answer for this cohort
  }
}
