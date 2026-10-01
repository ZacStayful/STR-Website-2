import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DealCard } from '../marketplace/grid.ts';
import { buildDaily, changeItem, changesPhrase, profileNudgeLine, teaserItem, visibleTeasers, type ChangeInput, type Section } from './message.ts';
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
  assert.match(built.message.subject, /^I found 2 deals for you this morning/);
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
  assert.equal(built.message.subject, 'I found 5 deals for you this morning · 1 price drop on a deal you kept');
  assert.deepEqual(built.changeIds, ['a1']);
  const quiet = buildDaily({ siteUrl: SITE, now: NOW, pick, teasers, changes: [], freeCutoffIso: null, unsubscribe: null })!;
  assert.equal(quiet.message.subject, 'I found 5 deals for you this morning · top pick: 2-bed to buy in Nottingham, 42% above a long let');
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
  assert.ok(e.html.includes(`href="${SITE}/account/notifications?via=email"`));
  // Our own pages say they were reached from the email; unsubscribing does not.
  assert.ok(e.html.includes(`href="${SITE}/today?via=email"`));
  assert.ok(e.html.includes(`href="${SITE}/api/notify/unsubscribe/tok?confirm=1"`));
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

// ── Batch 12: the profile line ──

test('the profile line rides the daily email while the profile is incomplete, and is left out once it is', () => {
  const nudge = { percent: 60, url: `${SITE}/profile`, pence: 500 };
  const withLine = buildDaily({ siteUrl: SITE, now: NOW, pick, teasers: [card()], changes: [], freeCutoffIso: null, unsubscribe: null, profileNudge: nudge })!;
  const notice = withLine.message.sections.find((s) => s.key === 'notice');
  assert.ok(notice, 'one notice section');
  assert.equal(withLine.message.sections[withLine.message.sections.length - 1], notice, 'at the end, after the deals');
  const textBlock = notice.blocks.find((b) => b.type === 'text');
  assert.ok(textBlock && textBlock.type === 'text');
  assert.equal(textBlock.text, 'Your profile is 60% done: finish it for better deals and £5 credit.');
  const buttons = notice.blocks.find((b) => b.type === 'buttons');
  assert.ok(buttons && buttons.type === 'buttons' && buttons.links[0].url === `${SITE}/profile`);
  const rendered = renderEmail(withLine.message);
  assert.match(rendered.html, /profile\?via=email/, 'the link is marked as an email click');
  assert.match(rendered.text, /Your profile is 60% done/);
  assert.equal(withLine.message.subject, buildDaily({ siteUrl: SITE, now: NOW, pick, teasers: [card()], changes: [], freeCutoffIso: null, unsubscribe: null })!.message.subject, 'the subject is untouched');

  const without = buildDaily({ siteUrl: SITE, now: NOW, pick, teasers: [card()], changes: [], freeCutoffIso: null, unsubscribe: null, profileNudge: null })!;
  assert.ok(!without.message.sections.some((s) => s.key === 'notice'));
  // The line alone never makes an email: nothing to say means no email, as before.
  assert.equal(buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [], changes: [], freeCutoffIso: null, unsubscribe: null, profileNudge: nudge }), null);
  assert.equal(profileNudgeLine({ percent: 33.4, pence: 0 }), 'Your profile is 33% done: finish it for better deals.');
  assert.equal(profileNudgeLine({ percent: 100, pence: 750 }), 'Your profile is 100% done: finish it for better deals and £7.50 credit.');
});

test('saved profiles: one headed part per profile, no deal twice, counts from every part, one unsubscribe', () => {
  const pickB: { section: Section; headline: string } = { section: { key: 'pick', title: null, blocks: [{ type: 'heading', text: '2 Other Road, Leeds' }] }, headline: '3-bed rent-to-rent in Leeds' };
  const built = buildDaily({
    siteUrl: SITE,
    now: NOW,
    pick: null,
    teasers: [],
    changes: [],
    freeCutoffIso: null,
    unsubscribe: { label: 'Stop daily picks', url: `${SITE}/u`, oneClickUrl: `${SITE}/u` },
    profiles: [
      { heading: 'My deals', pick, pickDealId: 'p1', teasers: [card({ id: 'a' }), card({ id: 'shared' })], todayUrl: `${SITE}/today` },
      { heading: 'Client: JS', pick: pickB, pickDealId: 'p2', teasers: [card({ id: 'shared' }), card({ id: 'p1' }), card({ id: 'b' })], todayUrl: `${SITE}/profiles/switch?to=x&next=%2Ftoday` },
    ],
    unfunded: ['Old'],
  })!;
  assert.deepEqual(built.teasersByPart, [['a', 'shared'], ['b']], 'a deal already told, or another profile’s pick, is left out');
  assert.equal(built.message.subject, 'I found 5 deals for you this morning · top pick: 2-bed to buy in Nottingham, 42% above a long let');
  const titles = built.message.sections.map((s) => s.title);
  assert.ok(titles.includes('For My deals') && titles.includes('For Client: JS'));
  assert.ok(titles.indexOf('For My deals') < titles.indexOf('For Client: JS'), 'the active profile first');
  const mail = renderEmail(built.message);
  assert.ok(mail.text.includes('/profiles/switch?to=x'), 'the second profile’s Today goes through the switch');
  assert.ok(mail.text.includes('Not sent today, because your credit ran out: Old.'));
  assert.equal(built.message.unsubscribe?.label, 'Stop daily picks', 'one unsubscribe for the whole email');
});

