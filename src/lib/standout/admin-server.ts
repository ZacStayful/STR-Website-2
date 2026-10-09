import 'server-only';

/**
 * Batch 25: what /admin/standout lists — every standout decision with its
 * reason, the member, the deal (public facts only: town, area, bedrooms,
 * type — never an address or a link to the listing), the match, the profit
 * against the member's minimum, when it was saved, the call, and what the
 * member did with it. Admin only.
 */
import { createAdminClient } from '../supabase/admin';
import { dealTypeOf, DEAL_TYPE_LABELS, type DealType } from '../profile/deal-types';
import { emailKey } from '../supabase/email-key';

type Admin = ReturnType<typeof createAdminClient>;

export interface AdminDecision {
  id: string;
  userId: string;
  email: string | null;
  dealId: string | null;
  dealLabel: string | null;
  dealType: string | null;
  dealTypeLabel: string | null;
  tier: string;
  outcome: string;
  reason: string;
  matchPct: number | null;
  checked: number | null;
  revealPct: number | null;
  profitLow: number | null;
  minProfit: number | null;
  profitBasis: string | null;
  savedAt: string | null;
  notify: string | null;
  callStatus: string | null;
  notForMeAt: string | null;
  openedAt: string | null;
  stageMovedAt: string | null;
  forced: boolean;
  createdAt: string;
}

const COLUMNS = 'id, user_id, deal_id, deal_type, tier, outcome, reason, match_pct, checked, reveal_pct, profit_low_pcm, min_profit_pcm, profit_basis, saved_at, notify, call_status, not_for_me_at, opened_at, stage_moved_at, forced, created_at';

export async function adminDecisions(admin: Admin, o: { memberId?: string | null; all?: boolean; limit?: number }): Promise<AdminDecision[] | null> {
  let q = admin.from('standout_decisions').select(COLUMNS).order('created_at', { ascending: false }).limit(Math.min(500, o.limit ?? 200));
  if (o.memberId) q = q.eq('user_id', o.memberId);
  if (!o.all) q = q.in('outcome', ['standout', 'waiting']);
  const { data, error } = await q;
  if (error) {
    console.error('[standout] admin read failed (schema not run?):', error.message);
    return null;
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const userIds = [...new Set(rows.map((r) => String(r.user_id)))];
  const dealIds = [...new Set(rows.map((r) => r.deal_id).filter((x): x is string => typeof x === 'string'))];
  const [emails, deals] = await Promise.all([
    userIds.length ? admin.from('profiles').select('id, email').in('id', userIds) : Promise.resolve({ data: [] as unknown[] }),
    dealIds.length ? admin.from('marketplace_deals').select('id, kind, town, postcode_area, bedrooms, project').in('id', dealIds) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const emailBy = new Map(((emails.data ?? []) as { id: string; email: string | null }[]).map((r) => [r.id, r.email]));
  const dealBy = new Map(((deals.data ?? []) as { id: string; kind: string; town: string | null; postcode_area: string | null; bedrooms: number | null; project: unknown }[]).map((r) => [r.id, r]));
  return rows.map((r) => {
    const d = typeof r.deal_id === 'string' ? dealBy.get(r.deal_id) : undefined;
    const type = (r.deal_type as string | null) ?? (d ? dealTypeOf(d) : null);
    const label = d ? [d.bedrooms ? `${d.bedrooms}-bed` : null, d.town, d.postcode_area].filter(Boolean).join(' · ') : null;
    const n = (v: unknown) => (typeof v === 'number' ? v : v === null || v === undefined ? null : Number(v));
    return {
      id: String(r.id),
      userId: String(r.user_id),
      email: emailBy.get(String(r.user_id)) ?? null,
      dealId: (r.deal_id as string | null) ?? null,
      dealLabel: label,
      dealType: type,
      dealTypeLabel: type ? DEAL_TYPE_LABELS[type as DealType] ?? type : null,
      tier: String(r.tier),
      outcome: String(r.outcome),
      reason: String(r.reason),
      matchPct: n(r.match_pct),
      checked: n(r.checked),
      revealPct: n(r.reveal_pct),
      profitLow: n(r.profit_low_pcm),
      minProfit: n(r.min_profit_pcm),
      profitBasis: (r.profit_basis as string | null) ?? null,
      savedAt: (r.saved_at as string | null) ?? null,
      notify: (r.notify as string | null) ?? null,
      callStatus: (r.call_status as string | null) ?? null,
      notForMeAt: (r.not_for_me_at as string | null) ?? null,
      openedAt: (r.opened_at as string | null) ?? null,
      stageMovedAt: (r.stage_moved_at as string | null) ?? null,
      forced: r.forced === true,
      createdAt: String(r.created_at),
    };
  });
}

/** The last few passes, for the page's header. */
export async function recentRuns(admin: Admin, n = 5): Promise<{ kind: string; startedAt: string; finishedAt: string | null; summary: Record<string, unknown> }[] | null> {
  const { data, error } = await admin.from('standout_runs').select('kind, started_at, finished_at, summary').order('started_at', { ascending: false }).limit(n);
  if (error) return null;
  return ((data ?? []) as { kind: string; started_at: string; finished_at: string | null; summary: Record<string, unknown> }[]).map((r) => ({ kind: r.kind, startedAt: r.started_at, finishedAt: r.finished_at, summary: r.summary ?? {} }));
}

/** The member's id from their email (admin filters and the force helper). */
export async function memberIdByEmail(admin: Admin, email: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('id').eq('email', emailKey(email)).maybeSingle();
  return ((data as { id: string } | null)?.id) ?? null;
}
