/**
 * What a charge is called on the billing page.
 *
 * The governing rule of the funnel feature is that a member's own reports
 * and their inbound leads are two different products and must never be
 * combined. That holds in storage, navigation and the API — and until now
 * not here, where both showed as "Property report" and a customer running
 * a hundred leads a month could not tell what their own research had cost
 * them.
 *
 * Pure and tested because it is the one part of this change with rules in
 * it, and because a billing label that is subtly wrong is the kind of thing
 * a customer notices before we do.
 */

export const ACTION_LABELS: Record<string, string> = {
  report: 'Property report',
  report_enhanced: 'Enhanced property report (with PMI second opinion)',
  quick_view: 'Listing check (quick view)',
  narrate: 'AI narration',
  speak: 'AI voice',
  autocomplete: 'Address lookup',
  geocode: 'Home postcode lookup',
  'cron:sourcing': 'Deal-sourcing digest',
  'cron:recheck': 'Saved listing re-check',
  deal_open: 'Deal sheet',
  deal_open_verify: 'Deal sheet check',
  team_seat: 'Team seat',
};

export function actionLabel(action: string | null): string {
  if (!action) return 'Usage';
  return ACTION_LABELS[action] ?? action;
}

/** Longest funnel name shown inline before it is cut. */
const MAX_NAME = 40;

/**
 * Trims a customer's funnel name for display.
 *
 * The name is customer-supplied and lands in a list row, so it is collapsed
 * to one line and capped. No escaping here — React escapes on render, and
 * doing it twice would show a customer their own ampersands as `&amp;`.
 */
export function tidyFunnelName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > MAX_NAME ? `${cleaned.slice(0, MAX_NAME - 1).trimEnd()}…` : cleaned;
}

/**
 * The description for one usage row.
 *
 * A funnel charge is named for what it IS — an inbound lead — rather than
 * for the action that produced it, because "Property report" is exactly the
 * word that makes it indistinguishable from the member's own. The depth
 * (standard or enhanced) is dropped from the funnel wording: it is the
 * funnel's setting, not a choice made per lead, and it makes the row longer
 * without telling the customer anything they can act on.
 *
 * A funnel that has since been deleted still gets "Funnel lead" rather than
 * falling back to the member wording. Losing the name is a cosmetic gap;
 * describing a lead as the customer's own research is a wrong answer.
 */
export function usageDescription(input: {
  action: string | null;
  isFunnel: boolean;
  funnelName?: string | null;
}): string {
  if (!input.isFunnel) return actionLabel(input.action);

  const name = tidyFunnelName(input.funnelName);
  // An address lookup billed to a funnel owner is still a lookup, not a
  // lead — the prospect typed into the box and may never have submitted.
  const kind = input.action === 'autocomplete' ? 'Funnel address lookup' : 'Funnel lead';
  return name ? `${kind} — ${name}` : kind;
}

/** Reads the funnel id a debit was tagged with, or null. */
export function funnelIdFromMeta(meta: Record<string, unknown> | null | undefined): string | null {
  const v = meta?.funnel_id;
  return typeof v === 'string' && v.length > 0 ? v : null;
}
