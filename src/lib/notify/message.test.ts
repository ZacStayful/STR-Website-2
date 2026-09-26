import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DealCard } from '../marketplace/grid.ts';
import { buildDaily, changeItem, changesPhrase, teaserItem, visibleTeasers, type ChangeInput, type Section } from './message.ts';
import { renderEmail } from './render-email.ts';

const SITE = 'https://intelligence.stayful.co.uk';
const NOW = new Date('2026-09-28T07:05:00Z');

function card(over: Partial<DealCard> = {}): DealCard {
  return {
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
    first_seen_at: '2026-09-20T05:00:00Z',
    last_checked_live_at: null,
    last_confirmed_at: '2026-09-28T05:00:00Z',
    last_confirmed_via: 'feed',
    live_since: '2026-09-20T05:00:00Z',
    ...over,
  };
}

const pick: { section: Section; headline: string } = {
  section: { key: 'pick', title: null, blocks: [{ type: 'heading', text: '1 Pick Street, Nottingham' }] },
  headline: '2-bed to buy in Nottingham, 42% above a long let',
};

const change = (over: Partial<ChangeInput> = {}): ChangeInput => ({
  id: 'a1',
  alertType: 'price_drop',
  kind: 'sale',
  opened: false,
  town: 'Leeds',
  type: '2 bed flat',
  stage: 'watching',
  dealId: 'deal-9',
  oldAmount: 200_000,
  newAmount: 185_000,
  period: 'total',
  figure: '+51% · £9,100/yr over a long let',
  ...over,
});

test('a teaser is figure, price, town, type and motivation, linking to Today, and nothing private', () => {
  // A row that somehow carried private columns must still not leak them.
  const leaky = { ...card(), canonical_url: 'https://www.rightmove.co.uk/properties/123', address: '12 High Street, York', postcode: 'YO24 1AB', photo: 'https://media.rightmove/x.jpg' } as DealCard;
  const item = teaserItem(leaky, `${SITE}/today`, NOW);
  const all = [item.title, ...item.lines, item.link?.url ?? ''].join('\n');
  assert.match(item.title, /^\+42% · £8,400\/yr over a long let$/);
  assert.match(all, /£250,000 · York/);
  assert.match(all, /3 bed terraced · Freehold/);
  assert.equal(item.link?.url, `${SITE}/today`);
  for (const secret of ['High Street', 'YO24', 'rightmove', 'media.']) assert.ok(!all.includes(secret), `leaked ${secret}`);
});

test('a teaser with no town falls back to the area name, never the outcode', () => {
  const item = teaserItem(card({ town: null }), `${SITE}/today`, NOW);
  assert.ok(item.lines[0].includes('York'));
  assert.ok(!item.lines.join(' ').includes('YO24'));
});

test('the early-access backstop drops (and reports) a deal a free account may not see yet', () => {
  const fresh = card({ id: 'fresh', live_since: '2026-09-27T20:00:00Z' });
  const old = card({ id: 'old' });
  const cutoff = '2026-09-26T07:05:00Z'; // 48h before NOW
  assert.deepEqual(visibleTeasers([fresh, old], cutoff), { kept: [old], dropped: ['fresh'] });
  // Paid: everything.
  assert.deepEqual(visibleTeasers([fresh, old], null).kept.map((c) => c.id), ['fresh', 'old']);
  // A live deal with no live_since is treated as brand new.
  assert.deepEqual(visibleTeasers([card({ id: 'x', live_since: null })], cutoff).dropped, ['x']);
  const built = buildDaily({ siteUrl: SITE, now: NOW, pick, teasers: [fresh, old], changes: [], freeCutoffIso: cutoff, unsubscribe: null })!;
  assert.deepEqual(built.teaserIds, ['old']);
  assert.deepEqual(built.droppedTeasers, ['fresh']);
  assert.match(built.message.subject, /^2 deals today/);
});

test('a change names the address only when the member opened the deal, and never links the listing', () => {
  const closed = changeItem(change({ address: '9 Secret Road, Leeds', opened: false }), SITE)!;
  const text = [closed.title, ...closed.lines, closed.link?.url].join('\n');
  assert.ok(!text.includes('Secret Road'));
  assert.match(text, /Leeds · 2 bed flat/);
  assert.equal(closed.link?.url, `${SITE}/my-deals?focus=d-deal-9`);
  const open = changeItem(change({ address: '9 Secret Road, Leeds', opened: true }), SITE)!;
  assert.ok(open.lines.includes('9 Secret Road, Leeds'));
  assert.ok(!(open.link?.url ?? '').includes('rightmove'));
  // A listing the member added themselves goes to its own row.
  assert.equal(changeItem(change({ dealId: null, checkedListingId: 'row-1' }), SITE)?.link?.url, `${SITE}/my-deals?focus=l-row-1`);
});

