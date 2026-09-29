import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeNeedsWork, needsWorkFrom, parseNeedsWork } from './needs-work.ts';
import { exclusionFor } from './exclusions.ts';

test('needs-work wording flags a listing, stored as our own phrase keys only', () => {
  const n = needsWorkFrom('3 bed end terrace | Vacant | In need of modernisation | Cash buyers only');
  assert.equal(n.flag, true);
  assert.deepEqual(n.phrases, ['cash_buyers_only', 'in_need_of_works']);
  assert.equal(n.score, 6);
  assert.doesNotMatch(JSON.stringify(n), /modernisation|Vacant/, 'never the listing’s words');
});

test('the decided phrases, strongest first', () => {
  assert.equal(needsWorkFrom('A renovation project').flag, true);
  assert.equal(needsWorkFrom('Classic doer-upper').phrases[0], 'doer_upper');
  assert.equal(needsWorkFrom('Requires full refurbishment throughout').flag, true);
  assert.equal(needsWorkFrom('Unmodernised semi').flag, true);
  assert.equal(needsWorkFrom('Needs some TLC').flag, true);
  assert.equal(needsWorkFrom('Would benefit from updating').flag, true);
  assert.equal(needsWorkFrom('Dated kitchen and bathroom').flag, true);
  assert.equal(needsWorkFrom('In need of cosmetic updating').flag, true);
  assert.equal(needsWorkFrom('Scope for improvements and modernisation').flag, true);
});

test('weight 1 alone ranks but never flags', () => {
  const n = needsWorkFrom('Ideal for investors | Make it your own');
  assert.equal(n.flag, false);
  assert.equal(n.score, 2);
});

test('work already done, or said not to be needed, never counts', () => {
  assert.equal(needsWorkFrom('Recently modernised throughout').flag, false);
  assert.equal(needsWorkFrom('No work required. Move straight in').flag, false);
  assert.equal(needsWorkFrom('Does not need any modernisation').flag, false);
  assert.equal(needsWorkFrom('Beautifully renovated two-bedroom terraced house | Modern fitted kitchen').flag, false);
  assert.equal(needsWorkFrom('Fully refurbished, would benefit from updating in places').flag, false, 'a weak phrase in a done-already sentence');
  assert.equal(needsWorkFrom('Fully modernised flat. The house next door is in need of renovation').flag, true, 'a different sentence');
  assert.equal(needsWorkFrom(null, undefined, '').flag, false);
});

test('the feed reading and the page reading combine', () => {
  const card = needsWorkFrom('Ideal for investors');
  const page = needsWorkFrom('The property is in need of refurbishment');
  const both = mergeNeedsWork(card, page);
  assert.equal(both.flag, true);
  assert.deepEqual(both.phrases, ['in_need_of_works', 'ideal_for_investors']);
  assert.equal(both.score, 4);
  assert.deepEqual(parseNeedsWork(JSON.stringify(both)), both);
  assert.equal(parseNeedsWork({ phrases: ['in_need_of_works'] }), null, 'no flag, nothing usable');
  assert.deepEqual(parseNeedsWork({ flag: true, score: 3, phrases: ['in_need_of_works', 'someone’s words'] })?.phrases, ['in_need_of_works']);
});

test('excluded before anything is spent: non-standard construction, short leases, listed, conservation, structural', () => {
  assert.equal(exclusionFor({ texts: ['BISF semi in need of modernisation'] }), 'non_standard');
  assert.equal(exclusionFor({ texts: ['Airey house, cash buyers only'] }), 'non_standard');
  assert.equal(exclusionFor({ texts: ['A Cornish unit bungalow'] }), 'non_standard');
  assert.equal(exclusionFor({ texts: ['Non-standard construction'] }), 'non_standard');
  assert.equal(exclusionFor({ texts: ['2 bed flat'], tenure: 'leasehold', yearsRemainingOnLease: 72 }), 'short_lease');
  assert.equal(exclusionFor({ texts: ['2 bed flat'], tenure: 'leasehold', yearsRemainingOnLease: 976 }), null);
  assert.equal(exclusionFor({ texts: ['Grade II listed cottage'] }), 'listed');
  assert.equal(exclusionFor({ texts: ['3 bed house'], listedFlag: true }), 'listed');
  assert.equal(exclusionFor({ texts: ['Set within a conservation area'] }), 'conservation');
  assert.equal(exclusionFor({ texts: ['Some historic subsidence'] }), 'structural');
  assert.equal(exclusionFor({ texts: ['Japanese knotweed present in the garden'] }), 'structural');
});

test('names and words that only look like exclusions are not', () => {
  assert.equal(exclusionFor({ texts: ['Flat 3, Unity House, High Street'] }), null);
  assert.equal(exclusionFor({ texts: ['Minutes from the Cornish coast'] }), null);
  assert.equal(exclusionFor({ texts: ['Built by Wates Construction in 2019'] }), null);
  assert.equal(exclusionFor({ texts: ['Steel framed windows and a prefabricated garage'] }), null);
  assert.equal(exclusionFor({ texts: ['Not in a conservation area', 'No structural issues'] }), null);
  assert.equal(exclusionFor({ texts: ['Cash buyers only'] }), null, 'cash buyers only is a needs signal, never an exclusion');
});
