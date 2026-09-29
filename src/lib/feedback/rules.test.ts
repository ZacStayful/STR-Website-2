import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityCall } from '../activity/event.ts';
import { DEFAULT_SETTINGS, IMAGE, LIMITS, SETTING_BOUNDS, SETTING_KEYS } from './config.ts';
import {
  MEMBER_REPORT_COLUMNS,
  SHRINK_PASSES,
  activityKey,
  charLength,
  cleanClientContext,
  cleanEmail,
  cleanHeader,
  cleanLine,
  cleanText,
  deviceSummary,
  duplicateRoot,
  excerpt,
  kindLabel,
  memberPath,
  needsReencode,
  nextShrink,
  parseSettings,
  pathOnly,
  reportTotals,
  scaledSize,
  screenshotCutoff,
  screenshotExtension,
  screenshotProblem,
  shortBuild,
  sniffScreenshot,
  statusLabel,
  statusRecipients,
  ukDayStart,
  weeklySubmissions,
  type RecipientReport,
  type ReportFacts,
} from './rules.ts';
import * as rules from './rules.ts';

const USER = '11111111-2222-4333-8444-555555555555';
const REPORT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const prod = { now: new Date('2026-09-28T09:00:00Z'), env: 'production', background: false };

// ── Text ──

test('a report keeps its line breaks and loses what could hide or disguise text', () => {
  const r = cleanText('  First line\r\nsecond\r\rthird\n\n\n\n\nlast \t word  ‮evil\u0007 ');
  assert.deepEqual(r, { ok: true, text: 'First line\nsecond\n\nthird\n\nlast   word  evil' });
});

test('empty, whitespace-only and non-text reports are refused', () => {
  for (const raw of ['', '   ', '\n\n\t', '‮', null, undefined, 42, {}]) {
    assert.deepEqual(cleanText(raw), { ok: false, reason: 'empty' }, JSON.stringify(raw));
  }
});

test('the limit counts characters as the database does, not UTF-16 units', () => {
  assert.equal(cleanText('a'.repeat(LIMITS.textMax)).ok, true);
  assert.deepEqual(cleanText('a'.repeat(LIMITS.textMax + 1)), { ok: false, reason: 'too_long' });
  const emoji = '🏠'.repeat(LIMITS.textMax);
  assert.equal(emoji.length, LIMITS.textMax * 2);
  assert.equal(cleanText(emoji).ok, true);
  assert.equal(charLength(emoji), LIMITS.textMax);
});

test('a line is one line', () => {
  assert.deepEqual(cleanLine('  Fixed\r\nin  the\tnew release ', 200), { ok: true, text: 'Fixed in the new release' });
  assert.deepEqual(cleanLine('x'.repeat(201), 200), { ok: false, reason: 'too_long' });
  assert.deepEqual(cleanLine(' \n ', 200), { ok: false, reason: 'empty' });
});

test('an excerpt is one line and cut at a word', () => {
  assert.equal(excerpt('short\ntext', 50), 'short text');
  const long = 'The deal page shows the wrong rent when the listing changes price twice in one day';
  const e = excerpt(long, 40);
  assert.ok(charLength(e) <= 40, e);
  assert.ok(e.endsWith('…'));
  assert.ok(!e.includes('  '));
});

// ── Paths ──

test('a member page may become a link', () => {
  for (const ok of ['/today', '/deals/0b9f2c1e-3c1d-4a8e-9f1a-2b3c4d5e6f70', '/deals?area=LS&budget=150000', '/my-deals#stage-offer', '/account/feedback?via=email']) {
    assert.equal(memberPath(ok), ok, ok);
  }
});

