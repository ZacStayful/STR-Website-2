/**
 * Writing to the subscription_events log.
 *
 * Kept apart from the churn maths so it can be called from the Stripe webhook
 * deps and from the /account server actions alike, and kept free of a
 * `server-only` import so the churn tests can reach the types. The Supabase
 * client is passed in — structurally typed for the one call this makes, rather
 * than imported, for the same reason.
 */

import type { SubEventKind } from './churn.ts';

export type { SubEventKind };

export type SubEventSource = 'self_serve' | 'portal' | 'stripe' | 'manual' | 'backfill';

export interface SubscriptionEventInput {
  userId: string;
  kind: SubEventKind;
  at?: string;
  cycleStartedAt?: string | null;
  planCode?: string | null;
  mrrPence?: number | null;
  reason?: string | null;
  reasonComment?: string | null;
  source?: SubEventSource;
  stripeSubscriptionId?: string | null;
  stripeEventId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Just enough of the Supabase client to insert a row. */
export interface EventWriter {
  from(table: string): {
    insert(values: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }>;
  };
}

/** PostgREST's code for a unique-constraint violation. */
const DUPLICATE = '23505';

function row(input: SubscriptionEventInput): Record<string, unknown> {
  return {
    user_id: input.userId,
    at: input.at ?? new Date().toISOString(),
    kind: input.kind,
    cycle_started_at: input.cycleStartedAt ?? null,
    plan_code: input.planCode ?? null,
    mrr_pence: input.mrrPence ?? null,
    reason: input.reason ?? null,
    reason_comment: input.reasonComment ?? null,
    source: input.source ?? 'stripe',
    stripe_subscription_id: input.stripeSubscriptionId ?? null,
    stripe_event_id: input.stripeEventId ?? null,
    metadata: input.metadata ?? {},
  };
}

/**
 * Append one event. Never throws.
 *
 * The churn log is a reporting side-effect, and a failed insert must not take
 * down the thing that produced it: the Stripe route records the event id BEFORE
 * handling, so a throw here would leave the delivery claimed-but-unprocessed
 * and have Stripe retry the whole handler — re-running the profile write and
 * the grant expiry to save a log row. Not a trade worth making.
 *
 * A duplicate is the unique index doing its job on a replayed delivery, so it
 * is silent rather than logged.
 */
export async function recordSubscriptionEvent(client: EventWriter, input: SubscriptionEventInput): Promise<boolean> {
  try {
    const { error } = await client.from('subscription_events').insert(row(input));
    if (!error) return true;
    if (error.code === DUPLICATE) return false;
    console.error('[billing] subscription_events insert failed:', error.message);
    return false;
  } catch (err) {
    console.error('[billing] subscription_events insert threw:', err);
    return false;
  }
}
