import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Batch 22f: which runs are charged, read off the two doors themselves (they
 * stream and talk to the database, so their order is checked here):
 *   - a repeat submission that reuses a report returns before anything is charged;
 *   - a failed run and a run without short-let figures return before the charge;
 *   - the charge is made whatever the lead's verdict (unqualified and held count);
 *   - the tier charge never carries the run's action id, so the refund a
 *     failure after the run makes cannot take it back.
 */
const live = readFileSync(new URL('../../app/api/f/[token]/analyse/route.ts', import.meta.url), 'utf8');
const drain = readFileSync(new URL('../../app/api/internal/funnel-queue/route.ts', import.meta.url), 'utf8');
const charge = readFileSync(new URL('./charge-server.ts', import.meta.url), 'utf8');

test('a reused report is returned before the run, and so before any charge', () => {
  const reused = live.indexOf('if (captured.reused)');
  assert.ok(reused > 0);
  assert.ok(reused < live.indexOf('finishFunnelLead('), 'reuse must come first');
  assert.match(live.slice(reused, live.indexOf('const quote')), /return sseOnce\(\{ stage: 'complete'/);
});

test('an incomplete or failed run returns before the charge', () => {
  for (const src of [live, drain]) {
    const incomplete = src.indexOf('if (!analysisComplete(result))');
    const charged = src.indexOf('finishFunnelLead(');
    assert.ok(incomplete > 0 && incomplete < charged, 'no short-let figures: never charged');
    const catchAt = src.indexOf('} catch (err) {', charged);
    assert.ok(catchAt > charged, 'the charge is inside the try, after the run');
    assert.equal(src.slice(catchAt).includes('finishFunnelLead('), false, 'nothing is charged on failure');
  }
});

test('unqualified and held leads are charged: the charge does not depend on the verdict', () => {
  for (const src of [live, drain]) {
    const call = src.slice(src.indexOf('finishFunnelLead('), src.indexOf('});', src.indexOf('finishFunnelLead(')));
    assert.doesNotMatch(call, /qualified|verdict|policy/);
  }
});

test("the tier charge is not under the run's action id", () => {
  const meta = charge.slice(charge.indexOf('meta: {'), charge.indexOf('},', charge.indexOf('meta: {')));
  assert.doesNotMatch(meta, /\{ action_id:|^\s*action_id:/m);
  assert.match(meta, /run_action_id/);
});
