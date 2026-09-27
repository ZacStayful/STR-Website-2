import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS, answerLabel, applyAnswer, clearAnswer, currentValue, emptyAnswers, imageOf, moneyQuestionFor, optionsOf, questionsFor, text, type Answers, type QuestionId } from './questions.ts';
import { DEFAULT_GOALS, GOAL_OPTIONS } from '../market/goals.ts';
import { ABOUT_OPTIONS, DEFAULT_ABOUT } from './about.ts';
import { QUIZ_IMAGES } from './images.ts';

const fresh = (): Answers => emptyAnswers(DEFAULT_GOALS, null, []);

function answer(a: Answers, id: QuestionId, value: unknown): Answers {
  const r = applyAnswer(id, value, a);
  assert.ok(r.ok, `${id}: ${r.ok ? '' : r.error}`);
  return r.answers;
}

test('every question has an id, a why line, a photo or answer cards, and a short label', () => {
  const ids = new Set<string>();
  for (const q of QUESTIONS) {
    assert.ok(!ids.has(q.id), `duplicate ${q.id}`);
    ids.add(q.id);
    assert.ok(q.short.length > 0, q.id);
    const a = fresh();
    assert.ok(text(q.why, a).length > 0, `${q.id} has no why`);
    assert.ok(text(q.title, a).length > 0, `${q.id} has no title`);
    const img = imageOf(q, a);
    if (img === 'cards') {
      const opts = optionsOf(q, a);
      assert.ok(opts.some((o) => o.image && o.image !== 'plain'), `${q.id}: answer cards carry no photo`);
      for (const o of opts) if (o.image && o.image !== 'plain') assert.ok(o.image in QUIZ_IMAGES, `${q.id}: ${o.image}`);
    } else {
      assert.ok(img in QUIZ_IMAGES, `${q.id}: no image for ${img}`);
    }
    if (q.kind === 'single' || q.kind === 'multi') assert.ok(optionsOf(q, { ...a, about: { ...a.about, roles: ['investor', 'r2r'] } }).length >= 2, `${q.id} has no options`);
  }
});

test('the three mandatory questions are the only ones without "Not sure", and every option value is stored as given', () => {
  const mandatory = QUESTIONS.filter((q) => q.mandatory).map((q) => q.id).sort();
  assert.deepEqual(mandatory, ['budget', 'exploring_pick', 'main_role', 'max_rent', 'roles', 'where'].sort(), 'which describes you (and its follow-ups), where, and the money question for each path');
  // Every single-choice option round-trips through applyAnswer and reads back with its label.
  for (const q of QUESTIONS) {
    if (q.kind !== 'single' || q.id === 'main_role') continue;
    const base: Answers = { ...fresh(), goals: { ...DEFAULT_GOALS, path: 'buy' }, about: { ...DEFAULT_ABOUT, roles: ['investor'], mainRole: 'investor' } };
    for (const o of optionsOf(q, base)) {
      const r = applyAnswer(q.id, o.value, base);
      assert.ok(r.ok, `${q.id} refused ${o.value}`);
      assert.equal(currentValue(q.id, r.answers), o.value, `${q.id}: ${o.value} did not store`);
      assert.equal(answerLabel(q.id, r.answers), o.label);
    }
    assert.equal(applyAnswer(q.id, 'not-an-option', base).ok, false, `${q.id} accepts junk`);
  }
});

test('the questions a member gets follow their path, in order, with the money question third', () => {
  let a = fresh();
  assert.deepEqual(questionsFor(a).slice(0, 2).map((q) => q.id), ['roles', 'where'], 'nothing path-specific until they say what they do');
  a = answer(a, 'roles', ['investor']);
  assert.equal(a.goals.path, 'buy');
  assert.equal(a.goals.sourcingKind, 'sale');
  const ids = questionsFor(a).map((q) => q.id);
  assert.deepEqual(ids.slice(0, 3), ['roles', 'where', 'budget']);
  assert.ok(ids.includes('cash_available') && ids.includes('leasehold'), 'the buying section');
  assert.ok(!ids.includes('setup_budget') && !ids.includes('source_for') && !ids.includes('units_managed'), 'no other section');
  assert.ok(!ids.includes('unit_areas'), 'unit areas only once they say they run some');
  a = answer(a, 'units_now', '3-5');
  assert.ok(questionsFor(a).some((q) => q.id === 'unit_areas'));
  a = answer(a, 'units_now', '0');
  assert.ok(!questionsFor(a).some((q) => q.id === 'unit_areas'));
  assert.deepEqual(a.about.unitAreas, []);
});

