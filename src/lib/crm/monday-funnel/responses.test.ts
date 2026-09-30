import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTemporary, readReply, type RawReply } from './responses.ts';

const raw = (over: Partial<RawReply>): RawReply => ({ status: 200, data: null, errors: [], errorCode: null, errorMessage: null, transport: null, ...over });

test('partial results are kept: one alias failing fails that row alone', () => {
  const r = readReply(raw({ data: { c0: { id: '1' }, c1: null, n2: { id: '9' } }, errors: [{ message: 'This status label does not exist', code: 'ColumnValueException', alias: 'c1' }] }));
  assert.deepEqual(r.data, { c0: { id: '1' }, c1: null, n2: { id: '9' } });
  assert.deepEqual([...r.aliasErrors], [['c1', 'This status label does not exist']]);
  assert.equal(r.stop, null);
  assert.equal(r.refused, null);
});

test("Monday's limits and outages stop the run, keeping whatever got through", () => {
  const budget = readReply(raw({ data: { c0: { id: '1' } }, errors: [{ message: 'Complexity budget exhausted', code: 'ComplexityException', alias: 'c1' }] }));
  assert.equal(budget.stop, 'Complexity budget exhausted');
  assert.deepEqual(budget.data, { c0: { id: '1' } });
  assert.equal(readReply(raw({ status: 429, errorMessage: 'Rate limit' })).stop, 'Rate limit');
  assert.ok(readReply(raw({ status: 502 })).stop);
  assert.ok(readReply(raw({ status: 401, errorMessage: 'Not authenticated' })).stop);
  assert.equal(readReply(raw({ transport: 'Could not reach Monday: timeout' })).stop, 'Could not reach Monday: timeout');
  assert.ok(readReply(raw({ errorCode: 'ComplexityException', errorMessage: 'Complexity budget exhausted' })).stop);
  assert.ok(readReply(raw({ errors: [{ message: 'Daily limit exceeded', code: 'DAILY_LIMIT_EXCEEDED', alias: null }] })).stop);
});

test('the older error body is a refusal, not "no data, try again"', () => {
  const r = readReply(raw({ errorCode: 'ColumnValueException', errorMessage: 'invalid value' }));
  assert.equal(r.refused, 'ColumnValueException: invalid value');
  assert.equal(r.stop, null);
});

test('an error on no alias (the query itself) refuses the whole request', () => {
  const r = readReply(raw({ errors: [{ message: 'Variable "$board" is never used', code: null, alias: null }] }));
  assert.equal(r.refused, 'Variable "$board" is never used');
});

test('what counts as temporary', () => {
  for (const [code, message] of [['ComplexityException', null], [null, 'Rate Limit Exceeded'], ['maxConcurrencyExceeded', null], [null, 'Internal Server Error']] as const) assert.equal(isTemporary(code, message), true, `${code} ${message}`);
  for (const [code, message] of [['ColumnValueException', 'bad label'], ['InvalidColumnIdException', null], ['ItemNotFoundInBoard', null]] as const) assert.equal(isTemporary(code, message), false, `${code} ${message}`);
});