test('anything that could leave the site, or reach the API, is refused', () => {
  for (const bad of ['//evil.com', '/\t/evil.com', '/\\evil.com', '/a\\b', 'https://evil.com', 'javascript:alert(1)', 'today', '/..//evil.com', '/./x', '/a/../b', '/api/feedback', '/API/x', '/api', '/a b', '/é', '', `/${'x'.repeat(LIMITS.pathMax)}`, null, 7]) {
    assert.equal(memberPath(bad), null, JSON.stringify(bad));
  }
  assert.equal(memberPath('/apiary'), '/apiary', 'only /api itself is the API');
  // As routed: Next decodes the path, and the URL parser reads %2e as a dot.
  for (const bad of ['/x/%2e%2e/api/feedback', '/%61pi/feedback', '/%41PI/x', '/%2E%2E/today', '/a/%2e/b', '/%2F%2Fevil.com', '/%09/evil.com', '/%5c/x', '/%E2%9C']) {
    assert.equal(memberPath(bad), null, bad);
  }
  assert.equal(memberPath('/deals/abc%2Edef'), '/deals/abc%2Edef', 'an escaped dot inside a name is still a name');
  assert.equal(memberPath('/today?next=/api/x'), '/today?next=/api/x', 'the query is not a path');
});

test('whatever memberPath returns stays on our own site', () => {
  const origin = 'https://intelligence.stayful.co.uk';
  for (const raw of ['/today', '/deals?x=//evil.com', '/my-deals#//evil.com', '/markets/St%20Albans']) {
    const p = memberPath(raw);
    assert.ok(p, raw);
    assert.equal(new URL(p, origin).origin, origin, raw);
  }
});

test('the path alone, for showing', () => {
  assert.equal(pathOnly('/deals?area=LS#x'), '/deals');
  assert.equal(pathOnly('/today'), '/today');
});

// ── What the form captured ──

test('the browser’s context is checked field by field', () => {
  const c = cleanClientContext({
    page: '/deals?area=LS',
    screen: { w: 390, h: 844 },
    viewport: { w: 390.4, h: 664 },
    dpr: 3,
    touch: true,
    timeZone: 'Europe/London',
    language: 'en-GB',
    clientBuild: 'ABCDEF1234567890',
    extra: 'dropped',
  });
  assert.deepEqual(c, { page: '/deals?area=LS', screen: { w: 390, h: 844 }, viewport: { w: 390, h: 664 }, dpr: 3, touch: true, timeZone: 'Europe/London', language: 'en-GB', clientBuild: 'abcdef1' });
});

test('anything malformed in the context is dropped, not trusted', () => {
  const c = cleanClientContext({ page: '//evil.com', screen: { w: -1, h: 10 }, viewport: 'big', dpr: 99, touch: 'yes', timeZone: 'Europe/London; drop table', language: '<script>', clientBuild: 'not-a-sha' });
  assert.deepEqual(c, { page: null, screen: null, viewport: null, dpr: null, touch: false, timeZone: null, language: null, clientBuild: null });
  assert.deepEqual(cleanClientContext(null), { page: null, screen: null, viewport: null, dpr: null, touch: false, timeZone: null, language: null, clientBuild: null });
  assert.deepEqual(cleanClientContext([1, 2]).page, null);
});

test('headers and builds are stored clean', () => {
  assert.equal(cleanHeader('Mozilla/5.0\r\nX-Evil: 1'), 'Mozilla/5.0  X-Evil: 1');
  assert.equal(cleanHeader('x'.repeat(500))?.length, 400);
  assert.equal(cleanHeader('   '), null);
  assert.equal(shortBuild('0123456789abcdef0123456789abcdef01234567'), '0123456');
  assert.equal(shortBuild('main'), null);
  assert.equal(shortBuild(undefined), null);
});

test('the device is named from the user agent', () => {
  const cases: [string, boolean, string][] = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', false, 'Safari 17 on iPhone (iOS 17.5)'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.97;FBBV/620000000]', false, 'Facebook in-app browser on iPhone (iOS 17.5)'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.0.0', false, 'Instagram in-app browser on iPhone (iOS 18.0)'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1', false, 'Chrome 128 on iPhone (iOS 17.5)'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36', false, 'Chrome 128 on Android 14 (phone)'],
    ['Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Safari/537.36', false, 'Samsung Internet 25 on Android 13 (tablet)'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.42', false, 'Edge 128 on Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0', false, 'Firefox 130 on macOS'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', false, 'Safari 17 on macOS'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', true, 'Safari 17 on iPad'],
    ['curl/8.0', false, 'Unknown browser'],
  ];
  for (const [ua, touch, want] of cases) assert.equal(deviceSummary(ua, touch), want, ua);
  assert.equal(deviceSummary(null), 'Unknown device');
});

