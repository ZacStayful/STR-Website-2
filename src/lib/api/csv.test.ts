import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvRow, leadsCsv, LEAD_CSV_COLUMNS } from './csv.ts';
import type { LeadRecord } from './leads-query.ts';

test('a plain value needs no quoting', () => {
  assert.equal(csvCell('York'), 'York');
  assert.equal(csvCell(42), '42');
});

test('a comma or newline is quoted so the row does not end early', () => {
  assert.equal(csvCell('17 Park Crescent, York'), '"17 Park Crescent, York"');
  assert.equal(csvCell('line one\nline two'), '"line one\nline two"');
  assert.equal(csvCell('carriage\r'), '"carriage\r"');
});

test('a quote inside a field is doubled, per RFC 4180', () => {
  assert.equal(csvCell('The "Old" Mill'), '"The ""Old"" Mill"');
});

test('a formula is neutralised — a funnel is a public text box', () => {
  // Anyone can type this into a customer's funnel; it must not execute when
  // the customer opens their export.
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+44 7700 900123'), "'+44 7700 900123");
  assert.equal(csvCell('-3'), "'-3");
  assert.equal(csvCell('@SUM(A1:A9)'), "'@SUM(A1:A9)");
});

test('a neutralised value that also needs quoting gets both', () => {
  assert.equal(csvCell('=HYPERLINK("http://x","a")'), '"\'=HYPERLINK(""http://x"",""a"")"');
});

test('nothing becomes an empty cell, not the word null', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(''), '');
});

test('booleans read as words a person expects in a spreadsheet', () => {
  assert.equal(csvCell(true), 'yes');
  assert.equal(csvCell(false), 'no');
});

test('a row joins cells with commas', () => {
  assert.equal(csvRow(['a', 'b,c', null]), 'a,"b,c",');
});

/**
 * A minimal RFC 4180 reader, so the assertions below read real columns
 * rather than splitting on commas — which is exactly the bug the quoting
 * exists to prevent, and would make these tests agree with a broken export.
 */
function parseRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cell); cell = ''; }
    else cell += c;
  }
  cells.push(cell);
  return cells;
}

function record(over: Partial<LeadRecord['lead']> = {}, status = 'new'): LeadRecord {
  return {
    id: 'lead-1',
    status,
    crmItemId: null,
    crmPushedAt: null,
    lead: {
      version: 1,
      event: 'lead.created',
      leadId: 'lead-1',
      createdAt: '2026-03-04T09:30:00.000Z',
      funnel: { id: 'f1', name: 'Website form' },
      contact: { name: 'Dana Okafor', email: 'dana@example.com', phone: null, consentAt: null },
      property: { address: '17 Park Crescent, York', postcode: 'YO31 7NU', postcodeArea: 'YO', bedrooms: 3 },
      metrics: { annualRevenue: 42812, occupancy: 0.68, averageNightlyRate: 172, averageReviewCount: 54, saturation: 'uncontested' },
      qualification: { qualified: true, summary: 'Met all rules.', unknownChecks: 0, checks: [] },
      report: { url: 'https://stayful.co.uk/r/tok', pdfUrl: 'https://stayful.co.uk/r/tok/pdf' },
      ...over,
    },
  };
}

test('the export opens with a header row and ends with a newline', () => {
  const csv = leadsCsv([]);
  assert.equal(csv, `${LEAD_CSV_COLUMNS.join(',')}\r\n`);
});

test('a lead exports with its address quoted and its numbers bare', () => {
  const csv = leadsCsv([record()]);
  const [header, row] = csv.trimEnd().split('\r\n');
  assert.deepEqual(parseRow(header), [...LEAD_CSV_COLUMNS]);

  const cells = parseRow(row);
  assert.equal(cells.length, LEAD_CSV_COLUMNS.length, 'the comma in the address must not add a column');
  const at = (name: (typeof LEAD_CSV_COLUMNS)[number]) => cells[LEAD_CSV_COLUMNS.indexOf(name)];
  assert.equal(at('address'), '17 Park Crescent, York');
  assert.equal(at('annualRevenue'), '42812');
  assert.equal(at('qualified'), 'yes');
  assert.equal(at('reportUrl'), 'https://stayful.co.uk/r/tok');
});

test('a queued lead leaves Qualified blank rather than saying no', () => {
  // "no" would read as "did not qualify"; it has not been judged at all.
  const csv = leadsCsv([record({ qualification: { qualified: null, summary: '', unknownChecks: 0, checks: [] } }, 'queued')]);
  const cells = parseRow(csv.trimEnd().split('\r\n')[1]);
  assert.equal(cells[LEAD_CSV_COLUMNS.indexOf('qualified')], '');
  assert.equal(cells[LEAD_CSV_COLUMNS.indexOf('status')], 'queued');
});
