import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HIDDEN_LINES, PHOTO_CHECK_SYSTEM, REASON_MAX, cleanReason, photoCheckPrompt, photoCheckSchema, validatePhotoAnswer } from './photo-check-schema.ts';
import { LINE_KEYS } from './costing.ts';
import { estimateFromFindings } from './estimate.ts';

/** A full, valid answer: every line, with overrides. */
function answer(over: Record<string, unknown> = {}, lineOver: Record<string, unknown> = {}) {
  const lines: Record<string, unknown> = {};
  for (const k of LINE_KEYS) lines[k] = { status: 'not_needed', reason: 'Looks sound in the photos', photos: [1] };
  return { condition: 'light', kitchenSize: 'small', lines: { ...lines, ...lineOver }, counts: { rooms: null, radiators: 6, windows: null, outsideDoors: 2, internalDoors: null, bathrooms: 1 }, ...over };
}

test('the schema asks for every line, the condition, the kitchen and the counts, and nothing else', () => {
  const s = photoCheckSchema() as { required: string[]; additionalProperties: boolean; properties: { lines: { required: string[] } } };
  assert.deepEqual(s.required, ['condition', 'kitchenSize', 'lines', 'counts']);
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.properties.lines.required, [...LINE_KEYS]);
  assert.ok(!JSON.stringify(s).includes('maxLength'), 'supported keywords only: the 120 characters are the validator’s');
});

test('the prompt never carries the description, the address or the price', () => {
  const text = photoCheckPrompt({ bedrooms: 3, bathrooms: 1, propertyType: 'End of Terrace', photos: 10, floorplans: 1 });
  assert.match(text, /3 bedrooms, 1 bathrooms/);
  assert.match(text, /Images 1–10 are photos; the last image is the floorplan/);
  for (const k of LINE_KEYS) assert.ok(text.includes(`- ${k}:`), k);
  assert.ok(!/£|price|address|postcode/i.test(text));
  assert.match(PHOTO_CHECK_SYSTEM, /always answer cant_tell/);
});

test('a valid answer becomes findings; hidden lines are always can’t tell; reasons and photo numbers made safe', () => {
  const long = 'x'.repeat(300);
  const v = validatePhotoAnswer(answer({}, { kitchen: { status: 'needed', reason: long, photos: [3, 3, 99, 0, 2] }, rewire: { status: 'needed', reason: 'Old fuse box', photos: [4] } }), 10);
  assert.ok(v.ok);
  if (!v.ok) return;
  assert.equal(v.findings.lines.kitchen!.status, 'needed');
  assert.equal(v.findings.lines.kitchen!.reason.length, REASON_MAX);
  assert.deepEqual(v.findings.lines.kitchen!.photos, [2, 3], 'duplicates and numbers outside the ten images dropped');
  for (const k of HIDDEN_LINES) assert.equal(v.findings.lines[k]!.status, 'cant_tell', k);
  assert.equal(v.findings.kitchenSize, 'small');
  assert.equal(v.findings.counts.radiators, 6);
  assert.equal(validatePhotoAnswer(answer({ kitchenSize: 'unknown' }), 10).ok && (validatePhotoAnswer(answer({ kitchenSize: 'unknown' }), 10) as { findings: { kitchenSize: unknown } }).findings.kitchenSize, null);
});

test('an answer that is not the whole shape fails: skipped for the day, never guessed', () => {
  assert.deepEqual(validatePhotoAnswer('not json', 5), { ok: false, error: 'not_json' });
  assert.equal(validatePhotoAnswer(answer({ condition: 'wrecked' }), 5).ok, false);
  assert.equal(validatePhotoAnswer(answer({ kitchenSize: 'huge' }), 5).ok, false);
  const missing = answer();
  delete (missing.lines as Record<string, unknown>).damp;
  assert.deepEqual(validatePhotoAnswer(missing, 5), { ok: false, error: 'missing_line:damp' });
  assert.equal(validatePhotoAnswer(answer({}, { paint: { status: 'maybe', reason: '', photos: [] } }), 5).ok, false);
  const countsJunk = validatePhotoAnswer(answer({ counts: { rooms: -2, radiators: 400, windows: 3.5 } }), 5);
  assert.ok(countsJunk.ok);
  if (countsJunk.ok) assert.deepEqual(countsJunk.findings.counts, { rooms: null, radiators: null, windows: null, outsideDoors: null, internalDoors: null, bathrooms: null });
  assert.equal(cleanReason('  two\n lines  '), 'two lines');
});

test('validated findings cost through the engine as they are', () => {
  const v = validatePhotoAnswer(answer({ condition: 'full' }, { kitchen: { status: 'needed', reason: 'Dated units', photos: [2] }, paint: { status: 'needed', reason: 'Tired walls', photos: [1, 4] } }), 8);
  assert.ok(v.ok);
  if (!v.ok) return;
  const e = estimateFromFindings({ price: 70_000, facts: { bedrooms: 3, bathrooms: 1, propertyKind: 'house', floorAreaSqft: null }, country: 'england', ceiling: null, findings: v.findings });
  assert.equal(e.kind, 'project');
  if (e.kind === 'project') assert.ok(e.estimate.works.low > 0 && e.estimate.works.high >= e.estimate.works.low);
});

test('a stored answer validates again as it was (reused within 60 days, or re-costed at a new price), a kitchen never seen included', () => {
  const first = validatePhotoAnswer(answer({ kitchenSize: 'unknown', condition: 'full' }, { paint: { status: 'needed', reason: 'Tired walls', photos: [1, 4] } }), 6);
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.findings.kitchenSize, null);
  // As project_checks.findings stores it: JSON, with the kitchen as null.
  const again = validatePhotoAnswer(JSON.parse(JSON.stringify(first.findings)), 6);
  assert.ok(again.ok, again.ok ? '' : again.error);
  if (again.ok) assert.deepEqual(again.findings, first.findings);
});
