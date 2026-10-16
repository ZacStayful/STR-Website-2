import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCESS_COLUMNS } from '../access.ts';
import { BTL_SETTING_KEYS, DEFAULT_BTL_SETTINGS, parseBtlSettings } from './config.ts';

/**
 * The Batch 28 section of supabase/schema.sql, held to the rules every
 * section follows (idempotent, service role only, functions locked) and to
 * config.ts's defaults, so the database and the code cannot disagree.
 */
const sql = readFileSync(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8');
const start = sql.indexOf('-- Batch 28: buy-to-let');
const after = sql.indexOf('\n-- =========================\n-- Batch', start + 1);
const section = start === -1 ? '' : sql.slice(start, after === -1 ? undefined : after);

test('the section exists and ends by reloading the schema cache', () => {
  assert.ok(section.length > 0, 'no "Batch 28: buy-to-let" section in schema.sql');
  assert.match(section.trimEnd(), /notify pgrst, 'reload schema';$/);
});

test('every statement can run twice', () => {
  for (const m of section.matchAll(/create (unique )?(table|index)\b(?! if not exists)/gi)) assert.fail(`not idempotent: ${m[0]}`);
  for (const m of section.matchAll(/add column (?!if not exists)/gi)) assert.fail(`not idempotent: ${m[0]}`);
  for (const m of section.matchAll(/add constraint (\w+)/g)) assert.ok(section.includes(`drop constraint if exists ${m[1]};`), `${m[1]} is added without a guard`);
  for (const m of section.matchAll(/create (or replace )?function/gi)) assert.ok(m[1], `${m[0]} must be "create or replace"`);
  assert.match(section, /on conflict \(key\) do nothing;/);
  // The one-off today_mix update touches a row only while it has no btl.
  assert.match(section, /not \(value->'all' \? 'btl'\)/);
});

test('new tables are service role only', () => {
  const tables = [...section.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables.sort(), ['btl_benchmarks', 'btl_reports']);
  for (const t of tables) {
    assert.match(section, new RegExp(`alter table public\\.${t} enable row level security;`), `${t}: RLS`);
    assert.match(section, new RegExp(`revoke all on public\\.${t} from anon, authenticated;`), `${t}: revoke`);
  }
  assert.doesNotMatch(section, /create policy/i);
  assert.doesNotMatch(section, /grant [^;]* to (anon|authenticated)\b/i);
  for (const m of section.matchAll(/create or replace function public\.(\w+)\(/g)) {
    assert.match(section, new RegExp(`revoke all on function public\\.${m[1]}\\([^)]*\\) from public, anon, authenticated;`), m[1]);
    assert.match(section, new RegExp(`grant execute on function public\\.${m[1]}\\([^)]*\\) to service_role;`), m[1]);
  }
});

test('the launch flag is a profiles column the access checks never read', () => {
  assert.match(section, /alter table public\.profiles add column if not exists btl_launch_line_at timestamptz;/);
  assert.ok(!ACCESS_COLUMNS.split(',').some((c) => c.trim().includes('btl')), 'nothing Batch 28 is an access column');
  // Its only other profiles change is none.
  assert.equal([...section.matchAll(/alter table public\.profiles/g)].length, 1);
});

test('the announcement button label is checked as the editor checks it', () => {
  assert.match(section, /alter table public\.announcements add column if not exists link_label text;/);
  assert.match(section, /char_length\(link_label\) between 1 and 24 and link_path is not null/);
});

test('the seeded settings are config.ts defaults', () => {
  const rows: Record<string, unknown> = {};
  for (const m of section.matchAll(/\('(btl_\w+)', '([^']*)'::jsonb\)/g)) rows[m[1]] = JSON.parse(m[2]);
  assert.deepEqual(Object.keys(rows).sort(), [...BTL_SETTING_KEYS].sort());
  const parsed = parseBtlSettings(rows);
  assert.deepEqual(parsed, DEFAULT_BTL_SETTINGS);
});
