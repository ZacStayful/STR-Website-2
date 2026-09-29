import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealTypeOf, dealTypesFor, describeTypes, kindsFor, legacyDealTypes, typeFromPickReasons, typesShown, withAddedType, type DealType } from './deal-types.ts';
import { DEFAULT_GOALS, parseMarketGoals, type MarketGoals } from '../market/goals.ts';
import { DEFAULT_ABOUT, type AboutYou, type Role } from './about.ts';

const about = (roles: Role[], extra: Partial<AboutYou> = {}): AboutYou => ({ ...DEFAULT_ABOUT, roles, mainRole: roles.length === 1 ? roles[0] : null, ...extra });
const goals = (extra: Partial<MarketGoals> = {}): MarketGoals => ({ ...DEFAULT_GOALS, ...extra });

test('a chosen answer wins, in the question’s order', () => {
  assert.deepEqual(dealTypesFor({ goals: goals({ dealTypes: ['r2r', 'buy_str'] }), about: about(['investor']) }), ['buy_str', 'r2r']);
});

test('existing members map across silently (decided 29 Sep)', () => {
  const cases: [string, AboutYou, MarketGoals, string[]][] = [
    ['investor', about(['investor']), goals({ path: 'buy' }), ['buy_str']],
    ['r2r', about(['r2r']), goals({ path: 'r2r', sourcingKind: 'rent' }), ['r2r']],
    ['both roles, whatever the main one', about(['investor', 'r2r'], { mainRole: 'r2r' }), goals({ path: 'r2r', sourcingKind: 'rent' }), ['buy_str', 'r2r']],
    ['condition light refresh adds BRRR', about(['investor']), goals({ path: 'buy', buyer: { ...DEFAULT_GOALS.buyer, condition: 'refresh' } }), ['buy_str', 'brrr']],
    ['condition full project adds BRRR', about(['investor']), goals({ path: 'buy', buyer: { ...DEFAULT_GOALS.buyer, condition: 'project' } }), ['buy_str', 'brrr']],
    ['ready to go adds nothing', about(['investor']), goals({ path: 'buy', buyer: { ...DEFAULT_GOALS.buyer, condition: 'ready' } }), ['buy_str']],
    ['sourcer for buyers', about(['sourcer']), goals({ path: 'source', sourcer: { ...DEFAULT_GOALS.sourcer, sourceFor: 'buyers' } }), ['buy_str']],
    ['sourcer for rent-to-rent', about(['sourcer']), goals({ path: 'source', sourcer: { ...DEFAULT_GOALS.sourcer, sourceFor: 'r2r' } }), ['r2r']],
    ['sourcer for both', about(['sourcer']), goals({ path: 'source', sourcer: { ...DEFAULT_GOALS.sourcer, sourceFor: 'both' } }), ['buy_str', 'r2r']],
    ['sourcer who has not said', about(['sourcer']), goals({ path: 'source' }), ['buy_str', 'r2r']],
    ['exploring, picked buying', about(['exploring'], { exploringPick: 'buy' }), goals({ path: 'buy' }), ['buy_str']],
    ['exploring, picked rent-to-rent', about(['exploring'], { exploringPick: 'r2r' }), goals({ path: 'r2r', sourcingKind: 'rent' }), ['r2r']],
    ['exploring, picked sourcing', about(['exploring'], { exploringPick: 'source' }), goals({ path: 'source', sourcingKind: 'both' }), ['buy_str', 'r2r']],
    ['management company, from its path (Q21)', about(['manager']), goals({ path: 'manage' }), ['buy_str']],
    ['no roles, a rent kind chosen', about([]), goals({ sourcingKind: 'rent' }), ['r2r']],
  ];
  for (const [name, a, g, want] of cases) assert.deepEqual(legacyDealTypes({ goals: g, about: a }), want, name);
});

test('a profile with nothing yet: no types, shown Short-let + Rent-to-rent, never BRRR (Q22), and nothing throws', () => {
  assert.deepEqual(dealTypesFor({ goals: goals(), about: about([]) }), []);
  assert.deepEqual(dealTypesFor({ goals: null, about: null }), []);
  assert.deepEqual(dealTypesFor(null), []);
  assert.deepEqual(typesShown(null), ['buy_str', 'r2r']);
  assert.deepEqual(typesShown({ goals: null, about: about(['exploring']) }), ['buy_str', 'r2r']);
});

