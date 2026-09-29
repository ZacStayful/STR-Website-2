import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS } from './config.ts';
import { BANNER_MAX, announcementKindLabel, announcementState, cleanAnnouncement, cleanIds, clickThrough, isLive, parseRefs, visibleAnnouncements, type AnnouncementRow, type ViewState } from './announcements.ts';

const now = new Date('2026-09-30T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const row = (id: string, publishedDaysAgo: number | null, extra: Partial<AnnouncementRow> = {}): AnnouncementRow => ({
  id,
  kind: 'feature',
  title: `T${id}`,
  body: 'B',
  linkPath: null,
  publishedAt: publishedDaysAgo === null ? null : daysAgo(publishedDaysAgo),
  unpublishedAt: null,
  ...extra,
});

test('a draft is checked field by field', () => {
  const ok = cleanAnnouncement({ kind: 'fix', title: '  Faster Today page\n', body: 'Today now loads in half the time.\r\n\r\n\r\nThanks for telling us.', link: '/today', refs: '#12, 15 #12' });
  assert.deepEqual(ok, { ok: true, draft: { kind: 'fix', title: 'Faster Today page', body: 'Today now loads in half the time.\n\nThanks for telling us.', linkPath: '/today', reportRefs: [12, 15] } });
  const noLink = cleanAnnouncement({ kind: 'feature', title: 'X', body: 'Y', link: '   ', refs: '' });
  assert.equal(noLink.ok && noLink.draft.linkPath, null);
});

test('a bad draft says what is wrong with each field', () => {
  const bad = cleanAnnouncement({ kind: 'news', title: '', body: 'x'.repeat(LIMITS.announcementBodyMax + 1), link: 'https://evil.com', refs: '#12, twelve' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['body', 'kind', 'link', 'refs', 'title']);
  for (const link of ['//evil.com', '/\t/evil.com', '/api/feedback', 'javascript:alert(1)']) {
    const r = cleanAnnouncement({ kind: 'fix', title: 'T', body: 'B', link, refs: '' });
    assert.equal(r.ok, false, link);
  }
  const long = cleanAnnouncement({ kind: 'fix', title: 'x'.repeat(LIMITS.announcementTitleMax + 1), body: 'B', link: '', refs: '' });
  assert.equal(long.ok, false);
});

test('report numbers', () => {
  assert.deepEqual(parseRefs('#3 #1,2'), [3, 1, 2]);
  assert.deepEqual(parseRefs(''), []);
  assert.deepEqual(parseRefs(undefined), []);
  assert.equal(parseRefs('#0'), null);
  assert.equal(parseRefs('#1; drop'), null);
  assert.equal(parseRefs(Array.from({ length: 21 }, (_, i) => `#${i + 1}`).join(' ')), null);
});

test('a member sees live announcements published after they joined, newest first', () => {
  const rows = [row('old', 20), row('new', 1), row('mid', 5), row('draft', null), row('down', 2, { unpublishedAt: daysAgo(1) }), row('stale', 31)];
  const seen = visibleAnnouncements(rows, new Map(), { createdAt: daysAgo(10) }, now, 30);
  assert.deepEqual(seen.map((a) => a.id), ['new', 'mid']);
  const longstanding = visibleAnnouncements(rows, new Map(), { createdAt: daysAgo(400) }, now, 30);
  assert.deepEqual(longstanding.map((a) => a.id), ['new', 'mid', 'old'], 'never a draft, a taken-down or an out-of-date one');
});

test('dismissed or tapped, it never returns; only shown, it stays', () => {
  const rows = [row('a', 1), row('b', 2), row('c', 3)];
  const views = new Map<string, ViewState>([
    ['a', { dismissedAt: daysAgo(0), clickedAt: null }],
    ['b', { dismissedAt: null, clickedAt: daysAgo(0) }],
    ['c', { dismissedAt: null, clickedAt: null }],
  ]);
  assert.deepEqual(visibleAnnouncements(rows, views, { createdAt: daysAgo(100) }, now, 30).map((a) => a.id), ['c']);
});

test('a member who joins after it is published never sees it; an unknown join date sees the live ones', () => {
  const rows = [row('a', 5)];
  assert.equal(visibleAnnouncements(rows, new Map(), { createdAt: daysAgo(4) }, now, 30).length, 0);
  assert.equal(visibleAnnouncements(rows, new Map(), { createdAt: null }, now, 30).length, 1);
});

test('one banner lists at most BANNER_MAX', () => {
  const rows = Array.from({ length: BANNER_MAX + 5 }, (_, i) => row(`r${i}`, i / 10));
  assert.equal(visibleAnnouncements(rows, new Map(), { createdAt: daysAgo(100) }, now, 30).length, BANNER_MAX);
});

test('states for the admin list', () => {
  assert.equal(announcementState(row('a', null), now, 30), 'draft');
  assert.equal(announcementState(row('a', 1), now, 30), 'live');
  assert.equal(announcementState(row('a', 40), now, 30), 'ended');
  assert.equal(announcementState(row('a', 1, { unpublishedAt: daysAgo(0) }), now, 30), 'unpublished');
  assert.equal(isLive(row('a', 30), now, 30), true);
  assert.equal(announcementKindLabel('fix'), 'Bug fix');
  assert.equal(announcementKindLabel('feature'), 'New feature');
});

test('click-through', () => {
  assert.equal(clickThrough(0, 0), null);
  assert.equal(clickThrough(40, 10), 25);
  assert.equal(clickThrough(3, 1), 33);
});

test('banner events name announcement ids only', () => {
  const id = '0b9f2c1e-3c1d-4a8e-9f1a-2b3c4d5e6f70';
  assert.deepEqual(cleanIds([id, id.toUpperCase(), 'x', 7, null]), [id]);
  assert.deepEqual(cleanIds('nope'), []);
});
