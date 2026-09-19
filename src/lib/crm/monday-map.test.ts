import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMondayConfig, mondayConfigBlockers, formatColumnValue, mondayColumnValues,
  isWritableColumnType, EMPTY_MONDAY_CONFIG, MONDAY_FIELDS,
} from './monday-map.ts';
import type { LeadPayload } from './types.ts';

function payload(over: Partial<LeadPayload> = {}): LeadPayload {
  return {
    version: 1,
    event: 'lead.created',
    leadId: 'b3f1c2d4-0000-0000-0000-000000000000',
    createdAt: '2026-03-04T09:30:00.000Z',
    funnel: { id: 'f1', name: 'Yorkshire lettings' },
    contact: { name: 'Dana Okafor', email: 'dana@example.com', phone: '07700 900123', consentAt: '2026-03-04T09:29:00.000Z' },
    property: { address: '17 Park Crescent, York', postcode: 'YO31 7NU', postcodeArea: 'YO', bedrooms: 3 },
    metrics: { annualRevenue: 42800, occupancy: 0.68, averageNightlyRate: 172, averageReviewCount: 54, saturation: 'uncontested' },
    qualification: { qualified: true, summary: 'Met all 3 rules.', unknownChecks: 0, checks: [] },
    report: { url: 'https://stayful.co.uk/r/tok', pdfUrl: 'https://stayful.co.uk/r/tok/pdf' },
    ...over,
  };
}

// ─── Parsing ────────────────────────────────────────────────────────

test('an unusable stored config becomes "nothing mapped", not a throw', () => {
  for (const bad of [null, undefined, 'nonsense', 42, [], { columns: 'no' }]) {
    const c = parseMondayConfig(bad);
    assert.deepEqual(c.columns, {});
    assert.equal(c.boardId, null);
  }
  assert.deepEqual(parseMondayConfig({}), EMPTY_MONDAY_CONFIG);
});

test('a column missing its type is dropped, because the shape cannot be chosen without it', () => {
  const c = parseMondayConfig({
    boardId: '123',
    columns: {
      email: { id: 'email_1', type: 'email' },
      phone: { id: 'phone_1' },              // no type
      address: { type: 'text' },             // no id
      nonsense: { id: 'x', type: 'text' },   // not a field we know
    },
  });
  assert.deepEqual(c.columns.email, { id: 'email_1', type: 'email' });
  assert.equal(c.columns.phone, undefined);
  assert.equal(c.columns.address, undefined);
  assert.equal(Object.keys(c.columns).length, 1);
});

test('column types are lower-cased so a board reporting "Email" still matches', () => {
  const c = parseMondayConfig({ boardId: '1', columns: { email: { id: 'e', type: 'EMAIL' } } });
  assert.equal(c.columns.email?.type, 'email');
});

test('verdict labels default rather than coming out blank', () => {
  assert.deepEqual(parseMondayConfig({ qualifiedLabels: { yes: '  ' } }).qualifiedLabels, { yes: 'Qualified', no: 'Not qualified' });
  assert.deepEqual(parseMondayConfig({ qualifiedLabels: { yes: 'Hot', no: 'Cold' } }).qualifiedLabels, { yes: 'Hot', no: 'Cold' });
});

test('a connection is not usable until it has a board and an email column', () => {
  assert.equal(mondayConfigBlockers(EMPTY_MONDAY_CONFIG).length, 2);
  const withBoard = parseMondayConfig({ boardId: '123' });
  assert.equal(mondayConfigBlockers(withBoard).length, 1);
  const ready = parseMondayConfig({ boardId: '123', columns: { email: { id: 'e', type: 'email' } } });
  assert.deepEqual(mondayConfigBlockers(ready), []);
});

// ─── Value shapes ───────────────────────────────────────────────────

test('each column type gets the shape Monday wants for it', () => {
  assert.equal(formatColumnValue('text', 'dana@example.com'), 'dana@example.com');
  assert.deepEqual(formatColumnValue('email', 'dana@example.com'), { email: 'dana@example.com', text: 'dana@example.com' });
  assert.deepEqual(formatColumnValue('phone', '07700 900123'), { phone: '07700 900123' });
  assert.deepEqual(formatColumnValue('status', 'Qualified'), { label: 'Qualified' });
  assert.deepEqual(formatColumnValue('link', 'https://x.test/r'), { url: 'https://x.test/r', text: 'https://x.test/r' });
  assert.deepEqual(formatColumnValue('date', '2026-03-04T09:30:00.000Z'), { date: '2026-03-04', time: '09:30:00' });
  assert.equal(formatColumnValue('numbers', 42800), '42800');
  assert.deepEqual(formatColumnValue('checkbox', true), { checked: 'true' });
  assert.deepEqual(formatColumnValue('checkbox', false), { checked: 'false' });
});

test('the same value takes a different shape on a different column type', () => {
  // The whole reason the type is stored: an email in a text column is a bare
  // string, and sending {email,text} there fails the entire mutation.
  assert.equal(typeof formatColumnValue('text', 'dana@example.com'), 'string');
  assert.equal(typeof formatColumnValue('email', 'dana@example.com'), 'object');
});

test('an unknown column type is skipped rather than guessed', () => {
  for (const t of ['mirror', 'formula', 'board_relation', 'subtasks', 'timeline', 'people']) {
    assert.equal(isWritableColumnType(t), false, `${t} should not be writable`);
    assert.equal(formatColumnValue(t, 'anything'), undefined);
  }
});

