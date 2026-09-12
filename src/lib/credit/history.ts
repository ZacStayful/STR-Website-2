import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { round4 } from './pricing';

/** One row on the usage page: a debit group (an action), a grant, an expiry or a refund. */
export interface UsageItem {
  id: string;
  at: string;
  kind: 'debit' | 'grant' | 'refund' | 'expire' | 'adjust';
  action: string | null;
  actionId: string | null;
  description: string;
  /** Grant pence moved (− for debits). */
  amountPence: number;
  /** Base pence for debits / refunds. */
  basePence: number | null;
  lines: { provider: string; unit: string; quantity: number | null; basePence: number; amountPence: number; description: string | null; at: string }[];
  /** Grant kind for grant/expire rows. */
  grantKind: string | null;
  expiresAt: string | null;
}

interface TxRow {
  id: number;
  at: string;
  kind: string;
  amount_pence: number | string;
  base_pence: number | string | null;
  action_id: string | null;
  action: string | null;
  provider: string | null;
  unit: string | null;
  quantity: number | string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
}

const ACTION_LABELS: Record<string, string> = {
  report: 'Full property report',
  quick_view: 'Listing check (quick view)',
  narrate: 'AI narration',
  speak: 'AI voice',
  autocomplete: 'Address lookup',
  geocode: 'Home postcode lookup',
  'cron:sourcing': 'Deal-sourcing digest',
  'cron:recheck': 'Saved listing re-check',
};

export function actionLabel(action: string | null): string {
  if (!action) return 'Usage';
  return ACTION_LABELS[action] ?? action;
}

/**
 * Pages through a member's ledger newest first, grouping every debit of one
 * action into a single row with expandable lines.
 */
export async function usageHistory(userId: string, opts: { limit?: number; before?: string | null } = {}): Promise<{ items: UsageItem[]; nextCursor: string | null }> {
  if (!hasServiceRole()) return { items: [], nextCursor: null };
  const limit = Math.min(200, Math.max(10, opts.limit ?? 50));
  // Fetch generously: several debit rows collapse into one item.
  let q = createAdminClient().from('credit_transactions').select('id, at, kind, amount_pence, base_pence, action_id, action, provider, unit, quantity, description, metadata').eq('user_id', userId).order('at', { ascending: false }).order('id', { ascending: false }).limit(limit * 6);
  if (opts.before) q = q.lt('at', opts.before);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as TxRow[];

  const items: UsageItem[] = [];
  const byAction = new Map<string, UsageItem>();
  for (const r of rows) {
    const amount = Number(r.amount_pence) || 0;
    const base = r.base_pence === null ? null : Number(r.base_pence) || 0;
    if (r.kind === 'debit' && r.action_id) {
      let item = byAction.get(r.action_id);
      if (!item) {
        item = { id: `a:${r.action_id}`, at: r.at, kind: 'debit', action: r.action, actionId: r.action_id, description: actionLabel(r.action), amountPence: 0, basePence: 0, lines: [], grantKind: null, expiresAt: null };
        byAction.set(r.action_id, item);
        items.push(item);
      }
      item.amountPence = round4(item.amountPence + amount);
      item.basePence = round4((item.basePence ?? 0) + (base ?? 0));
      if (new Date(r.at) > new Date(item.at)) item.at = r.at;
      item.lines.push({ provider: r.provider ?? '', unit: r.unit ?? '', quantity: r.quantity === null ? null : Number(r.quantity), basePence: base ?? 0, amountPence: amount, description: r.description, at: r.at });
      continue;
    }
    const meta = r.metadata ?? {};
    items.push({
      id: `t:${r.id}`,
      at: r.at,
      kind: (r.kind as UsageItem['kind']) ?? 'adjust',
      action: r.action,
      actionId: r.action_id,
      description: r.description ?? (r.kind === 'grant' ? 'Credit added' : r.kind === 'expire' ? 'Credit expired' : r.kind === 'refund' ? 'Refund' : 'Adjustment'),
      amountPence: amount,
      basePence: base,
      lines: [],
      grantKind: typeof meta.grant_kind === 'string' ? meta.grant_kind : null,
      expiresAt: typeof meta.expires_at === 'string' ? meta.expires_at : null,
    });
    if (items.length >= limit) break;
  }
  const sliced = items.slice(0, limit);
  const last = sliced[sliced.length - 1];
  const more = rows.length >= limit * 6 || items.length > limit;
  return { items: sliced, nextCursor: more && last ? last.at : null };
}

/** Median base pence of the last 50 completed actions of this kind, or null when too few. */
export async function typicalActionSpend(action: string, minSamples = 5): Promise<number | null> {
  if (!hasServiceRole()) return null;
  const { data } = await createAdminClient().from('credit_transactions').select('action_id, base_pence').eq('kind', 'debit').eq('action', action).order('at', { ascending: false }).limit(600);
  const totals = new Map<string, number>();
  for (const r of data ?? []) {
    if (!r.action_id) continue;
    totals.set(String(r.action_id), (totals.get(String(r.action_id)) ?? 0) + (Number(r.base_pence) || 0));
  }
  const values = [...totals.values()].slice(0, 50).sort((a, b) => a - b);
  if (values.length < minSamples) return null;
  const mid = Math.floor(values.length / 2);
  return round4(values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2);
}
