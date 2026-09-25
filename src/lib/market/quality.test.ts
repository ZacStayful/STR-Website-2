import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isTrustworthyReport, usableForPostcodeFigure, LEAD_DB_SOURCE } from './quality.ts';

// ── The rule, over the shapes the live table actually holds ────────────────
//
// On 2026-09-25 the `analyser` rows split into high + comparables (351),
// moderate + comparables (30), low + comparables (10) and low + no
// comparables (13); every `monday_backfill` row (409) has no quality block.

test('a high or moderate estimate built on comparables is market data', () => {
  assert.equal(isTrustworthyReport({ comparables_found: 12, quality_level: 'high' }), true);
  assert.equal(isTrustworthyReport({ comparables_found: 4, quality_level: 'moderate' }), true);
});

test('a synthetic estimate (no comparables) is not market data', () => {
  assert.equal(isTrustworthyReport({ comparables_found: 0, quality_level: 'low' }), false);
  assert.equal(isTrustworthyReport({ comparables_found: 0, quality_level: 'high' }), false);
});

test('a report the analyser itself rated low is not market data, even with comparables', () => {
  assert.equal(isTrustworthyReport({ comparables_found: 7, quality_level: 'low' }), false);
});

test('a row with no quality block (the Monday backfill) is kept — there is nothing to judge', () => {
  assert.equal(isTrustworthyReport({ comparables_found: null, quality_level: null }), true);
  assert.equal(isTrustworthyReport({}), true);
});

test('a quality block with a level but no comparable count is judged, and fails', () => {
  // The estimate software reads a missing count as 0, so this matches its gate.
  assert.equal(isTrustworthyReport({ comparables_found: null, quality_level: 'moderate' }), false);
});

// ── The single-postcode quick-view figure ──────────────────────────────────

test('a lead-database row never feeds the single-postcode figure, however good', () => {
  assert.equal(usableForPostcodeFigure({ source: LEAD_DB_SOURCE, comparables_found: 12, quality_level: 'high' }), false);
});

test('other sources feed it when the estimate is trustworthy', () => {
  assert.equal(usableForPostcodeFigure({ source: 'analyser', comparables_found: 12, quality_level: 'high' }), true);
  assert.equal(usableForPostcodeFigure({ source: 'monday_backfill' }), true);
  assert.equal(usableForPostcodeFigure({ source: 'analyser', comparables_found: 0, quality_level: 'low' }), false);
});

test('the lead-database source string matches what the estimate software writes', () => {
  // Stayful-STR-estimate-software src/app/api/internal/analyse/route.tsx passes
  // reportSource: 'lead_db'. A rename there must be made here too.
  assert.equal(LEAD_DB_SOURCE, 'lead_db');
});

// ── Wiring the rule reaches, pinned on the real files ──────────────────────
//
// source.ts and the broker's internal provider are server-only, so they cannot
// be imported here. Comments are stripped first so an explanation can never
// satisfy a guard on its own.

const here = dirname(fileURLToPath(import.meta.url));
function code(relative: string): string {
  return readFileSync(join(here, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('the explorer loader selects the two quality fields', () => {
  const src = code('source.ts');
  assert.match(src, /comparables_found:raw_response->dataQuality->comparablesFound/);
  assert.match(src, /quality_level:raw_response->dataQuality->>level/);
});

test('the single-postcode figure excludes lead-database rows and filters on quality', () => {
  const src = code('../broker/providers/internal.ts');
  const fn = src.slice(src.indexOf('export async function storedPostcodeFigures'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /\.neq\('source', LEAD_DB_SOURCE\)/);
  assert.match(body, /usableForPostcodeFigure\(/);
  assert.match(body, /comparables_found:raw_response->dataQuality->comparablesFound/);
  // The count shown to members is the rows averaged, not the rows fetched.
  assert.match(body, /samples: rows\.length/);
});
