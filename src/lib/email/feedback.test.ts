import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminReportEmail, oneLine, statusEmail, statusEmailLink, ukDate, type AdminReportEmailInput, type StatusEmailInput } from './feedback.ts';

const SITE = 'https://intelligence.stayful.co.uk';
const ID = '0b9f2c1e-3c1d-4a8e-9f1a-2b3c4d5e6f70';
const EVIL = '<script>alert("x")</script> & \'quotes\'\nSecond line\r\nBcc: someone@evil.com';

const admin = (over: Partial<AdminReportEmailInput> = {}): AdminReportEmailInput => ({
  siteUrl: SITE,
  reportId: ID,
  ref: 123,
  kind: 'bug',
  body: EVIL,
  sentAt: '2026-09-28T23:30:00Z',
  memberEmail: 'member@example.com',
  memberName: 'Sam <b>',
  planShort: 'Pro',
  plan: 'Pro (paid)',
  profileName: 'Client: <JS>',
  page: '/deals?area=LS&x="y"',
  device: 'Safari 17 on iPhone (iOS 17.5)',
  screen: '390×844 @3x, window 390×664',
  appVersion: 'abc1234',
  screenshots: { attached: 2, failed: 0 },
  ...over,
});

test('the admin email escapes everything the member supplied, keeps their line breaks, and links to admin', () => {
  const m = adminReportEmail(admin());
  assert.ok(!m.html.includes('<script>'), 'no raw script');
  assert.ok(m.html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp;'));
  assert.ok(m.html.includes('Second line<br>'), 'line breaks kept');
  assert.ok(!m.html.includes('<b>') && m.html.includes('Sam &lt;b&gt;'));
  assert.ok(m.html.includes('Client: &lt;JS&gt;'));
  assert.ok(m.html.includes('/deals?area=LS&amp;x=&quot;y&quot;'));
  assert.ok(m.html.includes(`href="${SITE}/admin/feedback/${ID}"`));
  assert.ok(m.text.includes(`Open in admin: ${SITE}/admin/feedback/${ID}`));
  assert.ok(m.text.includes(EVIL), 'the text part carries the report as written');
  assert.ok(m.html.includes('2 — view in admin'));
});

test('no member text, and no line break, ever reaches the subject', () => {
  const m = adminReportEmail(admin({ planShort: 'Pro\r\nBcc: x@y.com' }));
  assert.equal(m.subject, 'New bug report #123 · Pro Bcc: x@y.com');
  assert.doesNotMatch(m.subject, /[\r\n]/);
  assert.ok(!m.subject.includes('script') && !m.subject.includes('Second line'));
  assert.equal(adminReportEmail(admin({ kind: 'feature' })).subject, 'New feature request #123 · Pro');
});

test('screenshots stay in admin: no image, no storage link', () => {
  const m = adminReportEmail(admin({ screenshots: { attached: 1, failed: 2 } }));
  for (const part of [m.html, m.text]) {
    assert.ok(!/<img/i.test(part));
    assert.ok(!/supabase|storage|feedback-screenshots|token=/i.test(part), part);
  }
  assert.ok(m.text.includes('1 — view in admin (2 could not be attached)'));
  assert.ok(adminReportEmail(admin({ screenshots: { attached: 0, failed: 0 } })).text.includes('Screenshots: None'));
});

test('missing context reads as missing, not as a crash', () => {
  const m = adminReportEmail(admin({ memberEmail: null, memberName: null, profileName: null, page: null, screen: null, appVersion: null }));
  assert.ok(m.text.includes('From: no email'));
  assert.ok(m.text.includes('Page: Not captured'));
  assert.ok(m.text.includes('App version: unknown'));
  assert.ok(!m.text.includes('Active profile'));
});

const status = (over: Partial<StatusEmailInput> = {}): StatusEmailInput => ({
  siteUrl: SITE,
  reportId: ID,
  ref: 45,
  kind: 'bug',
  status: 'done',
  firstName: 'Sam',
  reportedAt: '2026-09-01T10:00:00Z',
  body: 'The map <b>freezes</b> when I zoom out\nevery time',
  message: 'Fixed in today’s release <i>',
  ...over,
});

test('the status email quotes the member’s own words, escaped, with the news and the note', () => {
  const m = statusEmail(status());
  assert.equal(m.subject, 'Fixed: the bug you reported');
  assert.ok(m.html.includes('Hi Sam,'));
  assert.ok(m.html.includes('On 1 September 2026 you told us:'));
  assert.ok(m.html.includes('The map &lt;b&gt;freezes&lt;/b&gt; when I zoom out every time'));
  assert.ok(m.html.includes('<strong>Fixed.</strong> It’s fixed. Thank you for telling us.'));
  assert.ok(m.html.includes('A note from us: “Fixed in today’s release &lt;i&gt;”'));
  assert.ok(!m.html.includes('<i>') && !m.html.includes('<b>'));
  assert.ok(m.text.includes('A note from us: “Fixed in today’s release <i>”'));
});

test('Fixed for a bug, Built for an idea; planned and not doing say so', () => {
  assert.equal(statusEmail(status({ kind: 'feature' })).subject, 'Built: your idea');
  assert.ok(statusEmail(status({ kind: 'feature' })).html.includes('<strong>Built.</strong> It’s built. Thank you for the idea.'));
  assert.equal(statusEmail(status({ status: 'planned' })).subject, 'We’re planning a fix for the bug you reported');
  assert.equal(statusEmail(status({ status: 'planned', kind: 'feature' })).subject, 'We’re planning to build your idea');
  assert.equal(statusEmail(status({ status: 'not_doing' })).subject, 'About the bug you reported');
  assert.ok(statusEmail(status({ status: 'not_doing' })).text.includes('We’ve decided not to do this for now.'));
});

test('no note, no note line; no name, a plain hello', () => {
  const m = statusEmail(status({ message: null, firstName: null }));
  assert.ok(!m.html.includes('A note from us') && !m.text.includes('A note from us'));
  assert.ok(m.html.includes('<p style="margin:0 0 14px">Hi,</p>'));
});

test('the button opens the member’s own feedback, marked as from this email; nothing admin-only', () => {
  const link = statusEmailLink(SITE, ID, 'done', 45);
  assert.equal(link, `${SITE}/account/feedback?report=${ID}&status=done&via=email#report-45`);
  const m = statusEmail(status());
  assert.ok(m.html.includes(`href="${SITE}/account/feedback?report=${ID}&amp;status=done&amp;via=email#report-45"`));
  assert.ok(m.text.includes(link));
  for (const part of [m.html, m.text]) assert.ok(!/admin|\/deals|screenshot|storage/i.test(part), part);
});

test('a long report is quoted short, on one line', () => {
  const m = statusEmail(status({ body: 'word '.repeat(200) }));
  const quote = /“(word[^”]*)”/.exec(m.text)?.[1] ?? '';
  assert.ok(quote.length <= 300 && quote.endsWith('…'), quote);
});

test('helpers', () => {
  assert.equal(oneLine(' a\r\n\tb  c '), 'a b c');
  assert.equal(oneLine('x'.repeat(200), 10).length, 10);
  assert.equal(ukDate('2026-09-28T23:30:00Z'), '29 September 2026', 'UK midnight has passed at 23:30 UTC in summer');
  assert.equal(ukDate('not a date'), 'not a date');
});
