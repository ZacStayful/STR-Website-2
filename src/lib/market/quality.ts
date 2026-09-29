/**
 * Which analyser reports are trustworthy enough to count as market data.
 *
 * The analyser does not fail loudly when its short-let data source does. When
 * it finds no real comparable listings it returns a SYNTHETIC estimate — a
 * plausible gross revenue with `dataQuality.comparablesFound === 0` — and the
 * run "succeeds". That row is still stored in `analyser_reports`, with a
 * positive gross revenue, so the `gross_revenue > 0` test alone lets it into
 * every Market Explorer figure.
 *
 * The rule here is the estimate software's own side-effect gate
 * (Stayful-STR-estimate-software `src/lib/bulk/gate.ts`, `bulkSideEffectGate`),
 * which is also what the Stayful lead database reads as `quality_ok` before it
 * charges a customer for an analysis: a report built on no comparables, or
 * that the analyser itself rated `low`, is not market data. Using the same
 * rule means a property the lead database refunded a customer for can never
 * turn up as a figure here.
 *
 * Rows with NO quality block are kept. Those are the Monday backfill: figures
 * read out of real Stayful analysis PDFs, which never carried a `dataQuality`
 * object. There is nothing to judge them on, and dropping them would empty
 * half the explorer.
 *
 * Pure (no I/O) so it can be unit-tested; source.ts and the broker's internal
 * provider feed it the two fields they select from `raw_response`.
 */

/** `analyser_reports.source` for runs requested by the Stayful lead database. */
export const LEAD_DB_SOURCE = 'lead_db';

/** The Monday backfill: figures read out of past Stayful analysis PDFs. */
export const BACKFILL_SOURCE = 'monday_backfill';

/** A marketplace deal's own comparables check (Batch 16), stored in the analyser's shape. */
export const DEAL_COMPS_SOURCE = 'deal_comps';

export interface ReportQuality {
  /** `raw_response.dataQuality.comparablesFound`; null or absent when the row carries no quality block. */
  comparables_found?: number | null;
  /** `raw_response.dataQuality.level` ('high' | 'moderate' | 'low'); null or absent when there is none. */
  quality_level?: string | null;
}

/** True when the report can count as market data. See the header for the rule. */
export function isTrustworthyReport(q: ReportQuality): boolean {
  // `!= null` on purpose: absent and null both mean "not judged".
  const judged = q.comparables_found != null || q.quality_level != null;
  if (!judged) return true;
  if (q.quality_level === 'low') return false;
  return (q.comparables_found ?? 0) > 0;
}

/**
 * Rows that may feed the listing quick view's single-postcode figure
 * ("Average of N recent Stayful reports for this postcode and size").
 *
 * A full postcode is a handful of addresses, and that figure can rest on ONE
 * report, so it would show one property's analysis on its own. A property a
 * lead-database customer analysed from their own lead list must never be shown
 * that way: those rows count in the area, district and bedroom figures and
 * never at postcode level. Those figures are not guaranteed to pool several
 * reports: an area, or one bedroom size inside an area or a ready district,
 * can rest on one (only a district's own figures wait for
 * MIN_DISTRICT_SAMPLES). The line drawn is the full postcode.
 *
 * Two more sources stay out (Batch 16). The Monday backfill now gets its
 * postcodes back, but its PDFs date from months before the 16 July load
 * that stamps their created_at, so a "recent" window cannot see how old they
 * are. And a deal check's comparables row is not a report anyone ran, so it
 * cannot stand behind "recent Stayful reports".
 */
export function usableForPostcodeFigure(r: ReportQuality & { source?: string | null }): boolean {
  return r.source !== LEAD_DB_SOURCE && r.source !== BACKFILL_SOURCE && r.source !== DEAL_COMPS_SOURCE && isTrustworthyReport(r);
}
