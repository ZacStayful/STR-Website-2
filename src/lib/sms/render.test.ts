import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChangeInput } from '../notify/message.ts';
import { fitsOneSegment, gsmLength, isGsm, MAX_SMS_LENGTH } from './gsm.ts';
import { myDealsLink, renderable, renderSmsText } from './render.ts';

const LINK = myDealsLink('https://intelligence.stayful.co.uk');

const change = (over: Partial<ChangeInput>): ChangeInput => ({
  id: over.id ?? 'a1',
  alertType: 'price_drop',
  kind: 'rent',
  opened: false,
  town: 'Leeds',
  type: '2 bed flat',
  stage: 'watching',
  oldAmount: 1150,
  newAmount: 1050,
  period: 'pcm',
  figure: '£9,800/yr · profit after rent',
  ...over,
});

const valid = (body: string) => {
  assert.ok(isGsm(body), `plain GSM-7: ${JSON.stringify(body)}`);
  assert.ok((gsmLength(body) ?? 999) <= MAX_SMS_LENGTH, `≤160: ${gsmLength(body)} ${JSON.stringify(body)}`);
  assert.ok(fitsOneSegment(body));
  assert.ok(body.endsWith('Reply STOP to opt out'));
  assert.ok(body.includes(LINK));
};

test('the link is My deals on our own site, without the scheme', () => {
  assert.equal(LINK, 'intelligence.stayful.co.uk/my-deals');
  assert.equal(myDealsLink('http://localhost:3000/'), 'localhost:3000/my-deals');
});

test('one price drop: a sentence, the link, the opt-out', () => {
  const r = renderSmsText([change({})], LINK)!;
  assert.equal(r.body, 'Stayful: price drop on the 2 bed flat you kept in Leeds: now £1,050 pcm (was £1,150).\nintelligence.stayful.co.uk/my-deals\nReply STOP to opt out');
  valid(r.body);
  assert.deepEqual(r.counted.map((c) => c.id), ['a1']);
});

test('the profit figure is included when it fits', () => {
  const r = renderSmsText([change({ town: 'Hull', type: 'flat' })], LINK)!;
  assert.match(r.body, /Profit now £9\.8k\/yr\./);
  valid(r.body);
});

test('a purchase reads as a short price and its uplift', () => {
  const r = renderSmsText([change({ kind: 'sale', period: 'total', oldAmount: 200000, newAmount: 185000, figure: '+42% · £8,400/yr over a long let', type: 'house', town: 'York' })], LINK)!;
  assert.match(r.body, /now £185k \(was £200k\)/);
  assert.match(r.body, /\+42% vs a long let/);
  valid(r.body);
});

test('back on the market, getting attention and gone each read as one sentence', () => {
  const back = renderSmsText([change({ alertType: 'back_on_market', previousStatus: 'under_offer', newAmount: 1100, stage: 'viewing' })], LINK)!;
  assert.match(back.body, /^Stayful: The 2 bed flat you track in Leeds is back on the market at £1,100 pcm\./);
  valid(back.body);
  const hot = renderSmsText([change({ alertType: 'nearly_gone', watchers: 4 })], LINK)!;
  assert.match(hot.body, /is getting attention: 4 others opened or kept it this week\./);
  valid(hot.body);
  const gone = renderSmsText([change({ alertType: 'gone', status: 'let_agreed' })], LINK)!;
  assert.match(gone.body, /^Stayful: The 2 bed flat you kept in Leeds is now let agreed\./);
  valid(gone.body);
});

test('several changes: the count, the link, a line each, most important first', () => {
  const r = renderSmsText(
    [
      change({ id: 'p', stage: 'offer' }),
      change({ id: 'g', alertType: 'gone', status: 'under_offer', type: '3 bed house', town: 'York' }),
    ],
    LINK,
  )!;
  assert.equal(r.body, 'Stayful: 2 deal updates\nintelligence.stayful.co.uk/my-deals\nPrice drop: 2 bed flat, Leeds, now £1,050 pcm\nGone: 3 bed, York, under offer\nReply STOP to opt out');
  valid(r.body);
  assert.deepEqual(r.described.map((c) => c.id), ['p', 'g']);
});

