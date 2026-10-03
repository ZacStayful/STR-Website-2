import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, matchIndex, matchKnowledge, stem, tokens, type Matchable } from './match.ts';
import { DEFAULT_KNOWLEDGE_SETTINGS } from './settings.ts';
import { SEED } from './seed.ts';

/** The seed as if every entry were approved. */
const KB: Matchable[] = SEED.map((e, i) => ({ id: `id-${i}`, slug: e.slug, version: 1, question: e.question, variants: e.variants, channels: e.channels }));
const opts = { answerMin: DEFAULT_KNOWLEDGE_SETTINGS.answerMinConfidence, lowMin: DEFAULT_KNOWLEDGE_SETTINGS.lowConfidenceMin };

/**
 * Hand-written paraphrases (the conversation log was empty when the
 * thresholds were set). `null` = nothing in the knowledge base answers it.
 * The chat channel sees every entry except the call-only ones.
 */
const PARAPHRASES: [string, string | null][] = [
  ['how much does it cost to open a deal', 'open_cost'],
  ['whats the price to unlock a property', 'open_cost'],
  ['how do my credits work', 'credits'],
  ['how much credit have i got left', 'credits'],
  ['what happens if i save a deal', 'save'],
  ['do you tell me when the price drops', 'save'],
  ['how do you choose my deals', 'how_picked'],
  ['whats included in a full analysis', 'analysis'],
  ['what does pmi add to the report', 'analysis'],
  ['why do i see new deals later than others', 'free_delay'],
  ['how do I top up', 'topup'],
  ['how do i add more credit', 'topup'],
  ['how does auto top up work', 'auto_topup'],
  ['what does stayful intelligence do', 'what_it_does'],
  ['can i speak to a real person', 'talk_to_team'],
  ['i want a refund', 'talk_to_team'],
  ['how do i stop the texts', 'stop_calls'],
  ['how much is stayful', 'what_it_costs'],
  ['is the service free', 'what_it_costs'],
  ['where does your data come from', 'data_sources'],
  ['are the income figures realistic', 'bold_claims'],
  ['how are you different from airdna', 'vs_competitors'],
  ['do i need to be good with computers', 'technical'],
  ['can i analyse a house before i buy it', 'prospective'],
  ['how accurate are your forecasts', 'forecast_accuracy'],
  ['is stayful management the same thing', 'management'],
  ['can stayful manage my flat for me', 'management'],
  ['what sections does the analyser report have', 'analyser_output'],
  ['why cant you find me any deals', 'no_match'],
  ['what do i get with the starter pack', 'pack'],
  // Not in the knowledge base.
  ['can i bring my dog to the viewing', null],
  ['what is the weather in leeds tomorrow', null],
  ['do you do commercial mortgages', null],
  ['how do i change my email address', null],
  ['can you send me the floor plan', null],
];

test('stemming and normalising', () => {
  assert.equal(stem('analyses'), 'analysis');
  assert.equal(stem('properties'), 'property');
  assert.deepEqual(tokens('How much is a top up?'), ['price', 'topup']);
  assert.deepEqual(tokens('P M I second opinion'), ['pmi', 'second', 'opinion']);
  assert.deepEqual(tokens('What does the {pack_cost} pack give?'), ['pack', 'give']);
});

test('paraphrases reach the right entry (and unknown questions are not answered)', () => {
  // A tie at the top counts as right: the outcome is then low confidence, never answered.
  const index = buildIndex(KB, 'chat');
  const wrong: string[] = [];
  for (const [q, want] of PARAPHRASES) {
    const r = matchIndex(index, q, opts);
    if (want === null) {
      if (r.outcome === 'answered') wrong.push(`"${q}" answered as ${r.matches[0]?.slug} (${r.matches[0]?.confidence})`);
    } else if (r.matches[0]?.slug !== want && !(r.matches.find((m) => m.slug === want)?.confidence === r.matches[0]?.confidence)) {
      wrong.push(`"${q}" → ${r.matches[0]?.slug ?? 'nothing'} (${r.matches[0]?.confidence ?? 0}), wanted ${want}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('most known paraphrases are confident; no unknown one is', () => {
  const index = buildIndex(KB, 'chat');
  const known = PARAPHRASES.filter(([, w]) => w !== null).map(([q]) => matchIndex(index, q, opts).outcome);
  const answered = known.filter((o) => o === 'answered').length;
  assert.ok(answered / known.length >= 0.6, `only ${answered} of ${known.length} answered`);
  for (const [q] of PARAPHRASES.filter(([, w]) => w === null)) assert.notEqual(matchIndex(index, q, opts).outcome, 'answered', q);
});

test('the channel filter, an empty question and an empty knowledge base', () => {
  const r = matchKnowledge(KB, 'why are you calling me what does it cost', { ...opts, channel: 'chat' });
  assert.ok(!r.matches.some((m) => m.slug === 'calls_how'), 'calls_how is call-only');
  assert.deepEqual(matchKnowledge(KB, '   the a of  ', opts), { outcome: 'could_not_answer', matches: [] });
  assert.deepEqual(matchKnowledge([], 'how much', opts), { outcome: 'could_not_answer', matches: [] });
});

test('two near-equal entries are low confidence, not answered', () => {
  const twins: Matchable[] = [
    { id: 'a', slug: 'plan_credit', version: 1, question: 'Does plan credit expire?', variants: [], channels: ['chat'] },
    { id: 'b', slug: 'topup_credit', version: 1, question: 'Does top-up credit expire?', variants: [], channels: ['chat'] },
  ];
  assert.notEqual(matchKnowledge(twins, 'does credit expire', opts).outcome, 'answered');
});