test('nothing to say sends nothing — never a null that would clear their column', () => {
  assert.equal(formatColumnValue('text', null), undefined);
  assert.equal(formatColumnValue('text', ''), undefined);
  assert.equal(formatColumnValue('text', '   '), undefined);
  assert.equal(formatColumnValue('numbers', 'not a number'), undefined);
  assert.equal(formatColumnValue('date', 'never'), undefined);
});

test('a money string survives the trip into a numbers column', () => {
  assert.equal(formatColumnValue('numbers', '£42,800'), '42800');
});

// ─── Mapping a whole lead ───────────────────────────────────────────

const FULL = parseMondayConfig({
  boardId: '99',
  columns: {
    email: { id: 'c_email', type: 'email' },
    phone: { id: 'c_phone', type: 'phone' },
    address: { id: 'c_addr', type: 'text' },
    postcode: { id: 'c_pc', type: 'text' },
    bedrooms: { id: 'c_beds', type: 'numbers' },
    revenue: { id: 'c_rev', type: 'numbers' },
    qualified: { id: 'c_qual', type: 'status' },
    summary: { id: 'c_sum', type: 'long_text' },
    reportUrl: { id: 'c_link', type: 'link' },
    date: { id: 'c_date', type: 'date' },
  },
});

test('a full mapping fills every column', () => {
  const v = mondayColumnValues(FULL, payload());
  assert.deepEqual(v.c_email, { email: 'dana@example.com', text: 'dana@example.com' });
  assert.deepEqual(v.c_phone, { phone: '07700 900123' });
  assert.equal(v.c_addr, '17 Park Crescent, York');
  assert.equal(v.c_beds, '3');
  assert.equal(v.c_rev, '42800');
  assert.deepEqual(v.c_qual, { label: 'Qualified' });
  assert.deepEqual(v.c_date, { date: '2026-03-04', time: '09:30:00' });
});

test('a partial mapping produces a partial row rather than a failed push', () => {
  const partial = parseMondayConfig({ boardId: '99', columns: { email: { id: 'c_email', type: 'email' } } });
  const v = mondayColumnValues(partial, payload());
  assert.deepEqual(Object.keys(v), ['c_email']);
});

test('a mapped column whose type we cannot write is left out, not guessed at', () => {
  const odd = parseMondayConfig({
    boardId: '99',
    columns: { email: { id: 'c_email', type: 'email' }, phone: { id: 'c_people', type: 'people' } },
  });
  const v = mondayColumnValues(odd, payload());
  assert.equal(v.c_people, undefined);
  assert.ok(v.c_email, 'the writable column still goes');
});

test('a queued lead leaves the Qualified column alone instead of saying "Not qualified"', () => {
  // A report that has not run is not a lead that failed. Writing the "no"
  // label here would be a lie the customer acts on.
  const v = mondayColumnValues(FULL, payload({
    qualification: { qualified: null, summary: '', unknownChecks: 0, checks: [] },
  }));
  assert.equal(v.c_qual, undefined);
  assert.equal(v.c_sum, undefined);
  assert.ok(v.c_email, 'the contact details still arrive');
});

test('a failed lead gets the customer’s own "no" label', () => {
  const custom = parseMondayConfig({
    boardId: '99',
    columns: { qualified: { id: 'c_qual', type: 'status' } },
    qualifiedLabels: { yes: 'Hot', no: 'Cold' },
  });
  const v = mondayColumnValues(custom, payload({
    qualification: { qualified: false, summary: 'Too few bedrooms.', unknownChecks: 0, checks: [] },
  }));
  assert.deepEqual(v.c_qual, { label: 'Cold' });
});

test('a checkbox Qualified column gets a boolean, not the label text', () => {
  const cb = parseMondayConfig({ boardId: '99', columns: { qualified: { id: 'c_qual', type: 'checkbox' } } });
  assert.deepEqual(mondayColumnValues(cb, payload()).c_qual, { checked: 'true' });
  const no = mondayColumnValues(cb, payload({
    qualification: { qualified: false, summary: '', unknownChecks: 0, checks: [] },
  }));
  assert.deepEqual(no.c_qual, { checked: 'false' });
});

test('a missing phone or revenue simply does not appear', () => {
  const v = mondayColumnValues(FULL, payload({
    contact: { name: 'Dana', email: 'dana@example.com', phone: null, consentAt: null },
    metrics: { annualRevenue: null, occupancy: null, averageNightlyRate: null, averageReviewCount: null, saturation: null },
  }));
  assert.equal(v.c_phone, undefined);
  assert.equal(v.c_rev, undefined);
  assert.ok(v.c_email);
});

test('the file column is never a column value — it is uploaded separately', () => {
  const withFile = parseMondayConfig({ boardId: '99', columns: { file: { id: 'c_file', type: 'file' }, email: { id: 'c_email', type: 'email' } } });
  const v = mondayColumnValues(withFile, payload());
  assert.equal(v.c_file, undefined, 'a file goes through add_file_to_column, not create_item');
});

test('every advertised field is one the mapper actually writes', () => {
  // Guards against the picker offering a field the mapper silently ignores.
  const cols: Record<string, { id: string; type: string }> = {};
  for (const f of MONDAY_FIELDS) cols[f.id] = { id: `c_${f.id}`, type: 'text' };
  const v = mondayColumnValues(parseMondayConfig({ boardId: '1', columns: cols }), payload());
  for (const f of MONDAY_FIELDS) {
    if (f.id === 'file') continue; // uploaded, not written as a value
    assert.ok(v[`c_${f.id}`] !== undefined, `${f.id} is offered but never written`);
  }
});