test('two roles ask for the main one; "just exploring" asks what sounds interesting', () => {
  let a = answer(fresh(), 'roles', ['investor', 'sourcer']);
  assert.equal(a.goals.path, null);
  assert.deepEqual(questionsFor(a).slice(0, 3).map((q) => q.id), ['roles', 'main_role', 'where']);
  assert.deepEqual(optionsOf(QUESTIONS.find((q) => q.id === 'main_role')!, a).map((o) => o.value), ['investor', 'sourcer']);
  assert.equal(applyAnswer('main_role', 'manager', a).ok, false, 'must be one they ticked');
  a = answer(a, 'main_role', 'sourcer');
  assert.equal(a.goals.path, 'source');
  assert.equal(a.goals.sourcingKind, 'both');
  assert.equal(moneyQuestionFor(a.goals.path), 'budget');
  assert.ok(questionsFor(a).some((q) => q.id === 'source_for'));
  assert.ok(!questionsFor(a).some((q) => q.id === 'client_rent'), 'clients’ rent only once they source for operators');
  a = answer(a, 'source_for', 'r2r');
  assert.equal(a.goals.sourcingKind, 'rent');
  assert.ok(questionsFor(a).some((q) => q.id === 'client_rent'));

  let e = answer(fresh(), 'roles', ['exploring']);
  assert.deepEqual(questionsFor(e).slice(0, 3).map((q) => q.id), ['roles', 'exploring_pick', 'where']);
  e = answer(e, 'exploring_pick', 'r2r');
  assert.equal(e.goals.path, 'r2r');
  assert.equal(moneyQuestionFor(e.goals.path), 'max_rent');
  assert.deepEqual(questionsFor(e).slice(0, 4).map((q) => q.id), ['roles', 'exploring_pick', 'where', 'max_rent']);
});

test('where: near needs a postcode and a radius, areas need areas, anywhere needs nothing', () => {
  const a = fresh();
  assert.equal(applyAnswer('where', { mode: 'near' }, a).ok, false);
  assert.equal(applyAnswer('where', { mode: 'near', postcode: 'NG2 5GB', miles: 15 }, a).ok, false, 'not a step of ten');
  const near = answer(a, 'where', { mode: 'near', postcode: 'ng2 5gb', miles: '40' });
  assert.deepEqual(near.goals.home, { postcode: 'NG2 5GB', lat: null, lng: null });
  assert.equal(near.goals.maxDistanceMiles, 40);
  assert.equal(near.goals.where, 'near');
  assert.deepEqual(near.savedAreas, []);
  assert.equal(answerLabel('where', near), 'Within 40 miles of NG2');

  // The same postcode keeps its coordinates; a new one loses them (the server places it).
  const placed = { ...near, goals: { ...near.goals, home: { ...near.goals.home!, lat: 52.9, lng: -1.1 } } };
  assert.equal(answer(placed, 'where', { mode: 'near_plus_best', postcode: 'NG2 5GB', miles: 60 }).goals.home?.lat, 52.9);
  assert.equal(answer(placed, 'where', { mode: 'near', postcode: 'M1 1AE', miles: 60 }).goals.home?.lat, null);
  assert.equal(answerLabel('where', answer(placed, 'where', { mode: 'near_plus_best', postcode: 'NG2 5GB', miles: 60 })), 'Within 60 miles of NG2, plus the best elsewhere');

  assert.equal(applyAnswer('where', { mode: 'areas', areas: [] }, a).ok, false);
  const areas = answer(placed, 'where', { mode: 'areas', areas: ['ng', 'M', 'ZZ'] });
  assert.equal(areas.goals.home, null);
  assert.equal(areas.goals.maxDistanceMiles, null);
  assert.deepEqual(areas.savedAreas, ['NG', 'M']);
  assert.equal(answerLabel('where', areas), 'Nottingham, Manchester');

  const anywhere = answer(areas, 'where', { mode: 'anywhere' });
  assert.deepEqual(anywhere.savedAreas, []);
  assert.equal(anywhere.goals.home, null);
  assert.equal(answerLabel('where', anywhere), 'Anywhere in the UK');
  assert.equal(applyAnswer('where', { mode: 'space' }, a).ok, false);
});

test('money, rent, finance and profit are checked and read back', () => {
  let a = answer(fresh(), 'roles', ['investor']);
  assert.equal(applyAnswer('budget', 'any', a).ok, false);
  a = answer(a, 'budget', '350-500');
  assert.equal(a.goals.budget, '350-500');
  assert.equal(answerLabel('budget', a), '£350k–£500k');

  assert.equal(applyAnswer('max_rent', 50, a).ok, false);
  a = answer(a, 'max_rent', '£1,250');
  assert.equal(a.goals.maxRentPcm, 1250);
  assert.equal(answerLabel('max_rent', a), 'Up to £1,250 a month');

  assert.equal(applyAnswer('finance', { depositPct: 120, mortgageRatePct: 5 }, a).ok, false);
  a = answer(a, 'finance', { depositPct: '15', mortgageRatePct: 6.2 });
  assert.equal(a.goals.finance.depositPct, 15);
  assert.equal(a.goals.finance.mortgageRatePct, 6.2);
  assert.equal(a.goals.finance.termYears, 25, 'the rest of finance is untouched');
  assert.equal(answerLabel('finance', a), '15% deposit, 6.2% rate');

  assert.equal(applyAnswer('min_profit', -5, a).ok, false);
  a = answer(a, 'min_profit', '800');
  assert.equal(a.goals.finance.targetMarginPcm, 800);
  assert.equal(answerLabel('min_profit', a), '£800 a month');
  assert.equal(answerLabel('r2r_min_profit', a), '£800 a month', 'the same field for both paths');
});