// ── Screenshots ──

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
const WAV = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const HEIC = bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63);

test('the format comes from the bytes: PNG, JPEG and WebP only', () => {
  assert.equal(sniffScreenshot(PNG), 'image/png');
  assert.equal(sniffScreenshot(JPEG), 'image/jpeg');
  assert.equal(sniffScreenshot(WEBP), 'image/webp');
  for (const b of [WAV, GIF, SVG, HEIC, new Uint8Array()]) assert.equal(sniffScreenshot(b), null);
  assert.equal(screenshotExtension('image/png'), 'png');
  assert.equal(screenshotExtension('image/jpeg'), 'jpg');
  assert.equal(screenshotExtension('image/webp'), 'webp');
  assert.deepEqual(IMAGE.types, ['image/jpeg', 'image/png', 'image/webp']);
});

test('a received image is checked for size and format', () => {
  const s = { screenshotMaxMb: 1 };
  assert.equal(screenshotProblem(PNG, s), null);
  assert.equal(screenshotProblem(new Uint8Array(), s), 'empty');
  assert.equal(screenshotProblem(GIF, s), 'not_an_image');
  const big = new Uint8Array(1024 * 1024 + 1);
  big.set([0xff, 0xd8, 0xff]);
  assert.equal(screenshotProblem(big, s), 'too_big');
});

test('photos are always re-drawn, a small screenshot is kept as it is', () => {
  assert.equal(needsReencode('image/jpeg', 100, 100, 100), true);
  assert.equal(needsReencode('image/webp', 100, 100, 100), true);
  assert.equal(needsReencode('image/png', 500_000, 1179, 2556), false);
  assert.equal(needsReencode('image/png', IMAGE.keepPngUnderBytes + 1, 1000, 1000), true);
  assert.equal(needsReencode('image/png', 100, 3000, 2000), true);
});

test('shrinking keeps the shape and never grows an image', () => {
  assert.deepEqual(scaledSize(4032, 3024, 2560), { width: 2560, height: 1920 });
  assert.deepEqual(scaledSize(1179, 2556, 2560), { width: 1179, height: 2556 });
  assert.deepEqual(scaledSize(3024, 4032, 1920), { width: 1440, height: 1920 });
});

test('a report is kept under budget by shrinking the biggest image first, then asking', () => {
  const MB = 1_000_000;
  assert.deepEqual(nextShrink([{ bytes: 1 * MB, pass: 0 }, { bytes: 1 * MB, pass: 0 }]), { action: 'ok' });
  assert.deepEqual(nextShrink([{ bytes: 1 * MB, pass: 0 }, { bytes: 2 * MB, pass: 0 }, { bytes: 1.5 * MB, pass: 0 }]), { action: 'shrink', index: 1, pass: 1 });
  const last = SHRINK_PASSES.length - 1;
  assert.deepEqual(nextShrink([{ bytes: 2 * MB, pass: last }, { bytes: 1.5 * MB, pass: 0 }, { bytes: 1 * MB, pass: 0 }]), { action: 'shrink', index: 1, pass: 1 });
  assert.deepEqual(nextShrink([{ bytes: 3 * MB, pass: last }, { bytes: 2 * MB, pass: last }]), { action: 'too_big' });
  assert.equal(SHRINK_PASSES[0].longEdge, IMAGE.longEdgePx);
  assert.ok(IMAGE.requestBudgetBytes < IMAGE.requestHardCapBytes && IMAGE.requestHardCapBytes < 4.5 * 1024 * 1024);
});

// ── Settings ──

