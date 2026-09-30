import 'server-only';

import { createAdminClient, hasServiceRole } from '../../supabase/admin';

/**
 * Batch 20, Part F: an event that changes a member's Monday row (a payment, a
 * plan change, low credit, coming back...) never talks to Monday itself. It
 * queues the member (public.monday_funnel_enqueue: one row per member, so a
 * burst of events is one update) and /api/internal/monday-funnel drains the
 * queue every 10 minutes in the background. So nothing Monday-related can
 * slow a page, a sign-up, a payment or a webhook, and a Monday outage is a
 * retry, not a lost update.
 *
 * Never throws or rejects; a failure is a warning (one a minute per message).
 */

const warnedAt = new Map<string, number>();
function warn(message: string): void {
  const now = Date.now();
  if (now - (warnedAt.get(message) ?? 0) < 60_000) return;
  warnedAt.set(message, now);
  console.warn('[monday-funnel] not queued:', message);
}

export type FunnelReason =
  | 'signup'
  | 'starter_pack'
  | 'topup'
  | 'plan'
  | 'payment_failed'
  | 'refund'
  | 'hit_zero'
  | 'low_credit'
  | 'next_deal'
  | 'came_back'
  | 'inactive';

export async function queueFunnelSync(userId: string | null | undefined, reason: FunnelReason): Promise<void> {
  if (!userId || !hasServiceRole()) return;
  try {
    const { error } = await createAdminClient().rpc('monday_funnel_enqueue', { p: { user: userId, reason } });
    if (error) warn(error.message);
  } catch (err) {
    warn(err instanceof Error ? err.message : String(err));
  }
}
