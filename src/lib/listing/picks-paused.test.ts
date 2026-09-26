import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missedRowFor, missesToList, pausedEmail, pausedEmailDue, missedPickLine, type MissedPick } from './picks-paused.ts';
import type { SourcedListing } from './sourcing.ts';
import type { Screening } from './screen.ts';

const NOW = new Date('2026-09-25T08:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

const miss = (over: Partial<MissedPick> = {}): MissedPick => ({
  missedAt: daysAgo(0),
  kind: 'sale',
  areaName: 'Nottingham',
  bedrooms: 2,
  priceAmount: 185_000,
  pricePeriod: 'total',
  annualProfit: 9_400,
  emailedAt: null,
  ...over,
});

test('the first day picks pause is always due', () => {
  assert.equal(pausedEmailDue({ lastEmailAt: null, lastPickSentAt: daysAgo(1), now: NOW }), true);
  assert.equal(pausedEmailDue({ lastEmailAt: null, lastPickSentAt: null, now: NOW }), true);
});

test('while still out of credit, at most one letter every seven days', () => {
  assert.equal(pausedEmailDue({ lastEmailAt: daysAgo(3), lastPickSentAt: daysAgo(10), now: NOW }), false);
  assert.equal(pausedEmailDue({ lastEmailAt: daysAgo(6.9), lastPickSentAt: daysAgo(10), now: NOW }), false);
  assert.equal(pausedEmailDue({ lastEmailAt: daysAgo(7), lastPickSentAt: daysAgo(10), now: NOW }), true);
  assert.equal(pausedEmailDue({ lastEmailAt: daysAgo(30), lastPickSentAt: null, now: NOW }), true);
});

test('credit came back and picks resumed, then ran out again: a new first day', () => {
  // Letter on day -5, a pick went out on day -2 (they topped up), paused again today.
  assert.equal(pausedEmailDue({ lastEmailAt: daysAgo(5), lastPickSentAt: daysAgo(2), now: NOW }), true);
  // A pick BEFORE the last letter is not a resume.
  assert.equal(pausedEmailDue({ lastEmailAt: daysAgo(2), lastPickSentAt: daysAgo(5), now: NOW }), false);
});

test('the letter lists what was missed since the last pick went out; older misses are superseded, emailed ones excluded', () => {
  const rows = [
    miss({ missedAt: daysAgo(6), id: 'old' }),
    miss({ missedAt: daysAgo(4), id: 'emailed', emailedAt: daysAgo(4) }),
    miss({ missedAt: daysAgo(1), id: 'b' }),
    miss({ missedAt: daysAgo(0), id: 'a' }),
  ];
  const { list, superseded } = missesToList(rows, daysAgo(2));
  assert.deepEqual(list.map((m) => m.id), ['b', 'a']);
  assert.deepEqual(superseded.map((m) => m.id), ['old']);
  // Never had a pick: everything un-emailed is listed, oldest first.
  assert.deepEqual(missesToList(rows, null).list.map((m) => m.id), ['old', 'b', 'a']);
});

test('a miss row keeps the figures and drops everything that identifies the listing', () => {
  const listing = {
    source: 'rightmove',
    id: 'x',
    canonicalUrl: 'https://www.rightmove.co.uk/properties/123',
    kind: 'rent',
    title: '2 bed flat',
    address: '14 Secret Street, Nottingham',
    postcode: 'NG1 1AA',
    outcode: 'NG1',
    postcodeArea: 'NG',
    lat: null,
    lng: null,
    bedrooms: 2,
    bathrooms: 1,
    price: { amount: 250, period: 'pw' },
    rawType: 'Flat',
    photo: null,
  } as unknown as SourcedListing;
  const screening = { kind: 'rent-to-rent', surplus: 7_100, annualProfit: 7_100 } as unknown as Screening;
  const row = missedRowFor(listing, screening);
  assert.deepEqual(row, { canonical_url: 'https://www.rightmove.co.uk/properties/123', kind: 'rent', postcode_area: 'NG', bedrooms: 2, price_amount: 1083, price_period: 'pcm', annual_profit: 7_100 });
  assert.ok(!('address' in row) && !('postcode' in row));
  const sale = missedRowFor({ ...listing, kind: 'sale', price: { amount: 185_000, period: 'total' } } as SourcedListing, null);
  assert.equal(sale.price_amount, 185_000);
  assert.equal(sale.price_period, 'total');
  assert.equal(sale.annual_profit, null);
});

test('each line says area, type, price and estimated profit', () => {
  assert.equal(missedPickLine(miss()), 'Nottingham · 2-bed Purchase · £185,000 · est. profit £9,400/yr');
  assert.equal(missedPickLine(miss({ kind: 'rent', bedrooms: null, priceAmount: 950, pricePeriod: 'pcm', annualProfit: 7_100 })), 'Nottingham · Rent-to-rent · £950 pcm · est. profit £7,100/yr');
  assert.equal(missedPickLine(miss({ priceAmount: null, pricePeriod: null, annualProfit: null })), 'Nottingham · 2-bed Purchase · price not stated · profit not estimated');
});

test('the letter is plain, has one Top up button, the manage link, and never the address, postcode or listing link', () => {
  const m = pausedEmail({ misses: [miss(), miss({ kind: 'rent', areaName: 'Leeds', bedrooms: null, priceAmount: 950, pricePeriod: 'pcm', annualProfit: 7_100, missedAt: daysAgo(1) })], siteUrl: 'https://intelligence.stayful.co.uk/', firstName: 'Sam' });
  assert.equal(m.subject, 'Your daily picks have paused: 2 picks you missed');
  assert.ok(m.text.startsWith('Hi Sam,'));
  assert.ok(m.text.includes('Nottingham · 2-bed Purchase · £185,000 · est. profit £9,400/yr'));
  assert.ok(m.text.includes('Leeds · Rent-to-rent · £950 pcm · est. profit £7,100/yr'));
  assert.ok(m.text.includes('https://intelligence.stayful.co.uk/account/billing'));
  assert.ok(m.text.includes('Manage notifications: https://intelligence.stayful.co.uk/account/notifications'));
  assert.equal((m.html.match(/<a /g) ?? []).length, 2, 'one button and one footer link');
  assert.ok(m.html.includes('href="https://intelligence.stayful.co.uk/account/billing"'));
  assert.ok(m.html.includes('>Top up</a>'));
  for (const secret of ['Secret Street', 'NG1 1AA', 'rightmove.co.uk', 'http://', 'properties/']) {
    assert.ok(!m.text.includes(secret) && !m.html.includes(secret), `no ${secret}`);
  }
  const one = pausedEmail({ misses: [miss()], siteUrl: 'https://x.test' });
  assert.equal(one.subject, 'Your daily picks have paused: 1 pick you missed');
  assert.ok(one.text.startsWith('Hi,'));
  assert.ok(one.text.includes('Here is the pick we found for you'));
});

test('the letter carries the changes the daily email would have, and says so in the subject', () => {
  const base = { misses: [miss()], siteUrl: 'https://x.test', firstName: null };
  const plain = pausedEmail(base);
  const extra = { text: 'CHANGES ON YOUR DEALS\n\n• Price drop: £200,000 → £185,000', html: '<h2>Changes on your deals</h2>', subjectSuffix: '1 price drop on a deal you kept' };
  const withChanges = pausedEmail({ ...base, extra });
  assert.equal(withChanges.subject, `${plain.subject} · 1 price drop on a deal you kept`);
  assert.ok(withChanges.text.includes('Price drop: £200,000 → £185,000'));
  assert.ok(withChanges.html.includes('<h2>Changes on your deals</h2>'));
  // Manage notifications still closes the letter, after the changes.
  assert.ok(withChanges.text.indexOf('Price drop') < withChanges.text.indexOf('Manage notifications'));
  // With nothing extra the letter is exactly as it was.
  assert.deepEqual(pausedEmail({ ...base, extra: null }), plain);
});