test('settings take their defaults when missing and are clamped when saved wrong', () => {
  assert.deepEqual(parseSettings(new Map()), DEFAULT_SETTINGS);
  const rows = new Map<string, unknown>([
    [SETTING_KEYS.dailyLimit, '25'],
    [SETTING_KEYS.maxScreenshots, -3],
    [SETTING_KEYS.screenshotMaxMb, 999],
    [SETTING_KEYS.retentionDays, 0],
    [SETTING_KEYS.adminEmail, ' Zac@Stayful.co.uk '],
    [SETTING_KEYS.announcementMaxAgeDays, 'ten'],
  ]);
  assert.deepEqual(parseSettings(rows), {
    dailyLimit: 25,
    maxScreenshots: SETTING_BOUNDS.maxScreenshots.min,
    screenshotMaxMb: SETTING_BOUNDS.screenshotMaxMb.max,
    retentionDays: SETTING_BOUNDS.retentionDays.min,
    adminEmail: 'zac@stayful.co.uk',
    announcementMaxAgeDays: DEFAULT_SETTINGS.announcementMaxAgeDays,
  });
  assert.ok(SETTING_BOUNDS.retentionDays.min >= 7, 'a typo can never wipe every screenshot');
});

test('an admin address that is not one plain address falls back', () => {
  for (const bad of ['', 'zac', 'zac@stayful', 'a@b.com, c@d.com', 'a@b.com\r\nBcc: x@y.com', '<a@b.com>', 7, null]) {
    assert.equal(parseSettings(new Map([[SETTING_KEYS.adminEmail, bad]]), 'owner@stayful.co.uk').adminEmail, 'owner@stayful.co.uk', JSON.stringify(bad));
  }
  assert.equal(parseSettings(new Map([[SETTING_KEYS.adminEmail, 'bad']]), 'also bad').adminEmail, DEFAULT_SETTINGS.adminEmail);
  assert.equal(cleanEmail("o'brien@example.co.uk"), "o'brien@example.co.uk");
});

// ── Days and labels ──

test('the UK day starts at UK midnight, summer and winter', () => {
  assert.equal(ukDayStart(new Date('2026-07-10T12:00:00Z')).toISOString(), '2026-07-09T23:00:00.000Z');
  assert.equal(ukDayStart(new Date('2026-07-09T23:30:00Z')).toISOString(), '2026-07-09T23:00:00.000Z');
  assert.equal(ukDayStart(new Date('2026-12-10T12:00:00Z')).toISOString(), '2026-12-10T00:00:00.000Z');
});

test('screenshots are deleted after the retention days, and a bad setting can never reach recent ones', () => {
  const now = new Date('2026-09-28T02:45:00Z');
  const daysBefore = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(screenshotCutoff(now, 90).toISOString(), daysBefore(90));
  assert.equal(screenshotCutoff(now, 0).toISOString(), daysBefore(7));
  assert.equal(screenshotCutoff(now, -30).toISOString(), daysBefore(7));
  assert.equal(screenshotCutoff(now, 6.9).toISOString(), daysBefore(7));
  assert.equal(screenshotCutoff(now, Number.NaN).toISOString(), daysBefore(90));
  assert.equal(screenshotCutoff(now, 1e9).toISOString(), daysBefore(3650));
});

test('Fixed for a bug, Built for an idea; a member sees Received for new', () => {
  assert.equal(statusLabel('bug', 'done'), 'Fixed');
  assert.equal(statusLabel('feature', 'done'), 'Built');
  assert.equal(statusLabel('bug', 'new'), 'New');
  assert.equal(statusLabel('bug', 'new', 'member'), 'Received');
  assert.equal(statusLabel('feature', 'not_doing'), 'Not doing');
  assert.equal(kindLabel('bug'), 'Bug');
  assert.equal(kindLabel('feature', 'long'), 'Feature request');
});

test('"Your feedback" never reads the admin’s note or the captured context', () => {
  const cols = MEMBER_REPORT_COLUMNS.split(',').map((c) => c.trim());
  for (const hidden of ['admin_note', 'context', 'duplicate_of', 'user_id', 'client_key']) assert.ok(!cols.includes(hidden), hidden);
  assert.ok(cols.includes('status_message'));
});

// ── Duplicates ──

