/**
 * The customer's own sales stage for a lead.
 *
 * For customers without a CRM, this is their pipeline. It is separate from
 * `status` (status.ts), which is OUR delivery state — whether the report ran
 * and whether it reached their CRM. A customer marking a lead "Signed" must
 * never be read as, or overwrite, "pushed".
 *
 * Fixed list, mirrored by the `leads_stage_check` constraint in schema.sql.
 * Pure module so it runs under `node --test`.
 */

export const LEAD_STAGES = ['new', 'contacted', 'meeting_booked', 'signed', 'lost'] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

export const STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  meeting_booked: 'Meeting booked',
  signed: 'Signed',
  lost: 'Lost',
};

const KNOWN = new Set<string>(LEAD_STAGES);

export function isStage(value: unknown): value is LeadStage {
  return typeof value === 'string' && KNOWN.has(value);
}

/** A stage from a form or query string, or null when it is not one. */
export function parseStage(value: unknown): LeadStage | null {
  return isStage(value) ? value : null;
}

/** Tolerates a row written before the column existed, or anything unexpected. */
export function stageLabel(value: unknown): string {
  return isStage(value) ? STAGE_LABELS[value] : STAGE_LABELS.new;
}