test('saved profiles: one profile needs no heading, and a profile with nothing today has no part', () => {
  const built = buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [], changes: [], freeCutoffIso: null, unsubscribe: null, profiles: [{ heading: null, pick, teasers: [card()] }, { heading: 'Empty', pick: null, teasers: [] }] })!;
  assert.ok(!built.message.sections.some((s) => s.key === 'profile'));
  assert.equal(buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [], changes: [], freeCutoffIso: null, unsubscribe: null, profiles: [{ heading: 'A', pick: null, teasers: [] }], unfunded: ['B'] }), null, 'an unfunded line alone is no email');
});

test('saved profiles: a change names its profile only when the sender gives a name', () => {
  assert.deepEqual(changeItem(change({ profileName: 'Client: JS' }), SITE)!.lines.slice(-1), ['For Client: JS']);
  assert.ok(!changeItem(change({ profileId: 'p1' }), SITE)!.lines.some((l) => l.startsWith('For ')));
});

test('Batch 14: a price drop says where the new price sits against the most they can pay', () => {
  const above = changeItem(change({ payGap: 'Now £6,000 above what you can pay' }), SITE)!;
  assert.ok(above.lines.includes('Now £6,000 above what you can pay'));
  const within = changeItem(change({ payGap: 'Now within what you can pay', figure: null }), SITE)!;
  assert.ok(within.lines.includes('Now within what you can pay'));
  // Without one the email is exactly as before.
  assert.ok(!changeItem(change(), SITE)!.lines.some((l) => /what you can pay/.test(l)));
});

test('Batch 14: each teaser carries "Yes, more like this" / "Not for me" on the send token and deal id only', () => {
  const leaky = { ...card({ id: '0b7c2b1e-5a1f-4c7e-9d7a-2f1e3c4b5a6d' }), canonical_url: 'https://www.rightmove.co.uk/properties/123', address: '12 High Street, York', postcode: 'YO24 1AB', photo: 'https://media.rightmove/x.jpg' } as DealCard;
  const built = buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [leaky], changes: [], freeCutoffIso: null, unsubscribe: null, answerToken: 'SendTok_1234567890abcdefghij' })!;
  const items = built.message.sections.flatMap((s) => s.blocks).flatMap((b) => (b.type === 'items' ? b.items : []));
  assert.deepEqual(items[0].links?.map((l) => l.label), ['Yes, more like this', 'Not for me']);
  assert.deepEqual(items[0].links?.map((l) => l.url), [
    `${SITE}/p/d/SendTok_1234567890abcdefghij/0b7c2b1e-5a1f-4c7e-9d7a-2f1e3c4b5a6d?a=yes`,
    `${SITE}/p/d/SendTok_1234567890abcdefghij/0b7c2b1e-5a1f-4c7e-9d7a-2f1e3c4b5a6d?a=no`,
  ]);
  const mail = renderEmail(built.message);
  for (const out of [mail.html, mail.text]) {
    assert.ok(out.includes('/p/d/SendTok_1234567890abcdefghij/0b7c2b1e-5a1f-4c7e-9d7a-2f1e3c4b5a6d?a=no'), 'drawn, and not marked ?via=email');
    for (const secret of ['High Street', 'YO24 1AB', 'rightmove.co.uk/properties', 'media.rightmove']) assert.ok(!out.includes(secret), `leaked ${secret}`);
  }
  const none = buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [card()], changes: [], freeCutoffIso: null, unsubscribe: null })!;
  assert.equal(none.message.sections.flatMap((s) => s.blocks).flatMap((b) => (b.type === 'items' ? b.items : []))[0].links, undefined, 'no token: no links');
});

test('Batch 14: "Act fast · new today" on a deal first seen in the last day, for a member whose next deal is this month', () => {
  const fresh = card({ id: 'new', first_seen_at: '2026-09-28T03:00:00Z' });
  const older = card({ id: 'old', first_seen_at: '2026-09-25T03:00:00Z' });
  const titles = (actFast: boolean) =>
    buildDaily({ siteUrl: SITE, now: NOW, pick: null, teasers: [fresh, older], changes: [], freeCutoffIso: null, unsubscribe: null, actFast })!
      .message.sections.flatMap((s) => s.blocks)
      .flatMap((b) => (b.type === 'items' ? b.items.map((i) => i.title) : []));
  assert.deepEqual(titles(true), ['Act fast · new today · +42% · £8,400/yr over a long let', '+42% · £8,400/yr over a long let']);
  assert.deepEqual(titles(false), ['+42% · £8,400/yr over a long let', '+42% · £8,400/yr over a long let']);
});
