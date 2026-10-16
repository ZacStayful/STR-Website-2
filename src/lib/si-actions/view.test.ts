import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardView, doneLines, notDoneLines, progressRows, type InstructionLike, type StepLike } from './view.ts';

const now = new Date('2026-10-16T12:00:00Z');
const at = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

const step = (o: Partial<StepLike>): StepLike => ({
  id: 's1',
  seq: 0,
  action: 'pass',
  deal_id: 'd1',
  target_label: '2 bed flat in LS6',
  params: {},
  part: 'now',
  quote_face_pence: 0,
  after: null,
  ledger_ref: null,
  status: 'done',
  drop_reason: null,
  error_code: null,
  report_ref: null,
  finished_at: at(1),
  undone_at: null,
  undo_note: null,
  ...o,
});

const instruction = (o: Partial<InstructionLike>): InstructionLike => ({
  id: 'i1',
  status: 'done',
  confirm_kind: null,
  confirm_answer: null,
  quoted_face_pence: 0,
  later_face_pence: 0,
  balance_before_pence: 4000,
  spend_line: null,
  starts_after: null,
  charged_started_at: null,
  stopped_at: null,
  report_ref: null,
  report_kind: null,
  updated_at: at(0),
  ...o,
});

test('free steps read as one line each, grouped', () => {
  const lines = doneLines([
    step({ id: 'a', action: 'pass' }),
    step({ id: 'b', action: 'pass' }),
    step({ id: 'c', action: 'stage_move', params: { stage: 'viewing' } }),
    step({ id: 'd', action: 'change_criteria', target_label: 'Bedrooms: 2 bed', after: { label: 'Bedrooms: 2 bed', countBefore: 212, countAfter: 64 } }),
    step({ id: 'e', action: 'pass', undone_at: at(0.5) }),
  ]);
  assert.deepEqual(lines, ['Passed 2 deals', 'Moved the 2 bed flat in LS6 to Viewing', 'Bedrooms: 2 bed — matches 212 → 64']);
});

test('what wasn’t done says why', () => {
  const lines = notDoneLines([step({ status: 'dropped', drop_reason: 'needs_open' }), step({ status: 'failed', error_code: 'gone' })]);
  assert.equal(lines[0], '2 bed flat in LS6: That deal needs opening first, to see the address.');
  assert.match(lines[1], /no longer live/);
});

test('charged steps become progress rows, with the report link once done', () => {
  const rows = progressRows([
    step({ id: 'x', action: 'full_analysis', status: 'done', quote_face_pence: 400, after: { reportId: 'r1' } }),
    step({ id: 'y', action: 'full_analysis', status: 'handed_out', quote_face_pence: 400 }),
    step({ id: 'z', action: 'full_analysis', status: 'failed', error_code: 'incomplete', quote_face_pence: 400 }),
    step({ id: 'w', action: 'pass' }),
  ]);
  assert.deepEqual(rows.map((r) => [r.state, r.href, r.price]), [
    ['done', '/reports/r1', '£4'],
    ['running', null, '£4'],
    ['failed', null, '£4'],
  ]);
  assert.match(String(rows[2].note), /wasn’t charged/);
});

test('counting down: Stop; running with steps left: Stop the rest; else none', () => {
  const queued = [step({ action: 'full_analysis', status: 'queued' })];
  assert.equal(cardView(instruction({ status: 'ready', starts_after: at(-0.001) }), queued, { now, undoHours: 24 }).stop, 'stop');
  assert.equal(cardView(instruction({ status: 'running', charged_started_at: at(0) }), queued, { now, undoHours: 24 }).stop, 'stop_rest');
  assert.equal(cardView(instruction({ status: 'running', charged_started_at: at(0) }), [step({ action: 'full_analysis', status: 'handed_out' })], { now, undoHours: 24 }).stop, null);
});