test('the two mirrors: time sets management, risk sets risk appetite; "Not sure" puts them back', () => {
  let a = answer(fresh(), 'time', 'hands_on');
  assert.equal(a.goals.management, 'self');
  a = answer(a, 'risk', 'go');
  assert.equal(a.goals.riskAppetite, 'tolerant');
  a = clearAnswer('time', a);
  assert.equal(a.about.time, null);
  assert.equal(a.goals.management, 'managed');
  a = clearAnswer('risk', a);
  assert.equal(a.goals.riskAppetite, 'balanced');
  assert.equal(answerLabel('risk', a), null);
});

test('"Not sure" clears every optional answer and leaves the mandatory ones alone', () => {
  let a = answer(fresh(), 'roles', ['investor']);
  a = answer(a, 'where', { mode: 'anywhere' });
  a = answer(a, 'budget', 'u200');
  for (const q of QUESTIONS) {
    if (q.mandatory) continue;
    const cleared = clearAnswer(q.id, a);
    const v = currentValue(q.id, cleared);
    if (q.kind === 'finance') assert.deepEqual(v, { depositPct: 25, mortgageRatePct: 5.5 }, q.id);
    else if (q.kind === 'profit') assert.equal(v, 500, q.id);
    else if (q.id === 'motivated_sellers') assert.equal(v, 'off');
    else assert.equal(v, null, q.id);
  }
  const same = clearAnswer('budget', a);
  assert.equal(same.goals.budget, 'u200');
  assert.equal(clearAnswer('roles', a).about.roles.length, 1);
});

test('areas answers, bedrooms and the numeric options', () => {
  let a = answer(fresh(), 'roles', ['manager']);
  assert.equal(applyAnswer('operating_areas', [], a).ok, false);
  a = answer(a, 'operating_areas', ['l', 'LS']);
  assert.deepEqual(a.goals.manager.operatingAreas, ['L', 'LS']);
  assert.equal(answerLabel('operating_areas', a), 'Liverpool, Leeds');
  a = answer(a, 'growth_target', '25');
  assert.equal(a.goals.manager.growthTarget, 25);
  assert.equal(answerLabel('growth_target', a), '+25 units');
  assert.equal(applyAnswer('growth_target', 7, a).ok, false);

  let b = answer(fresh(), 'roles', ['investor']);
  b = answer(b, 'bedrooms', '4');
  assert.equal(b.goals.bedrooms, 4);
  assert.equal(answerLabel('bedrooms', b), '4 or more');
  assert.equal(applyAnswer('bedrooms', '5', b).ok, false);

  let r = answer(fresh(), 'roles', ['r2r']);
  r = answer(r, 'break_even', '60');
  r = answer(r, 'payback', 18);
  assert.equal(r.goals.r2r.breakEvenOccupancyPct, 60);
  assert.equal(r.goals.r2r.paybackMonths, 18);
  assert.equal(applyAnswer('break_even', 65, r).ok, false);
  r = answer(r, 'unit_areas', ['NG']);
  assert.deepEqual(r.about.unitAreas, ['NG']);
});

test('the option lists in the questions match the stored vocabularies', () => {
  const single = (id: QuestionId) => optionsOf(QUESTIONS.find((q) => q.id === id)!, fresh()).map((o) => o.value);
  assert.deepEqual(single('cash_available'), [...GOAL_OPTIONS.cashAvailable]);
  assert.deepEqual(single('funding'), [...GOAL_OPTIONS.funding]);
  assert.deepEqual(single('deal_structure'), [...GOAL_OPTIONS.dealStructure]);
  assert.deepEqual(single('units_managed'), [...GOAL_OPTIONS.unitsManaged]);
  assert.deepEqual(single('deals_done'), [...ABOUT_OPTIONS.dealsDone]);
  assert.deepEqual(single('blocker'), [...ABOUT_OPTIONS.blocker]);
  assert.deepEqual(single('risk'), [...ABOUT_OPTIONS.risk]);
  assert.deepEqual(single('where'), [...GOAL_OPTIONS.where]);
});