test('a duplicate points at the original, never a chain, a loop or itself', () => {
  const parents = new Map<string, string | null>([
    ['A', null],
    ['B', 'A'],
    ['C', null],
    ['D', 'C'],
  ]);
  const parentOf = (id: string) => (parents.has(id) ? parents.get(id)! : undefined);
  assert.deepEqual(duplicateRoot('C', 'A', parentOf), { ok: true, rootId: 'A' });
  assert.deepEqual(duplicateRoot('C', 'B', parentOf), { ok: true, rootId: 'A' }, 'a duplicate of a duplicate points at the original');
  assert.deepEqual(duplicateRoot('A', 'A', parentOf), { ok: false, reason: 'self' });
  assert.deepEqual(duplicateRoot('C', 'D', parentOf), { ok: false, reason: 'loop' }, 'D is already a duplicate of C');
  assert.deepEqual(duplicateRoot('C', 'Z', parentOf), { ok: false, reason: 'missing' });
});

// ── Status email recipients ──

const report = (id: string, userId: string, createdAt: string, email: string | null = `${userId}@example.com`): RecipientReport => ({ id, ref: 1, userId, email, firstName: null, kind: 'bug', body: `report ${id}`, createdAt });

test('one email per member, each quoting their own report', () => {
  const root = report('R', 'u1', '2026-09-01T10:00:00Z');
  const dups = [report('D2', 'u2', '2026-09-03T10:00:00Z'), report('D1', 'u2', '2026-09-02T10:00:00Z'), report('D3', 'u1', '2026-09-04T10:00:00Z'), report('D4', 'u3', '2026-09-05T10:00:00Z', null)];
  const out = statusRecipients(root, dups);
  assert.deepEqual(
    out.map((r) => [r.report.id, r.report.userId, r.skip]),
    [
      ['R', 'u1', false],
      ['D1', 'u2', false],
      ['D4', 'u3', true],
    ],
  );
});

test('a member already told this status through another report is not told again', () => {
  const root = report('R', 'u1', '2026-09-01T10:00:00Z');
  const dups = [report('X', 'u2', '2026-09-02T10:00:00Z'), report('D1', 'u2', '2026-09-03T10:00:00Z'), report('D5', 'u3', '2026-09-04T10:00:00Z')];
  const out = statusRecipients(root, dups, new Set(['u2']));
  assert.deepEqual(
    out.map((r) => [r.report.id, r.told]),
    [
      ['R', false],
      ['X', true],
      ['D5', false],
    ],
  );
  assert.ok(statusRecipients(root, dups).every((r) => !r.told), 'nobody is told-already by default');
});

// ── Admin sums ──

const facts = (kind: 'bug' | 'feature', status: ReportFacts['status'], createdAt: string, duplicateOf: string | null = null): ReportFacts => ({ kind, status, createdAt, duplicateOf });

test('totals by kind and status, this week and last; a duplicate counts once, as its original', () => {
  const now = new Date('2026-09-30T12:00:00Z'); // a Wednesday
  const rows = [
    facts('bug', 'new', '2026-09-29T09:00:00Z'),
    facts('bug', 'done', '2026-09-28T00:30:00+01:00'), // Monday 00:30 UK: this week
    facts('bug', 'planned', '2026-09-27T23:30:00+01:00'), // Sunday 23:30 UK: last week
    facts('bug', 'new', '2026-09-29T10:00:00Z', 'x'), // a duplicate
    facts('feature', 'not_doing', '2026-09-01T10:00:00Z'),
    facts('feature', 'planned', '2026-09-22T10:00:00Z'),
  ];
  const t = reportTotals(rows, now);
  assert.deepEqual(t.bug, { byStatus: { new: 1, planned: 1, done: 1, not_doing: 0 }, total: 3, thisWeek: 2, lastWeek: 1 });
  assert.deepEqual(t.feature, { byStatus: { new: 0, planned: 1, done: 0, not_doing: 1 }, total: 2, thisWeek: 0, lastWeek: 1 });
  assert.deepEqual(reportTotals([], now).bug, { byStatus: { new: 0, planned: 0, done: 0, not_doing: 0 }, total: 0, thisWeek: 0, lastWeek: 0 });
});

