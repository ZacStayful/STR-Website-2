import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_CHECK_MODEL, hopsOf, photoCheckCostPence, photoCheckWorstPence, unitsFor } from './photo-check-usage.ts';

test('the check runs on Opus 5.5 and is metered at its own rows, not Opus 4.8’s', () => {
  assert.equal(PHOTO_CHECK_MODEL, 'claude-opus-5-5');
  assert.deepEqual(unitsFor('claude-opus-5-5'), { input: 'opus55_input_token', output: 'opus55_output_token' });
  assert.deepEqual(unitsFor('claude-sonnet-5-5'), { input: 'sonnet55_input_token', output: 'sonnet55_output_token' });
  assert.deepEqual(unitsFor('claude-opus-4-8'), { input: 'input_token', output: 'output_token' }, 'any other model at the dearest known rows');
});

test('about 10p a listing: 20k input and 3k output on Opus 5.5', () => {
  const pence = photoCheckCostPence([{ model: 'claude-opus-5-5', inputTokens: 20_000, outputTokens: 3_000 }]);
  // $4/MTok × 20k = $0.08; $20/MTok × 3k = $0.06; $0.14 at 79p = 11.06p.
  assert.equal(pence, 11.06);
});

test('a refusal re-run on the fallback: each hop at the model that ran it', () => {
  const hops = hopsOf({ input_tokens: 21_000, output_tokens: 2_000, iterations: [{ type: 'message', input_tokens: 20_000, output_tokens: 0 }, { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 20_000, output_tokens: 2_000 }] }, 'claude-opus-5-5', 'claude-opus-4-8');
  assert.deepEqual(hops, [
    { model: 'claude-opus-5-5', inputTokens: 20_000, outputTokens: 0 },
    { model: 'claude-opus-4-8', inputTokens: 20_000, outputTokens: 2_000 },
  ]);
  assert.ok(photoCheckCostPence(hops) > photoCheckCostPence([hops[1]]));
  // No per-hop usage: one hop at the model that answered.
  assert.deepEqual(hopsOf({ input_tokens: 10, output_tokens: 5 }, 'claude-opus-5-5', 'claude-opus-5-5'), [{ model: 'claude-opus-5-5', inputTokens: 10, outputTokens: 5 }]);
});

test('a claim reserves the check’s true worst case: every image at full size, a refusal and a fallback, both replies at max_tokens', () => {
  const eleven = photoCheckWorstPence(11);
  // Opus 5.5: 56,800 input × 0.0316p/1k + 16,000 output × 0.158p/1k ≈ 43.2p; the fallback at the dearest rows ≈ 54p.
  assert.ok(eleven > 90 && eleven < 105, `eleven images: ${eleven}p`);
  assert.ok(photoCheckWorstPence(13) > eleven);
  assert.ok(photoCheckWorstPence(0) > 0, 'the text and the reply alone');
  // A typical check (about 20k tokens in, 3k out) is a tenth of it.
  assert.ok(photoCheckCostPence([{ model: PHOTO_CHECK_MODEL, inputTokens: 20_000, outputTokens: 3_000 }]) < eleven / 5);
});
