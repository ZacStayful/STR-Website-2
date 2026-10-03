import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chipsFor, memberValuesFrom, type AnswerFacts, type RenderedAnswer } from './answers.ts';
import { renderEntry } from '../knowledge/render.ts';
import { SEED } from '../knowledge/seed.ts';
import { schemaSnapshot } from '../knowledge/test-fixtures.ts';

const facts: AnswerFacts = {
  balancePence: 1240, topupRate: 1.3, openMinPence: 25, openMaxPence: 100, pack: { pricePence: 1000, creditPence: 3000 },
  alertsByText: false, checked: 43, tailored: false, belowTopLevel: true, fullPence: 400, pmiPence: 200,
  welcome: { fullPence: 250, until: '8 October' }, firstDeepPence: 500, freeMember: true, freeDelayHours: 48,
  call: { perMinPence: 65, textPence: 22, emailPence: 20 }, topupPresetsPence: [1000, 2500, 5000], autoTopupOn: false, noMatch: null,
};

/** The seed's chip entries as if approved, rendered for this member against the schema seeds. */
function rendered(f: AnswerFacts, settings: Record<string, unknown> = {}): RenderedAnswer[] {
  const g = schemaSnapshot({ settings });
  const out: RenderedAnswer[] = [];
  for (const e of SEED.filter((x) => x.channels.includes('view'))) {
    const r = renderEntry(e, g, memberValuesFrom(f));
    if (r.kind === 'ok') out.push({ slug: e.slug, question: r.question, answer: r.answer });
  }
  return out;
}
const byKey = (f: AnswerFacts, settings?: Record<string, unknown>) => new Map(chipsFor(rendered(f, settings), f).map((a) => [a.key, a]));

test('at most 8, only those that apply', () => {
  assert.ok(chipsFor(rendered(facts), facts).length <= 8);
  assert.equal(byKey({ ...facts, pack: null }).has('pack'), false);
  assert.equal(byKey({ ...facts, freeMember: false }).has('free_delay'), false);
  assert.equal(byKey({ ...facts, checked: null }).has('how_picked'), false, 'no stored count: no "0 live deals"');
});

test('figures come from settings: change a setting, the answer changes', () => {
  assert.match(byKey(facts).get('analysis')!.answer, /A full analysis is £4 \(£2\.50 on your matches until 8 October\).*£6 \(£5 your first time\)/);
  assert.match(byKey(facts, { full_analysis_pence: 600 }).get('analysis')!.answer, /A full analysis is £6/);
  assert.match(byKey({ ...facts, pack: null }).get('topup')!.answer, /Top up £10, £25 or £50/);
  assert.match(byKey(facts).get('save')!.answer, /by email if/);
  assert.match(byKey({ ...facts, alertsByText: true }).get('save')!.answer, /by email and text if/);
});

test('only chip slugs become chips, in order; a low match goes first', () => {
  const extra: RenderedAnswer[] = [...rendered(facts), { slug: 'what_it_costs', question: 'Q', answer: 'A' }];
  assert.ok(!chipsFor(extra, facts).some((a) => (a.key as string) === 'what_it_costs'));
  const a = chipsFor(rendered({ ...facts, noMatch: 'Nothing near your criteria yet.' }), { ...facts, noMatch: 'Nothing near your criteria yet.' });
  assert.equal(a[0].key, 'no_match');
  assert.equal(a[0].answer, 'Nothing near your criteria yet.');
});

test('buttons stay in code', () => {
  const m = byKey(facts);
  assert.deepEqual(m.get('credits')!.action, { label: 'Top up', href: '/account/billing' });
  // With the pack and the free delay showing, topup is the ninth chip and is cut (MAX_CHIPS): test it without them.
  assert.equal(byKey({ ...facts, pack: null, freeMember: false, autoTopupOn: true }).get('topup')!.action, null);
});

test('no answer text lives in code: the chips have one source, the knowledge base', () => {
  const src = readFileSync(new URL('./answers.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /£\s?\d|\d+p\b/);
  assert.doesNotMatch(src, /question:\s*['"`]/);
  assert.doesNotMatch(src, /answer:\s*['"`]/);
});