test('submissions per week count every report, duplicates included, across the clock change', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const rows = [
    { kind: 'bug' as const, createdAt: '2026-10-25T23:30:00Z' }, // Sunday 23:30 GMT, the clocks went back that morning
    { kind: 'feature' as const, createdAt: '2026-10-26T00:10:00Z' }, // Monday
    { kind: 'bug' as const, createdAt: '2026-11-03T08:00:00Z' },
    { kind: 'bug' as const, createdAt: '2025-01-01T08:00:00Z' }, // too old to show
  ];
  const weeks = weeklySubmissions(rows, now, 3);
  assert.deepEqual(
    weeks.map((w) => [w.week, w.bugs, w.ideas, w.total]),
    [
      ['2026-10-19', 1, 0, 1],
      ['2026-10-26', 0, 1, 1],
      ['2026-11-02', 1, 0, 1],
    ],
  );
  assert.equal(weeklySubmissions([], now, 12).length, 12);
});

// ── Activity ──

test('the keys and extras this batch logs survive the activity log’s filter', () => {
  const sent = buildActivityCall(USER, 'feedback_sent', { dedupeKey: activityKey.sent(REPORT), extras: { kind: 'feature', screenshots: 2 } }, prod);
  assert.equal(sent?.dedupe_key, `feedback_sent:${REPORT}`);
  assert.deepEqual(sent?.extras, { kind: 'feature', screenshots: 2 });
  assert.equal(buildActivityCall(USER, 'feedback_sent', { extras: { kind: 'bug' } }, prod)?.extras.kind, 'bug');
  for (const [kind, key] of [
    ['announcement_shown', activityKey.shown(REPORT)],
    ['announcement_clicked', activityKey.clicked(REPORT)],
    ['feedback_email_click', activityKey.emailClick(REPORT, 'not_doing')],
  ] as const) {
    assert.equal(buildActivityCall(USER, kind, { dedupeKey: key }, prod)?.dedupe_key, key, kind);
  }
  assert.deepEqual(buildActivityCall(USER, 'announcement_dismissed', { extras: { count: 3 } }, prod)?.extras, { count: 3 });
});

test('a missing table or function reads as "schema not run", anything else as a failure', () => {
  const { isSchemaMissing } = rules;
  for (const e of [{ code: 'PGRST205', message: "Could not find the table 'public.feedback_reports' in the schema cache" }, { code: 'PGRST202' }, { code: '42P01' }, { message: 'relation "public.announcements" does not exist' }]) {
    assert.equal(isSchemaMissing(e), true, JSON.stringify(e));
  }
  for (const e of [null, undefined, { code: '23505', message: 'duplicate key value violates unique constraint' }, { code: 'PGRST301', message: 'JWT expired' }]) {
    assert.equal(isSchemaMissing(e), false, JSON.stringify(e));
  }
});

test('the context reads as lines for admin', () => {
  const { planLine, planShort, screenLine, versionLine } = rules;
  const own = { plan: { code: 'pro', name: 'Pro', status: 'paid' }, team: { member: false, ownerId: null, ownerEmail: null } };
  const team = { plan: { code: 'starter', name: 'Starter', status: 'paused' }, team: { member: true, ownerId: 'o', ownerEmail: 'owner@x.com' } };
  assert.equal(planLine(own), 'Pro (paid)');
  assert.equal(planLine({ ...own, plan: { code: null, name: 'Pay as you go', status: 'subscription_trial' } }), 'Pay as you go (trial)');
  assert.equal(planLine(team), 'Team member of owner@x.com — Starter (paused)');
  assert.equal(planLine(null), 'Unknown');
  assert.equal(planShort(own), 'Pro');
  assert.equal(planShort(team), 'Starter · team');
  assert.equal(screenLine({ screen: { w: 390, h: 844 }, viewport: { w: 390, h: 664 }, dpr: 3 }), '390×844 @3x, window 390×664');
  assert.equal(screenLine({ screen: null, viewport: null, dpr: null }), null);
  assert.equal(versionLine({ serverBuild: 'abc1234', clientBuild: 'abc1234' }), 'abc1234');
  assert.equal(versionLine({ serverBuild: 'abc1234', clientBuild: 'def5678' }), 'abc1234 (browser on def5678)');
  assert.equal(versionLine({ serverBuild: null, clientBuild: null }), null);
});
