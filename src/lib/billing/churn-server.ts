import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getPlans } from '../credit/plans';
import { monthlyPence, type PriceMap, type SubEvent, type SubEventKind } from './churn';
import type { FirstPayment, Signup } from './conversion';

/**
 * Service-role reads for the churn report. The pure maths lives in churn.ts and
 * conversion.ts; this file only fetches, and hands everything over as plain
 * rows so the aggregation stays testable without a database.
 *
 * subscription_events has RLS on with no policies, so it is service-role only.
 * Every caller here sits behind the admin gate.
 */

// PostgREST caps a page at 1000 rows however large the limit, so everything
// that could exceed that is paged rather than asked for in one go.
const PAGE = 1000;
const MAX_ROWS = 20_000;

const EVENT_COLUMNS =
  'user_id, at, kind, cycle_started_at, plan_code, mrr_pence, reason, reason_comment, source';

interface EventRow {
  user_id: string;
  at: string;
  kind: string;
  cycle_started_at: string | null;
  plan_code: string | null;
  mrr_pence: number | null;
  reason: string | null;
  reason_comment: string | null;
  source: string | null;
}

const KNOWN_KINDS = new Set<SubEventKind>([
  'started',
  'cancel_scheduled',
  'cancel_reverted',
  'ended',
  'paused',
  'resumed',
  'past_due',
  'recovered',
  'plan_changed',
]);

function toEvent(row: EventRow): SubEvent | null {
  // The Supabase client is untyped, so a column that does not exist reads as
  // undefined rather than failing. An unrecognised kind is dropped instead of
  // being folded into the maths as something it is not.
  if (!row.user_id || !row.at || !KNOWN_KINDS.has(row.kind as SubEventKind)) return null;
  return {
    userId: row.user_id,
    at: row.at,
    kind: row.kind as SubEventKind,
    cycleStartedAt: row.cycle_started_at ?? null,
    planCode: row.plan_code ?? null,
    mrrPence: typeof row.mrr_pence === 'number' ? row.mrr_pence : null,
    reason: row.reason ?? null,
    reasonComment: row.reason_comment ?? null,
    source: row.source ?? 'stripe',
  };
}

/** Every subscription event, oldest first. */
export async function loadSubscriptionEvents(): Promise<SubEvent[]> {
  if (!hasServiceRole()) return [];
  const admin = createAdminClient();
  const out: SubEvent[] = [];

  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await admin
      .from('subscription_events')
      .select(EVENT_COLUMNS)
      .order('at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      // A missing table is the expected state until supabase/schema.sql has
      // been applied, and the page says so rather than falling over.
      console.error('[churn] subscription_events read failed:', error.message);
      return out;
    }
    const rows = (data ?? []) as EventRow[];
    for (const row of rows) {
      const event = toEvent(row);
      if (event) out.push(event);
    }
    if (rows.length < PAGE) break;
  }

  return out;
}

/** Monthly-equivalent price per plan code, for cycles whose events predate the snapshot. */
export async function loadPriceMap(): Promise<PriceMap> {
  const map: PriceMap = {};
  try {
    for (const plan of await getPlans()) {
      map[plan.code] = monthlyPence({ pricePence: plan.pricePence, interval: plan.interval });
    }
  } catch (err) {
    console.error('[churn] plan prices unavailable:', err);
  }
  return map;
}

/**
 * Signups and first payments, for the free-credit conversion funnel.
 *
 * Cohort start is profiles.created_at and NOT the welcome grant: welcome
 * grants were backfilled onto members who had already signed up, so the grant
 * date post-dates the signup for everyone who joined before it shipped.
 */
export async function loadConversionInputs(): Promise<{ signups: Signup[]; payments: FirstPayment[] }> {
  if (!hasServiceRole()) return { signups: [], payments: [] };
  const admin = createAdminClient();

  const signups: Signup[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, created_at')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[churn] profiles read failed:', error.message);
      break;
    }
    const rows = (data ?? []) as { id: string; created_at: string | null }[];
    for (const row of rows) if (row.id && row.created_at) signups.push({ userId: row.id, createdAt: row.created_at });
    if (rows.length < PAGE) break;
  }

  // 'welcome' is the free grant everyone gets, so only a topup or a plan cycle
  // counts as paying. A member who went straight onto a subscription has
  // converted just as surely as one who bought a one-off top-up; the two are
  // reported apart so the route they took is visible.
  const payments: FirstPayment[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await admin
      .from('credit_grants')
      .select('user_id, kind, created_at')
      .in('kind', ['topup', 'plan'])
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[churn] credit_grants read failed:', error.message);
      break;
    }
    const rows = (data ?? []) as { user_id: string; kind: string; created_at: string | null }[];
    for (const row of rows) {
      if (!row.user_id || !row.created_at) continue;
      payments.push({ userId: row.user_id, at: row.created_at, route: row.kind === 'plan' ? 'plan' : 'topup' });
    }
    if (rows.length < PAGE) break;
  }

  return { signups, payments };
}