test('a deal’s type: a rental is rent-to-rent, a sale with a Project estimate BRRR, any other sale Short-let', () => {
  assert.equal(dealTypeOf({ kind: 'rent' }), 'r2r');
  assert.equal(dealTypeOf({ kind: 'sale' }), 'buy_str');
  assert.equal(dealTypeOf({ kind: 'sale', project: null }), 'buy_str');
  assert.equal(dealTypeOf({ kind: 'sale', project: { v: 1, level: 'full' } }), 'buy_str', 'an unusable estimate is not a Project deal');
  const project = { v: 1, level: 'full', price: 70_000, bedrooms: 3, worksLow: 26_620, worksHigh: 39_710, value: 127_800, valueAdded: 18_090, valueAddedPct: 14.2, months: 4, cashLow: 74_766, cashHigh: 87_856 };
  assert.equal(dealTypeOf({ kind: 'sale', project }), 'brrr');
});

test('kinds for the searches, and the words for the page', () => {
  assert.equal(kindsFor(['buy_str']), 'sale');
  assert.equal(kindsFor(['brrr']), 'sale');
  assert.equal(kindsFor(['r2r']), 'rent');
  assert.equal(kindsFor(['brrr', 'r2r']), 'both');
  assert.equal(kindsFor([]), 'both', 'unanswered: Short-let + Rent-to-rent');
  assert.equal(describeTypes(['r2r', 'buy_str']), 'Short-let · Rent-to-rent');
  assert.equal(describeTypes(['buy_str', 'brrr', 'r2r']), 'All of them');
});

test('goals keep the new answers through a save and a read', () => {
  const g = parseMarketGoals({ version: 2, dealTypes: ['brrr', 'buy_str', 'brrr', 'nonsense'], brrr: { budget: 'u200', work: 'either' }, r2r: { minMarginPcm: 700 } });
  assert.deepEqual(g?.dealTypes, ['buy_str', 'brrr']);
  assert.deepEqual(g?.brrr, { budget: 'u200', work: 'either' });
  assert.equal(g?.r2r.minMarginPcm, 700);
  const old = parseMarketGoals({ version: 2 });
  assert.equal(old?.dealTypes, null, 'never answered');
  assert.deepEqual(old?.brrr, { budget: null, work: null });
  assert.equal(old?.r2r.minMarginPcm, null);
  assert.equal(parseMarketGoals({ version: 2, dealTypes: [] })?.dealTypes, null);
});

test('"I want rent-to-rent, not to buy" adds Rent-to-rent to the profile (Q25); the reverse adds Short-let; both at once cancel', () => {
  assert.equal(typeFromPickReasons(['want_r2r', 'too_expensive']), 'r2r');
  assert.equal(typeFromPickReasons(['want_buy']), 'buy_str');
  assert.equal(typeFromPickReasons(['want_r2r', 'want_buy']), null);
  assert.equal(typeFromPickReasons(['too_small']), null);
  const buyer = { goals: { ...DEFAULT_GOALS, dealTypes: ['buy_str'] as DealType[] }, about: null };
  const next = withAddedType(buyer, 'r2r')!;
  assert.deepEqual(next.dealTypes, ['buy_str', 'r2r']);
  assert.equal(next.sourcingKind, 'both');
  assert.equal(withAddedType({ goals: next, about: null }, 'r2r'), null, 'already there: nothing to write');
  // A profile not yet on types: its older answers mapped first, then the new type.
  const legacy = withAddedType({ goals: { ...DEFAULT_GOALS, path: 'buy' }, about: null }, 'r2r')!;
  assert.deepEqual(legacy.dealTypes, ['buy_str', 'r2r']);
  assert.equal(withAddedType({ goals: null, about: null }, 'r2r'), null);
});

test('adding a type adds to what the profile is shown, never switches it (Q25)', () => {
  // Goals with nothing that maps: shown Short-let + Rent-to-rent (Q22).
  const nothing = { goals: { ...DEFAULT_GOALS }, about: null };
  assert.deepEqual(typesShown(nothing), ['buy_str', 'r2r']);
  assert.equal(withAddedType(nothing, 'r2r'), null, 'already shown: nothing to add');
  assert.deepEqual([...(withAddedType(nothing, 'brrr')?.dealTypes ?? [])].sort(), ['brrr', 'buy_str', 'r2r']);
  assert.equal(withAddedType(nothing, 'brrr')?.sourcingKind, 'both');
});