test('what does not fit is counted as "+N more", and every change is still counted', () => {
  const many = Array.from({ length: 6 }, (_, i) => change({ id: `c${i}`, town: `Town number ${i}`, type: '4 bed semi-detached house' }));
  const r = renderSmsText(many, LINK)!;
  valid(r.body);
  assert.match(r.body, /^Stayful: 6 deal updates\n/);
  assert.match(r.body, /\n\+\d more\nReply STOP to opt out$/);
  assert.equal(r.counted.length, 6);
  assert.ok(r.described.length >= 1 && r.described.length < 6);
  const more = Number(r.body.match(/\+(\d) more/)![1]);
  assert.equal(r.described.length + more, 6);
});

test('never an address or a postcode, even for a deal the member opened', () => {
  const opened = change({ opened: true, address: '12 Acacia Avenue, Leeds LS6 2AB', town: 'Leeds' });
  for (const r of [renderSmsText([opened], LINK)!, renderSmsText([opened, change({ id: 'b', alertType: 'gone', status: 'sold', opened: true, address: '4 Mill Lane, YO1 7HH' })], LINK)!]) {
    assert.ok(!r.body.includes('Acacia'));
    assert.ok(!r.body.includes('LS6'));
    assert.ok(!r.body.includes('Mill Lane'));
    assert.ok(!r.body.includes('YO1'));
    assert.ok(!/rightmove|onthemarket|zoopla|https?:/i.test(r.body));
  }
});

test('typographic characters are made plain; unplaceable ones are dropped, not sent', () => {
  const curly = renderSmsText([change({ type: '2 bed “garden” flat · leasehold', town: 'St Albans' })], LINK)!;
  assert.match(curly.body, /the 2 bed "garden" flat you kept in St Albans/);
  valid(curly.body);
  const emoji = renderSmsText([change({ town: 'Leeds 🏠' })], LINK)!;
  assert.ok(!emoji.body.includes('🏠'));
  assert.match(emoji.body, /the 2 bed flat you kept:/); // the town could not be made plain, so it is left out
  valid(emoji.body);
});

test('nothing true to say means no text', () => {
  assert.equal(renderSmsText([], LINK), null);
  assert.equal(renderSmsText([change({ newAmount: 1200 })], LINK), null); // a rise is not a drop
  assert.equal(renderSmsText([change({ alertType: 'nearly_gone', watchers: 2 })], LINK), null);
  assert.equal(renderSmsText([change({ alertType: 'gone', status: 'mystery' })], LINK), null);
  assert.equal(renderable(change({ oldAmount: null })), false);
});

test('whatever the towns and types, a text is never over 160 or outside GSM-7', () => {
  const towns = ['Leeds', 'Kingston upon Hull', 'Newcastle upon Tyne', 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch', 'Ystradgynlais', null, 'Bishop’s Stortford'];
  const types = ['flat', '2 bed flat · leasehold', '5 bed detached house with annexe and paddock', null, 'maisonette'];
  const kinds: ChangeInput['alertType'][] = ['price_drop', 'back_on_market', 'nearly_gone', 'gone'];
  let n = 0;
  for (const town of towns) for (const type of types) for (const alertType of kinds) {
    const c = change({ id: `x${n++}`, town, type, alertType, status: 'under_offer', previousStatus: 'sold', watchers: 5, oldAmount: 1_250_000, newAmount: 1_199_999, period: 'total', kind: 'sale', figure: '+142% · £98,400/yr over a long let' });
    for (const set of [[c], [c, c, c], Array(9).fill(c)]) {
      const r = renderSmsText(set, LINK);
      assert.ok(r, `rendered ${town}/${type}/${alertType}`);
      valid(r.body);
    }
  }
});
