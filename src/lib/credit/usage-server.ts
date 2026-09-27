import 'server-only';

/**
 * The reads behind the Usage page (/account/usage): which period, and every
 * charge and refund on the PAYING account in it (a team member sees their
 * team's, which is what they spend). Categorised by usage-breakdown.ts.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import type { LedgerLine } from './usage-breakdown';

export interface UsagePeriod {
  kind: 'plan' | 'month';
  start: Date;
  /** "since 3 September" / "September". */
  label: string;
}

const PAGE = 1000;
/** Enough for any month a real account has; the page says so if it is ever reached. */
const MAX_LINES = 20_000;

/** Midnight on the 1st of the current month in the UK, as an instant. */
export function ukMonthStart(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const utcMidnight = new Date(Date.UTC(y, m - 1, 1));
  // In British Summer Time the UK's midnight is 23:00 UTC the day before.
  const ukHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).format(utcMidnight));
  return ukHour === 1 ? new Date(utcMidnight.getTime() - 60 * 60 * 1000) : utcMidnight;
}

/**
 * The period the page covers: a plan member's current plan period (from the
 * grant that began it), else the UK calendar month.
 */
export async function usagePeriodFor(payerId: string, onPlan: boolean, now: Date = new Date()): Promise<UsagePeriod> {
  if (onPlan && hasServiceRole()) {
    const { data } = await createAdminClient()
      .from('credit_grants')
      .select('created_at')
      .eq('user_id', payerId)
      .eq('kind', 'plan')
      .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
      .order('created_at', { ascending: true })
      .limit(1);
    const started = ((data ?? []) as { created_at: string }[])[0]?.created_at;
    if (started && Number.isFinite(Date.parse(started))) {
      const start = new Date(started);
      return { kind: 'plan', start, label: `since ${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' })}` };
    }
  }
  const start = ukMonthStart(now);
  return { kind: 'month', start, label: now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' }) };
}

/** Every debit and refund on the account since `since`, as ledger lines. `failed`: the ledger could not be read. */
export async function usageLinesSince(payerId: string, since: Date): Promise<{ lines: LedgerLine[]; truncated: boolean; failed: boolean }> {
  const lines: LedgerLine[] = [];
  if (!hasServiceRole()) return { lines, truncated: false, failed: true };
  const admin = createAdminClient();
  for (let from = 0; from < MAX_LINES; from += PAGE) {
    const { data, error } = await admin
      .from('credit_transactions')
      .select('kind, action, provider, unit, action_id, amount_pence, metadata')
      .eq('user_id', payerId)
      .in('kind', ['debit', 'refund'])
      .gte('at', since.toISOString())
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[usage] ledger read failed:', error.message);
      return { lines: [], truncated: false, failed: true };
    }
    for (const r of (data ?? []) as { kind: string; action: string | null; provider: string | null; unit: string | null; action_id: string | null; amount_pence: number | string; metadata: Record<string, unknown> | null }[]) {
      lines.push({ kind: r.kind === 'refund' ? 'refund' : 'debit', action: r.action, provider: r.provider, unit: r.unit, actionId: r.action_id, facePence: Math.abs(Number(r.amount_pence) || 0), metadata: r.metadata });
    }
    if ((data?.length ?? 0) < PAGE) return { lines, truncated: false, failed: false };
  }
  return { lines, truncated: true, failed: false };
}
