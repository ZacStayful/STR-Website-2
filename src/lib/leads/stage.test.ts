import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEAD_STAGES, STAGE_LABELS, parseStage, stageLabel } from './stage.ts';

test('every stage has a label', () => {
  for (const s of LEAD_STAGES) assert.ok(STAGE_LABELS[s]);
});

test('parseStage accepts the list and nothing else', () => {
  assert.equal(parseStage('signed'), 'signed');
  assert.equal(parseStage('Signed'), null);
  assert.equal(parseStage('pushed'), null, 'a delivery status is not a stage');
  assert.equal(parseStage(''), null);
  assert.equal(parseStage(undefined), null);
  assert.equal(parseStage(3), null);
});

test('stageLabel falls back to New rather than printing a raw value', () => {
  assert.equal(stageLabel('meeting_booked'), 'Meeting booked');
  assert.equal(stageLabel(null), 'New');
  assert.equal(stageLabel('<script>'), 'New');
});

test('the database constraint allows exactly the same stages', () => {
  // A stage the app offers but the check constraint refuses would fail every
  // save of it; one the constraint allows but the app does not know would
  // render as "New". Either drift is caught here.
  const sql = readFileSync(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8');
  const m = sql.match(/leads_stage_check\s+check \(stage in \(([^)]*)\)\)/);
  assert.ok(m, 'leads_stage_check not found in schema.sql');
  const inDb = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  assert.deepEqual(inDb, [...LEAD_STAGES]);
});