test('the low-credit confirm says what it would leave, with the top-up button unless auto top-up is on', () => {
  const v = cardView(instruction({ status: 'awaiting_confirm', confirm_kind: 'low_balance', quoted_face_pence: 1200, balance_before_pence: 1500 }), [step({ action: 'full_analysis', status: 'queued', quote_face_pence: 1200 })], { now, undoHours: 24 });
  assert.equal(v.confirm?.balanceAfter, '£3');
  assert.equal(v.confirm?.topUp, true);
  assert.match(String(v.confirm?.text), /leave £3/);
  assert.equal(cardView(instruction({ status: 'awaiting_confirm', confirm_kind: 'low_balance', quoted_face_pence: 1200 }), [], { now, undoHours: 24, autoTopupOn: true }).confirm?.topUp, false);
});

test('the rest past the cap asks for the other ones', () => {
  const steps = [step({ id: 'a', action: 'full_analysis', status: 'done', quote_face_pence: 400 }), step({ id: 'b', action: 'full_analysis', status: 'deferred', quote_face_pence: 400 }), step({ id: 'c', action: 'full_analysis', status: 'deferred', quote_face_pence: 400 })];
  const v = cardView(instruction({ status: 'awaiting_confirm', confirm_kind: 'over_cap', later_face_pence: 800 }), steps, { now, undoHours: 24 });
  assert.equal(v.confirm?.text, 'Run the other 2 for £8?');
});

test('once a yes has queued the rest, the cap question is answered, even read before the instruction moves on', () => {
  // Preview test (16 Oct): a refresh landing between the yes queuing the steps and the instruction leaving
  // awaiting_confirm showed the low-credit question ("That would leave …") for a moment.
  const steps = [step({ id: 'a', action: 'full_analysis', status: 'done', quote_face_pence: 400 }), step({ id: 'b', action: 'full_analysis', status: 'queued', quote_face_pence: 400 })];
  const v = cardView(instruction({ status: 'awaiting_confirm', confirm_kind: 'over_cap', confirm_answer: 'yes', later_face_pence: 400, quoted_face_pence: 400, balance_before_pence: 4600 }), steps, { now, undoHours: 24 });
  assert.equal(v.confirm, null);
});

test('Undo shows inside the window for undoable steps, never for a charge', () => {
  assert.ok(cardView(instruction({}), [step({ action: 'pass' })], { now, undoHours: 24 }).undo);
  assert.equal(cardView(instruction({}), [step({ action: 'pass', finished_at: at(30) })], { now, undoHours: 24 }).undo, null);
  assert.equal(cardView(instruction({}), [step({ action: 'full_analysis', after: { reportId: 'r' } })], { now, undoHours: 24 }).undo, null);
});

test('a checked listing shows its card, Keep until kept, then Undo', () => {
  const link = step({ action: 'check_link', target_label: 'rightmove', after: { title: '2 bed flat for sale', lines: ['Rightmove · 2 bed flat · LS6'], keepable: true } });
  const v = cardView(instruction({}), [link], { now, undoHours: 24 });
  assert.equal(v.link?.canKeep, true);
  assert.equal(v.undo, null);
  const kept = cardView(instruction({}), [{ ...link, after: { ...link.after, checkedListingId: 'l1', keptAt: at(0.1), keepable: false } }], { now, undoHours: 24 });
  assert.equal(kept.link?.kept, true);
  assert.ok(kept.undo);
});

test('blocked: says nothing charged ran', () => {
  const v = cardView(instruction({ status: 'blocked', quoted_face_pence: 1200 }), [], { now, undoHours: 24, spendableBasePence: 800 });
  assert.deepEqual(v.blocked && [v.blocked.requiredPence, v.blocked.availablePence], [1200, 800]);
  assert.match(String(v.blocked?.text), /nothing that costs anything ran/);
});

test('a report the eye filed shows its ref', () => {
  assert.deepEqual(cardView(instruction({ report_kind: 'bug', report_ref: 42 }), [], { now, undoHours: 24 }).report, { kind: 'bug', ref: 42 });
});
