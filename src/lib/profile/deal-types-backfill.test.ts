import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillProfile, beforeOf, shortId } from './deal-types-backfill.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import { DEFAULT_ABOUT, type AboutYou, type Role } from './about.ts';

const NOW = new Date('2026-09-29T12:00:00Z');
const AT = '2026-09-20T10:00:00Z';
const about = (roles: Role[], extra: Partial<AboutYou> = {}): AboutYou => ({ ...DEFAULT_ABOUT, roles, ...extra });
const goals = (extra: Partial<MarketGoals> = {}): MarketGoals => ({ ...DEFAULT_GOALS, ...extra });

test('the three live profiles with answers (29 Sep) map as the plan says', () => {
  const kindRent = backfillProfile(goals({ sourcingKind: 'rent' }), null, {}, NOW);
  assert.equal(kindRent.status, 'map');
  if (kindRent.status === 'map') assert.deepEqual(kindRent.after.types, ['r2r']);
  const r2r = backfillProfile(goals({ path: 'r2r', sourcingKind: 'rent' }), about(['r2r']), {}, NOW);
  if (r2r.status === 'map') assert.deepEqual(r2r.after.types, ['r2r']);
  const both = backfillProfile(goals({ path: 'r2r', sourcingKind: 'rent', budget: '200-350' }), about(['investor', 'r2r'], { mainRole: 'r2r' }), {}, NOW);
  assert.equal(both.status, 'map');
  if (both.status === 'map') {
    assert.deepEqual(both.after.types, ['buy_str', 'r2r']);
    assert.equal(both.goals.sourcingKind, 'both');
    assert.equal(both.after.brrrBudget, null, 'no BRRR: Condition was never answered');
  }
});

test('Condition refresh or project adds BRRR: its budget a copy of the buy budget (Q19), its work Light or Either (Q24)', () => {
  const refresh = backfillProfile(goals({ path: 'buy', budget: 'u200', buyer: { ...DEFAULT_GOALS.buyer, condition: 'refresh' } }), about(['investor']), { budget: { at: AT, notSure: false } }, NOW);
  assert.equal(refresh.status, 'map');
  if (refresh.status === 'map') {
    assert.deepEqual(refresh.after.types, ['buy_str', 'brrr']);
    assert.equal(refresh.after.brrrBudget, 'u200');
    assert.equal(refresh.after.brrrWork, 'light');
    assert.ok(refresh.marks.deal_types && refresh.marks.brrr_budget && refresh.marks.brrr_work, 'the new mandatory questions are answered: no trip back through the gate');
    assert.ok(refresh.marks.budget, 'existing marks kept');
  }
  const project = backfillProfile(goals({ path: 'buy', budget: '200-350', buyer: { ...DEFAULT_GOALS.buyer, condition: 'project' } }), about(['investor']), {}, NOW);
  if (project.status === 'map') assert.equal(project.after.brrrWork, 'either');
  const noBudget = backfillProfile(goals({ path: 'buy', budget: null, buyer: { ...DEFAULT_GOALS.buyer, condition: 'project' } }), about(['investor']), {}, NOW);
  if (noBudget.status === 'map') assert.equal(noBudget.marks.brrr_budget, undefined, 'no budget to copy: the question stays open');
});

test('idempotent: a profile with types is left alone; one with nothing to go on waits for its next visit (Q22)', () => {
  assert.equal(backfillProfile(goals({ dealTypes: ['r2r'] }), about(['investor']), {}, NOW).status, 'already');
  assert.equal(backfillProfile(goals(), null, {}, NOW).status, 'nothing');
  assert.equal(backfillProfile(null, about(['investor']), {}, NOW).status, 'no_goals');
  const once = backfillProfile(goals({ path: 'buy' }), about(['investor']), {}, NOW);
  assert.equal(once.status, 'map');
  if (once.status === 'map') assert.equal(backfillProfile(once.goals, about(['investor']), once.marks, NOW).status, 'already', 'the second run changes nothing');
});

test('managers from their path, sourcers by who they source for; the rent-to-rent minimum copied across', () => {
  const manager = backfillProfile(goals({ path: 'manage' }), about(['manager']), {}, NOW);
  if (manager.status === 'map') assert.deepEqual(manager.after.types, ['buy_str']);
  const sourcer = backfillProfile(goals({ path: 'source', sourcer: { ...DEFAULT_GOALS.sourcer, sourceFor: 'r2r' } }), about(['sourcer']), {}, NOW);
  if (sourcer.status === 'map') assert.deepEqual(sourcer.after.types, ['r2r']);
  const r2r = backfillProfile(goals({ path: 'r2r', sourcingKind: 'rent', finance: { ...DEFAULT_GOALS.finance, targetMarginPcm: 600 } }), about(['r2r']), {}, NOW);
  if (r2r.status === 'map') {
    assert.equal(r2r.after.r2rMinProfit, 600);
    assert.equal(r2r.goals.r2r.minMarginPcm, 600);
  }
});

test('the dry run prints option keys and short ids only', () => {
  const b = beforeOf(goals({ path: 'buy', budget: 'u200' }), about(['investor'], { mainRole: 'investor' }));
  assert.deepEqual(b, { roles: ['investor'], mainRole: 'investor', exploringPick: null, path: 'buy', kind: 'sale', sourceFor: null, condition: null, budget: 'u200' });
  assert.equal(shortId('0123456789abcdef'), '01234567');
  assert.equal(shortId(null), null);
});
