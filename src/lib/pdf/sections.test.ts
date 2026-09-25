import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sectionsFor, navFor, stamp, stampShort, eyebrow, contentsFor, pad2,
} from './sections.ts';

test('the reference layout: setup present, no deal, is six sections', () => {
  const secs = sectionsFor({ setup: true, deal: false });
  assert.equal(secs.length, 6);
  assert.equal(stamp(navFor(secs, 'plan')), '06 / 06 — THE PLAN');
  assert.equal(stamp(navFor(secs, 'setup')), '05 / 06 — SETUP COSTS');
});

test('every combination numbers itself consistently', () => {
  const cases: Array<[boolean, boolean, boolean, number]> = [
    [false, false, false, 5],
    [true, false, false, 6],
    [false, true, false, 6],
    [true, true, false, 7],
    [false, false, true, 6],
    [true, false, true, 7],
    [false, true, true, 7],
    [true, true, true, 8],
  ];
  for (const [setup, deal, diligence, total] of cases) {
    const secs = sectionsFor({ setup, deal, diligence });
    assert.equal(secs.length, total, `setup=${setup} deal=${deal} diligence=${diligence}`);
    // The plan closes the document in every combination.
    assert.equal(secs[secs.length - 1].id, 'plan');
    const nav = navFor(secs, 'plan');
    assert.equal(nav.index, total);
    assert.equal(nav.total, total);
    // Numbering is dense: no gaps, no duplicates.
    const indices = secs.map((s) => navFor(secs, s.id).index);
    assert.deepEqual(indices, secs.map((_, i) => i + 1));
  }
});

test('the deal is an appendix to the economics, never the last word', () => {
  const secs = sectionsFor({ setup: true, deal: true });
  const ids = secs.map((s) => s.id);
  assert.ok(ids.indexOf('deal') > ids.indexOf('setup'));
  assert.ok(ids.indexOf('deal') < ids.indexOf('plan'));
});

test('due diligence follows the deal it informs and stays ahead of the plan', () => {
  const secs = sectionsFor({ setup: true, deal: true, diligence: true });
  const ids = secs.map((s) => s.id);
  assert.ok(ids.indexOf('diligence') > ids.indexOf('deal'));
  assert.ok(ids.indexOf('diligence') < ids.indexOf('plan'));
  assert.equal(stamp(navFor(secs, 'diligence')), '07 / 08 — DUE DILIGENCE');
  // A report saved before the registers were read has no such section.
  assert.equal(sectionsFor({ setup: true, deal: false }).some((s) => s.id === 'diligence'), false);
});

test('stamps are zero-padded so the header does not jitter', () => {
  assert.equal(pad2(1), '01');
  assert.equal(pad2(10), '10');
  const secs = sectionsFor({ setup: false, deal: false });
  assert.equal(stampShort(navFor(secs, 'verdict')), '01 / 05');
  assert.equal(eyebrow(navFor(secs, 'market')), '03 — THE MARKET');
});

test('page one lists the sections that follow it', () => {
  const secs = sectionsFor({ setup: true, deal: false });
  const contents = contentsFor(secs);
  assert.equal(contents.length, 5);
  assert.ok(!contents.some((s) => s.id === 'verdict'));
  assert.deepEqual(contents.map((s) => s.id), ['numbers', 'market', 'location', 'setup', 'plan']);
});

test('asking for an absent section degrades rather than throwing', () => {
  const secs = sectionsFor({ setup: false, deal: false });
  const nav = navFor(secs, 'setup');
  assert.equal(nav.index, 0);
  assert.equal(nav.label, '');
});
