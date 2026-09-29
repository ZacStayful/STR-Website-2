import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCESS_COLUMNS } from '../access.ts';
import { ANNOUNCEMENT_KINDS, BUCKET, BUCKET_CEILING_BYTES, DEFAULT_SETTINGS, EMAILED_STATUSES, IMAGE, LIMITS, REPORT_KINDS, REPORT_STATUSES, SETTING_KEYS } from './config.ts';

/**
 * The Batch 18 section of supabase/schema.sql, held to the rules every
 * section since Batch 3 follows (service role only, idempotent, functions
 * locked to the service role) and to the numbers in config.ts, so the
 * database and the code can never quietly disagree.
 */
const sql = readFileSync(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8');
const start = sql.indexOf('-- Batch 18: feedback and announcements');
const after = sql.indexOf('\n-- =========================\n-- Batch', start + 1);
const section = start === -1 ? '' : sql.slice(start, after === -1 ? undefined : after);

const quoted = (list: readonly string[]) => list.map((v) => `'${v}'`).join(', ');

test('the section exists', () => {
  assert.ok(section.length > 0, 'no "Batch 18: feedback and announcements" section in schema.sql');
});

test('every table is service role only: RLS on, no policies, nothing granted to members', () => {
  const tables = [...section.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables.sort(), ['announcement_views', 'announcements', 'feedback_reports', 'feedback_screenshots', 'feedback_status_emails']);
  for (const t of tables) {
    assert.match(section, new RegExp(`alter table public\\.${t} enable row level security;`), `${t}: RLS`);
    assert.match(section, new RegExp(`revoke all on public\\.${t} from anon, authenticated;`), `${t}: revoke`);
  }
  assert.doesNotMatch(section, /create policy/i);
  assert.doesNotMatch(section, /grant [^;]* to (anon|authenticated)\b/i);
  assert.doesNotMatch(section, /alter table public\.profiles/i, 'no column on profiles');
});

test('every statement can run twice', () => {
  for (const m of section.matchAll(/create (unique )?(table|index)\b(?! if not exists)/gi)) assert.fail(`not idempotent: ${m[0]}`);
  for (const m of section.matchAll(/add constraint (\w+)/g)) {
    assert.ok(section.includes(`conname = '${m[1]}'`), `${m[1]} is added without a guard`);
  }
  for (const m of section.matchAll(/create (or replace )?function/gi)) assert.ok(m[1], `${m[0]} must be "create or replace"`);
  assert.match(section, /on conflict \(key\) do nothing;/);
});

test('the functions take one jsonb and only the service role may call them', () => {
  const fns = [...section.matchAll(/create or replace function public\.(\w+)\((\w+) jsonb\)/g)].map((m) => m[1]);
  assert.deepEqual(fns.sort(), ['feedback_status_claim', 'feedback_submit']);
  for (const f of fns) {
    assert.match(section, new RegExp(`revoke all on function public\\.${f}\\(jsonb\\) from public, anon, authenticated;`), f);
    assert.match(section, new RegExp(`grant execute on function public\\.${f}\\(jsonb\\) to service_role;`), f);
  }
  assert.equal([...section.matchAll(/set search_path = ''/g)].length, fns.length);
});

test('the seeded settings are config.ts defaults', () => {
  const rows = new Map([...section.matchAll(/\('(\w+)', '([^']*)'::jsonb\)/g)].map((m) => [m[1], JSON.parse(m[2])]));
  const expected: Record<string, unknown> = {
    [SETTING_KEYS.dailyLimit]: DEFAULT_SETTINGS.dailyLimit,
    [SETTING_KEYS.maxScreenshots]: DEFAULT_SETTINGS.maxScreenshots,
    [SETTING_KEYS.screenshotMaxMb]: DEFAULT_SETTINGS.screenshotMaxMb,
    [SETTING_KEYS.retentionDays]: DEFAULT_SETTINGS.retentionDays,
    [SETTING_KEYS.adminEmail]: DEFAULT_SETTINGS.adminEmail,
    [SETTING_KEYS.announcementMaxAgeDays]: DEFAULT_SETTINGS.announcementMaxAgeDays,
  };
  assert.deepEqual(Object.fromEntries(rows), expected);
});

test('the checks match the lists and limits in config.ts', () => {
  assert.ok(section.includes(`check (kind in (${quoted(REPORT_KINDS)}))`), 'report kinds');
  assert.ok(section.includes(`check (status in (${quoted(REPORT_STATUSES)}))`), 'report statuses');
  assert.ok(section.includes(`check (status in (${quoted(EMAILED_STATUSES)}))`), 'emailed statuses');
  assert.ok(section.includes(`check (kind in (${quoted(ANNOUNCEMENT_KINDS)}))`), 'announcement kinds');
  assert.ok(section.includes(`check (char_length(body) between 1 and ${LIMITS.textMax})`), 'report text');
  assert.ok(section.includes(`char_length(status_message) <= ${LIMITS.statusMessageMax}`), 'status message');
  assert.ok(section.includes(`check (char_length(title) between 1 and ${LIMITS.announcementTitleMax})`), 'announcement title');
  assert.ok(section.includes(`check (char_length(body) between 1 and ${LIMITS.announcementBodyMax})`), 'announcement text');
  assert.ok(section.includes(`char_length(link_path) <= ${LIMITS.pathMax}`), 'announcement link');
  assert.ok(section.includes('check (duplicate_of is null or duplicate_of <> id)'), 'never its own duplicate');
});

test('the screenshot bucket is private, and stays so', () => {
  assert.ok(section.includes(`values ('${BUCKET}', '${BUCKET}', false, ${BUCKET_CEILING_BYTES}, array[${quoted(IMAGE.types)}])`), 'bucket insert');
  assert.match(section, /on conflict \(id\) do update\s+set public = false,/);
  assert.doesNotMatch(section, /on storage\.objects/i, 'no storage policy');
});

test('nothing reaches the access gate', () => {
  for (const col of ['feedback', 'announcement']) assert.ok(!ACCESS_COLUMNS.includes(col), col);
});
