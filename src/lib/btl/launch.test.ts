import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DealCard } from '../marketplace/grid.ts';
import { buildDaily } from '../notify/message.ts';
import { renderEmail } from '../notify/render-email.ts';
import { anyHasBtl, BTL_LAUNCH_PATH, btlLaunchDue, btlLaunchSection } from './launch.ts';

const SITE = 'https://intelligence.stayful.co.uk';
const NOW = new Date('2026-10-20T07:05:00Z');

const teaser = (): DealCard => ({
  id: 'd1',
  source: 'rightmove',
  kind: 'sale',
  postcode_area: 'YO',
  outcode: 'YO24',
  town: 'York',
  bedrooms: 3,
  price_amount: 250_000,
  price_period: 'total',
  raw_type: 'Terraced',
  tenure: 'Freehold',
  band: 'qualified',
  annual_profit: 8_400,
  uplift_pct: 42,
  reduced_at: null,
  listed_date: null,
  status: 'live',
  first_seen_at: '2026-10-19T05:00:00Z',
  last_checked_live_at: null,
  last_confirmed_at: '2026-10-20T05:00:00Z',
  last_confirmed_via: 'feed',
  live_since: '2026-10-19T05:00:00Z',
});

test('the launch line is due once, from btl_launch_from, to a member with no Buy to let yet', () => {
  const from = '2026-10-20T06:00:00.000Z';
  assert.equal(btlLaunchDue({ launchFrom: null, now: NOW, lineAt: null, hasBtl: false }), false, 'not switched on');
  assert.equal(btlLaunchDue({ launchFrom: '2026-10-21T06:00:00.000Z', now: NOW, lineAt: null, hasBtl: false }), false, 'not started yet');
  assert.equal(btlLaunchDue({ launchFrom: from, now: NOW, lineAt: null, hasBtl: false }), true);
  assert.equal(btlLaunchDue({ launchFrom: from, now: NOW, lineAt: '2026-10-20T07:00:00Z', hasBtl: false }), false, 'already sent');
  assert.equal(btlLaunchDue({ launchFrom: from, now: NOW, lineAt: null, hasBtl: true }), false, 'already has Buy to let');
  assert.equal(btlLaunchDue({ launchFrom: 'soon', now: NOW, lineAt: null, hasBtl: false }), false);
});

test('anyHasBtl looks at every profile, and an "All" profile from before buy-to-let has none', () => {
  assert.equal(anyHasBtl([{ dealTypes: ['buy_str', 'brrr', 'r2r'] }, null]), false);
  assert.equal(anyHasBtl([{ dealTypes: null }, { dealTypes: ['r2r', 'btl'] }]), true);
  assert.equal(anyHasBtl([]), false);
});

test('the line rides the daily email with an "Add Buy to let" button, and never makes one on its own', () => {
  const section = btlLaunchSection(`${SITE}/`);
  const built = buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [teaser()], changes: [], freeCutoffIso: null, unsubscribe: null, btlLaunch: section })!;
  assert.equal(built.btlLaunch, true);
  const mail = renderEmail(built.message);
  assert.match(mail.text, /New: buy-to-let deals/);
  assert.ok(mail.html.includes('Add Buy to let'));
  assert.ok(mail.html.includes('/profile?add=btl'), 'links to the profile with Buy to let ticked');
  assert.equal(BTL_LAUNCH_PATH, '/profile?add=btl');
  // Nothing else to say: no email, so nothing to mark.
  assert.equal(buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [], changes: [], freeCutoffIso: null, unsubscribe: null, btlLaunch: section }), null);
  // Without it, the email is as it was.
  const plain = buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [teaser()], changes: [], freeCutoffIso: null, unsubscribe: null })!;
  assert.equal(plain.btlLaunch, false);
  assert.doesNotMatch(renderEmail(plain.message).text, /buy-to-let/);
});
