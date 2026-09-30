import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { planMobileClaims, type KeyPlan, type MobileAccount } from './mobile-claims';

/**
 * Batch 20, Part D: claim every existing account's mobile number
 * (profiles.mobile_key), the oldest account keeping a shared one. The rules
 * are in mobile-claims.ts; this reads the accounts, reports and, when asked,
 * applies each change through public.mobile_key_assign (one transaction per
 * number, so the unique index is never tripped). Safe to repeat: a second run
 * finds nothing left to write.
 *
 * Entry points: /api/internal/mobile-backfill (GET is always a dry run) and
 * the panel on /admin/lifecycle.
 */

const PAGE = 1000;
const TIME_BUDGET_MS = 45_000;

export interface ClashAccount {
  email: string | null;
  created: string | null;
  /** The £20 welcome credit this account was granted (welcome:<id>), in pence. */
  welcomePence: number;
  /** Credit spent to date (debits less refunds), in pence. */
  spentPence: number;
  /** It held this number's key before the run. */
  heldKey: boolean;
}

export interface MobileBackfillResult {
  dry: boolean;
  accounts: number;
  withNumber: number;
  unreadable: number;
  numbers: number;
  alreadyHeld: number;
  toWrite: number;
  written: number;
  failed: { number: string; error: string }[];
  more: boolean;
  clashes: { number: string; keeps: ClashAccount; others: ClashAccount[] }[];
  skipped: { number: string; reason: string }[];
  ms: number;
}

export type MobileBackfillOutcome = { ok: true; result: MobileBackfillResult } | { ok: false; message: string };

function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function readAccounts(): Promise<MobileAccount[]> {
  const admin = createAdminClient();
  const out: MobileAccount[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('profiles').select('id, email, created_at, mobile, mobile_key').order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`profiles read failed: ${error.message}`);
    const rows = (data ?? []) as { id: string; email: string | null; created_at: string | null; mobile: string | null; mobile_key: string | null }[];
    for (const r of rows) out.push({ id: r.id, email: r.email, createdAt: r.created_at, mobile: r.mobile, mobileKey: r.mobile_key });
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Welcome credit granted and credit spent, for the accounts in a clash only. */
async function moneyFor(ids: string[]): Promise<Map<string, { welcome: number; spent: number }>> {
  const out = new Map<string, { welcome: number; spent: number }>(ids.map((id) => [id, { welcome: 0, spent: 0 }]));
  if (ids.length === 0) return out;
  const admin = createAdminClient();
  for (const some of chunk(ids, 100)) {
    const [grants, txs] = await Promise.all([
      admin.from('credit_grants').select('user_id, amount_pence, source_ref').in('user_id', some).eq('kind', 'welcome').like('source_ref', 'welcome:%'),
      admin.from('credit_transactions').select('user_id, kind, amount_pence').in('user_id', some).in('kind', ['debit', 'refund']),
    ]);
    if (grants.error) throw new Error(`credit_grants read failed: ${grants.error.message}`);
    if (txs.error) throw new Error(`credit_transactions read failed: ${txs.error.message}`);
    for (const g of (grants.data ?? []) as { user_id: string; amount_pence: number | string; source_ref: string }[]) {
      if (g.source_ref !== `welcome:${g.user_id}`) continue;
      out.get(g.user_id)!.welcome += Number(g.amount_pence) || 0;
    }
    // A debit's amount is the credit it took (negative); a refund's, what came back (positive).
    for (const t of (txs.data ?? []) as { user_id: string; kind: string; amount_pence: number | string }[]) {
      out.get(t.user_id)!.spent -= Number(t.amount_pence) || 0;
    }
  }
  return out;
}

function clashAccount(a: MobileAccount, key: string, money: Map<string, { welcome: number; spent: number }>): ClashAccount {
  const m = money.get(a.id) ?? { welcome: 0, spent: 0 };
  return { email: a.email, created: a.createdAt, welcomePence: Math.round(m.welcome), spentPence: Math.max(0, Math.round(m.spent)), heldKey: a.mobileKey === key };
}

export async function runMobileBackfill(opts: { apply: boolean }): Promise<MobileBackfillOutcome> {
  const started = Date.now();
  if (!hasServiceRole()) return { ok: false, message: 'Storage is not configured.' };
  try {
    const plan = planMobileClaims(await readAccounts());
    const clashIds = [...new Set(plan.clashes.flatMap((k) => [k.keeper.id, ...k.others.map((o) => o.id)]))];
    const money = await moneyFor(clashIds);
    const result: MobileBackfillResult = {
      dry: !opts.apply,
      accounts: plan.accounts,
      withNumber: plan.withNumber,
      unreadable: plan.unreadable,
      numbers: plan.keys.length,
      alreadyHeld: plan.keys.length - plan.changes.length,
      toWrite: plan.changes.length,
      written: 0,
      failed: [],
      more: false,
      clashes: plan.clashes.map((k) => ({ number: k.masked, keeps: clashAccount(k.keeper, k.key, money), others: k.others.map((o) => clashAccount(o, k.key, money)) })),
      skipped: plan.skipped.map((s) => ({ number: s.masked, reason: s.reason })),
      ms: 0,
    };
    if (opts.apply) {
      const admin = createAdminClient();
      for (const change of plan.changes as KeyPlan[]) {
        if (Date.now() - started > TIME_BUDGET_MS) {
          result.more = true;
          break;
        }
        const { error } = await admin.rpc('mobile_key_assign', { p: { key: change.key, keep: change.keeper.id, apply: true } });
        if (error) result.failed.push({ number: change.masked, error: error.message.slice(0, 200) });
        else result.written += 1;
      }
    }
    result.ms = Date.now() - started;
    console.log('[mobile-backfill]', JSON.stringify({ dry: result.dry, accounts: result.accounts, toWrite: result.toWrite, written: result.written, failed: result.failed.length, clashes: result.clashes.length, more: result.more, ms: result.ms }));
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[mobile-backfill] failed:', message);
    return { ok: false, message };
  }
}
