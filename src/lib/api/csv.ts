import type { LeadRecord } from './leads-query.ts';
import { STAGE_LABELS } from '../leads/stage.ts';

/**
 * Leads as CSV.
 *
 * Pure and tested, because CSV quoting is the kind of thing that looks right
 * on every row you try by hand and then corrupts a customer's whole export
 * the first time a property address contains a comma — or, worse, opens a
 * formula in their spreadsheet.
 */

export const LEAD_CSV_COLUMNS = [
  'leadId', 'createdAt', 'status', 'funnel', 'name', 'email', 'phone',
  'address', 'postcode', 'postcodeArea', 'bedrooms',
  'annualRevenue', 'occupancy', 'averageNightlyRate', 'averageReviewCount', 'saturation',
  'qualified', 'qualificationSummary', 'reportUrl', 'crmItemId',
  // Appended, not inserted: a customer's spreadsheet may read by position.
  'stage',
] as const;

/**
 * A leading =, +, - or @ makes Excel and Sheets treat a cell as a formula.
 * A lead's name or address is attacker-controlled — anyone can type into a
 * public funnel — so a cell that would start one is prefixed with a quote,
 * which those applications strip on display.
 */
function neutralise(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
  const safe = neutralise(raw);
  // Quote when the cell contains anything that would otherwise end it early.
  // A quote inside a quoted field is doubled — RFC 4180.
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',');
}

export function leadsCsv(records: readonly LeadRecord[]): string {
  const lines = [csvRow(LEAD_CSV_COLUMNS)];
  for (const r of records) {
    const l = r.lead;
    lines.push(csvRow([
      r.id,
      l.createdAt,
      r.status,
      l.funnel.name,
      l.contact.name,
      l.contact.email,
      l.contact.phone,
      l.property.address,
      l.property.postcode,
      l.property.postcodeArea,
      l.property.bedrooms,
      l.metrics.annualRevenue,
      l.metrics.occupancy,
      l.metrics.averageNightlyRate,
      l.metrics.averageReviewCount,
      l.metrics.saturation,
      // Blank rather than "no" when the report has not run: a queued lead
      // has not been judged, and "no" would read as "did not qualify".
      l.qualification.qualified === null ? '' : l.qualification.qualified,
      l.qualification.summary,
      l.report.url,
      r.crmItemId,
      STAGE_LABELS[r.stage] ?? r.stage,
    ]));
  }
  // A trailing newline: some parsers drop the final row without one.
  return `${lines.join('\r\n')}\r\n`;
}
