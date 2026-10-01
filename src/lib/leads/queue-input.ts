/**
 * Batch 21 (C4): what the drain runs a queued lead with.
 *
 * The funnel route stores the whole parsed input on the lead (leads.input,
 * Batch 21a) so a report run later is for the property the prospect
 * described: type, bathrooms, parking, outdoor space, guests. Leads captured
 * before that column existed carry only address, postcode and bedrooms, and
 * are rebuilt from those as before (a flat with defaults).
 *
 * The depth is the funnel's choice at run time, never the one stored.
 *
 * Pure: no network, no database, no server-only.
 */
import { parseAnalysisInput, type AnalysisInput } from '../analysis/input.ts';
import { defaultGuests } from '../listing/normalise.ts';

export interface QueuedLeadRow {
  address: string | null;
  postcode: string | null;
  bedrooms: number | null;
  /** leads.input: absent or null for older leads and until the column exists. */
  input?: unknown;
}

function isStoredInput(v: unknown): v is AnalysisInput {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const p = o.property;
  if (!p || typeof p !== 'object') return false;
  const prop = p as Record<string, unknown>;
  return (
    typeof prop.address === 'string' &&
    typeof prop.postcode === 'string' &&
    typeof prop.bedrooms === 'number' &&
    typeof prop.guests === 'number' &&
    typeof o.propertyType === 'string' &&
    typeof o.outdoorSpace === 'string' &&
    typeof o.parkingSpaces === 'number' &&
    typeof o.hasParking === 'boolean'
  );
}

export function queuedAnalysisInput(lead: QueuedLeadRow, opts: { enhanced: boolean }): AnalysisInput | null {
  if (isStoredInput(lead.input)) return { ...lead.input, enhancedRequested: opts.enhanced };
  if (!lead.address || !lead.postcode) return null;
  const parsed = parseAnalysisInput({
    address: lead.address,
    postcode: lead.postcode,
    bedrooms: lead.bedrooms ?? 2,
    guests: defaultGuests(lead.bedrooms ?? 2),
    enhanced: opts.enhanced,
  });
  return parsed.ok ? parsed.input : null;
}
