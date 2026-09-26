import 'server-only';

/**
 * The cap, enforced: every capped member email claims its slot here first,
 * and closes it here after. The rules are in ./cap.ts; the record is
 * notification_sends (supabase/schema.sql, "Batch 6").
 *
 *   claimSlot     the slot is yours, or `slot_used`. Two passes, two crons
 *                 or a retry can never both win it (one INSERT decides).
 *   releaseClaim  you stopped before sending (nothing suitable, a render
 *                 error, out of time): give the slot back so a later run
 *                 (the 08:10 daily digest) can still use it.
 *   markSending   about to call Resend. From here the row is never taken
 *                 over, because the email may have gone.
 *   finishSend    sent or failed, and — only if sent — the alerts it carried
 *                 marked notified, in one transaction. An alert in a failed
 *                 email stays pending and rides the next one.
 *
 * Billing and receipt emails never come here.
 */
import type { createAdminClient } from '../supabase/admin';
import { capDay, slotAllowed, slotFor, type SendKind, type Slot } from './cap';

type Admin = ReturnType<typeof createAdminClient>;

export type Claim =
  | { ok: true; id: string; slot: Slot; day: string }
  | { ok: false; reason: 'slot_used' | 'slot_not_today' | 'unavailable' };

const ID_CHUNK = 150;
/** Matches claim_notification_slot's p_stale_after default. */
const STALE_CLAIM_MS = 5 * 60 * 1000;

export async function claimSlot(admin: Admin, userId: string, kind: SendKind, now: Date = new Date(), channel = 'email'): Promise<Claim> {
  const slot = slotFor(kind);
  if (!slotAllowed(slot, now)) return { ok: false, reason: 'slot_not_today' };
  const day = capDay(now);
  const { data, error } = await admin.rpc('claim_notification_slot', { p_user: userId, p_day: day, p_slot: slot, p_kind: kind, p_channel: channel });
  if (error) {
    // The schema has not been run, or the database is down. The caller
    // decides: a new email stays unsent; the daily pick goes as it always has.
    console.error('[notify] claim failed (schema behind?):', error.message);
    return { ok: false, reason: 'unavailable' };
  }
  if (!data) return { ok: false, reason: 'slot_used' };
  return { ok: true, id: String(data), slot, day };
}

/** Give back a claim that never reached Resend. A row already sending or closed is left alone. */
export async function releaseClaim(admin: Admin, id: string): Promise<void> {
  const { error } = await admin.from('notification_sends').delete().eq('id', id).eq('status', 'claimed');
  if (error) console.error('[notify] release failed:', error.message);
}

/**
 * About to send: what is going out (never an address) and the email's
 * unsubscribe token. Returns false when the row could not be written: the
 * slot then stays takeable after five minutes, so the caller either does not
 * send, or sends with the slot's idempotency key (cap.ts sendKey) — every
 * capped sender does — which makes Resend refuse any second, different email
 * in the same slot.
 */
export async function markSending(admin: Admin, id: string, summary: Record<string, unknown>, unsubscribeToken: string | null): Promise<boolean> {
  const { data, error } = await admin
    .from('notification_sends')
    .update({ status: 'sending', sending_at: new Date().toISOString(), summary, unsubscribe_token: unsubscribeToken })
    .eq('id', id)
    .eq('status', 'claimed')
    .select('id');
  if (error) console.error('[notify] mark sending failed:', error.message);
  return !error && Array.isArray(data) && data.length === 1;
}

export async function finishSend(admin: Admin, id: string, sent: boolean, summary: Record<string, unknown> | null, alertIds: readonly string[]): Promise<boolean> {
  const { error } = await admin.rpc('finish_notification_send', { p_id: id, p_sent: sent, p_summary: summary, p_alert_ids: alertIds.length > 0 ? [...alertIds] : null });
  if (error) console.error('[notify] finish failed:', error.message);
  return !error;
}

export interface SlotUse {
  kind: string;
  status: string;
}

/**
 * Which of these members have already used (or hold) the slot today. Read
 * once before a run's loop, so a member whose day is spent is skipped before
 * any work is done for them. A read that fails returns null: the caller then
 * relies on the claim itself, which is the real guard.
 */
export async function slotsInUse(admin: Admin, userIds: readonly string[], slot: Slot, now: Date = new Date(), channel = 'email'): Promise<Map<string, SlotUse> | null> {
  const out = new Map<string, SlotUse>();
  const day = capDay(now);
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const { data, error } = await admin
      .from('notification_sends')
      .select('user_id, kind, status, claimed_at')
      .eq('day', day)
      .eq('slot', slot)
      .eq('channel', channel)
      .in('user_id', userIds.slice(i, i + ID_CHUNK));
    if (error) {
      console.warn('[notify] slot read failed (schema behind?):', error.message);
      return null;
    }
    for (const r of (data ?? []) as { user_id: string; kind: string; status: string; claimed_at: string }[]) {
      // A stale claim that never reached Resend is takeable (claim_notification_slot), so it is not "in use".
      if (r.status === 'claimed' && now.getTime() - Date.parse(r.claimed_at) > STALE_CLAIM_MS) continue;
      out.set(r.user_id, { kind: r.kind, status: r.status });
    }
  }
  return out;
}

/** The send an unsubscribe token belongs to. */
export async function sendByToken(admin: Admin, token: string): Promise<{ id: string; userId: string; kind: SendKind } | null> {
  const { data, error } = await admin.from('notification_sends').select('id, user_id, kind').eq('unsubscribe_token', token).maybeSingle();
  if (error) console.error('[notify] token read failed:', error.message);
  const row = data as { id: string; user_id: string; kind: SendKind } | null;
  return row ? { id: row.id, userId: row.user_id, kind: row.kind } : null;
}