test('no made-up changes: a "drop" that is not lower, or "nearly gone" on fewer than 3 others, is dropped', () => {
  assert.equal(changeItem(change({ newAmount: 200_000 }), SITE), null);
  assert.equal(changeItem(change({ newAmount: 210_000 }), SITE), null);
  assert.equal(changeItem(change({ oldAmount: null }), SITE), null);
  assert.equal(changeItem(change({ alertType: 'nearly_gone', watchers: 2 }), SITE), null);
  assert.match(changeItem(change({ alertType: 'nearly_gone', watchers: 3 }), SITE)!.lines.join(' '), /3 other members/);
  assert.equal(changeItem(change({ alertType: 'gone', status: 'available' }), SITE), null);
  assert.equal(changeItem(change({ alertType: 'gone', status: 'let_agreed' }), SITE)?.title, 'Gone: now let agreed');
  // A drop with no figure computed at the new price shows the price alone.
  const plain = changeItem(change({ figure: null }), SITE)!;
  assert.equal(plain.title, 'Price drop: £200,000 → £185,000');
  assert.ok(!plain.lines.some((l) => l.startsWith('Now ')));
});

test('the subject is counted from what is in the email', () => {
  const teasers = ['a', 'b', 'c', 'd'].map((id) => card({ id }));
  const built = buildDaily({ siteUrl: SITE, now: NOW, pick, teasers, changes: [change()], freeCutoffIso: null, unsubscribe: null })!;
  assert.equal(built.message.kind, 'todays_5');
  assert.equal(built.message.subject, '5 deals today · 1 price drop on a deal you kept');
  assert.deepEqual(built.changeIds, ['a1']);
  const quiet = buildDaily({ siteUrl: SITE, now: NOW, pick, teasers, changes: [], freeCutoffIso: null, unsubscribe: null })!;
  assert.equal(quiet.message.subject, '5 deals today · top pick: 2-bed to buy in Nottingham, 42% above a long let');
  // A change the builder refuses is not counted either.
  const refused = buildDaily({ siteUrl: SITE, now: NOW, pick, teasers, changes: [change({ newAmount: 999_999 })], freeCutoffIso: null, unsubscribe: null })!;
  assert.doesNotMatch(refused.message.subject, /price drop/);
  assert.deepEqual(refused.changeIds, []);
});

test('changes only: a short email about the changes; nothing at all: no email', () => {
  const built = buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [], changes: [change(), change({ id: 'a2', alertType: 'gone', status: 'under_offer', stage: 'viewing' })], freeCutoffIso: null, unsubscribe: null })!;
  assert.equal(built.message.kind, 'deal_changes');
  assert.equal(built.message.subject, '1 price drop on a deal you kept · 1 deal you track has gone');
  assert.equal(buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [], changes: [], freeCutoffIso: null, unsubscribe: null }), null);
  assert.equal(buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [], changes: [change({ newAmount: 300_000 })], freeCutoffIso: null, unsubscribe: null }), null);
});

test('changesPhrase keeps to two parts and counts the rest', () => {
  const list: ChangeInput[] = [change(), change({ id: 'b', alertType: 'back_on_market' }), change({ id: 'c', alertType: 'gone', status: 'sold' }), change({ id: 'd', alertType: 'gone', status: 'sold' })];
  assert.equal(changesPhrase(list), '1 price drop on a deal you kept · 1 deal you kept is back on the market · 2 more changes');
  assert.equal(changesPhrase([]), null);
});

test('every rendered email carries Manage notifications, and one-click unsubscribe when given', () => {
  const built = buildDaily({
    siteUrl: SITE,
    now: NOW,
    pick: null,
    teasers: [card()],
    changes: [],
    freeCutoffIso: null,
    unsubscribe: { label: 'Stop these emails', url: `${SITE}/api/notify/unsubscribe/tok?confirm=1`, oneClickUrl: `${SITE}/api/notify/unsubscribe/tok` },
  })!;
  const e = renderEmail(built.message);
  assert.ok(e.text.includes(`${SITE}/account/notifications`));
  assert.ok(e.html.includes(`href="${SITE}/account/notifications"`));
  assert.equal(e.headers['List-Unsubscribe'], `<${SITE}/api/notify/unsubscribe/tok>, <${SITE}/api/notify/unsubscribe/tok?confirm=1>`);
  assert.equal(e.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(e.text.includes('Open Today'));
  const bare = renderEmail({ ...built.message, unsubscribe: null });
  assert.deepEqual(bare.headers, {});
  assert.ok(bare.text.includes('Manage notifications'));
});

test('whatever a listing calls itself cannot inject markup', () => {
  const built = buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [card({ town: '<script>alert(1)</script>' })], changes: [change({ town: '<img src=x onerror=1>' })], freeCutoffIso: null, unsubscribe: null })!;
  const e = renderEmail(built.message);
  assert.ok(!e.html.includes('<script>'));
  assert.ok(!e.html.includes('<img src=x'));
  assert.ok(e.html.includes('&lt;script&gt;'));
});

test('changes the builder refuses are reported, so a sent email can close them', () => {
  const built = buildDaily({ siteUrl: SITE, now: NOW, pick, teasers: [], changes: [change(), change({ id: 'up', newAmount: 250_000, mergedIds: ['up2'] })], freeCutoffIso: null, unsubscribe: null })!;
  assert.deepEqual(built.changeIds, ['a1']);
  assert.deepEqual(built.refusedIds, ['up', 'up2']);
});
