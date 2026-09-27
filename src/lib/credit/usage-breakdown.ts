/**
 * Where a member's credit went this period, as a breakdown that always adds
 * up to 100% (Batch 10's Usage page): Daily deals, Full analyses, Quick
 * looks, PMI second opinions and Other. Amounts are FACE pence (what left the
 * balance, top-up credit at its rate), and a refund comes off the category
 * of what it refunded.
 *
 * A Quick look bought as part of a one-tap Full analysis is the analysis's:
 * the full_analysis debit names it (metadata.open_action_id).
 *
 * Pure: relative `.ts` imports only.
 */

export type UsageCategory = 'daily' | 'full' | 'quick' | 'pmi' | 'other';

export const USAGE_ORDER: readonly UsageCategory[] = ['daily', 'full', 'quick', 'pmi', 'other'];

export const USAGE_LABELS: Record<UsageCategory, string> = {
  daily: 'Daily deals',
  full: 'Full analyses',
  quick: 'Quick looks',
  pmi: 'PMI second opinions',
  other: 'Other',
};

export interface LedgerLine {
  kind: 'debit' | 'refund';
  action: string | null;
  provider: string | null;
  unit: string | null;
  actionId: string | null;
  /** Positive: what left (a debit) or came back (a refund). */
  facePence: number;
  metadata: Record<string, unknown> | null;
}

/** Quick looks bought inside a one-tap Full analysis: the open action ids its debit names. */
export function oneTapOpens(lines: readonly LedgerLine[]): Set<string> {
  const out = new Set<string>();
  for (const l of lines) {
    const id = l.action === 'full_analysis' ? l.metadata?.open_action_id : null;
    if (typeof id === 'string' && id) out.add(id);
  }
  return out;
}

export function categorise(line: LedgerLine, oneTap: ReadonlySet<string>): UsageCategory {
  // A funnel lead is the member's customer's, never their own research.
  if (line.metadata && typeof line.metadata.funnel_id === 'string' && line.metadata.funnel_id) return 'other';
  switch (line.action) {
    case 'todays_5':
    case 'cron:sourcing':
      return 'daily';
    case 'full_analysis':
      return 'full';
    case 'pmi_addon':
      return 'pmi';
    case 'report':
    case 'report_enhanced':
      // An enhanced report's own PMI call is the PMI part of it.
      return line.provider === 'pmi' ? 'pmi' : 'full';
    case 'deal_open':
      return line.actionId && oneTap.has(line.actionId) ? 'full' : 'quick';
    default:
      return 'other';
  }
}

/** Whole percentages that always sum to 100 (largest remainder), or all 0 when nothing was spent. */
export function percentages(values: readonly number[]): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  if (total <= 0) return clean.map(() => 0);
  const raw = clean.map((v) => (v / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || clean[b.i] - clean[a.i]);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

export interface UsageRow {
  category: UsageCategory;
  label: string;
  facePence: number;
  pct: number;
}

export interface UsageBreakdown {
  totalFacePence: number;
  rows: UsageRow[];
}

export function usageBreakdown(lines: readonly LedgerLine[]): UsageBreakdown {
  const oneTap = oneTapOpens(lines);
  const totals = new Map<UsageCategory, number>(USAGE_ORDER.map((c) => [c, 0]));
  for (const l of lines) {
    const c = categorise(l, oneTap);
    const amount = Math.abs(Number(l.facePence) || 0);
    totals.set(c, (totals.get(c) ?? 0) + (l.kind === 'refund' ? -amount : amount));
  }
  const amounts = USAGE_ORDER.map((c) => Math.max(0, Math.round((totals.get(c) ?? 0) * 100) / 100));
  const pcts = percentages(amounts);
  return {
    totalFacePence: amounts.reduce((a, b) => a + b, 0),
    rows: USAGE_ORDER.map((c, i) => ({ category: c, label: USAGE_LABELS[c], facePence: amounts[i], pct: pcts[i] })),
  };
}
