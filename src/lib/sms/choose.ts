/**
 * Who gets a text now, and what it says: one member at a time, as rules.
 *
 * A member gets a text when ALL of these hold:
 *   - a verified UK mobile, texts switched on, and no STOP
 *   - today's text slot unused (Batch 6's notification_sends, channel 'sms')
 *   - fewer texts this UK month than the monthly cap
 *   - at least one change on a tracked deal (Batch 6's settled, pending
 *     alerts: still true now, not on a Passed or Secured deal) that
 *     · is of a kind they have switched on,
 *     · was recorded in the last 24 hours (older news waits for the email),
 *     · and has never been texted to them before.
 *
 * Every qualifying change goes into the ONE text, most important first:
 * price drops on deals at Offer, then at Viewing or Contacted, then back on
 * the market and gone on those, then the same on deals they only kept, and
 * "getting attention" last. The text does not close the alerts: the daily
 * email still carries them (texts and emails are independent).
 *
 * Pure: no network, no database, no server-only.
 */
import type { AlertType, ChangeInput } from '../notify/message.ts';
import type { NotificationState, SmsNotificationKey } from '../notifications/registry.ts';
import { isUkMobile } from './phone.ts';
import { renderSmsText } from './render.ts';

/** Which switch each kind of change needs. */
export const SMS_SWITCH_FOR: Readonly<Record<AlertType, SmsNotificationKey>> = {
  price_drop: 'sms_price_drop',
  back_on_market: 'sms_back_on_market',
  nearly_gone: 'sms_nearly_gone',
  gone: 'sms_gone',
};

/** A change recorded longer ago than this is left to the email. */
export const TEXT_FRESH_MS = 24 * 60 * 60 * 1000;

/** How far back "already texted" is read. Longer than Batch 6 keeps an alert pending (14 days). */
export const TEXTED_LOOKBACK_MS = 15 * 24 * 60 * 60 * 1000;

export interface ContactState {
  phone_e164: string | null;
  verified_at: string | null;
  enabled: boolean;
  stopped_at: string | null;
}

/** Verified, on, not stopped, and a UK mobile. */
export function contactCanReceive(c: ContactState | null | undefined): c is ContactState & { phone_e164: string } {
  return Boolean(c && c.verified_at && c.enabled && !c.stopped_at && isUkMobile(c.phone_e164));
}

const ACTIVE_STAGES: ReadonlySet<string> = new Set(['offer', 'viewing', 'contacted']);

/** Lower is more important. */
export function textPriority(c: Pick<ChangeInput, 'alertType' | 'stage'>): number {
  const stage = c.stage ?? 'watching';
  const active = ACTIVE_STAGES.has(stage);
  switch (c.alertType) {
    case 'price_drop':
      return stage === 'offer' ? 0 : active ? 1 : 4;
    case 'back_on_market':
      return active ? 2 : 5;
    case 'gone':
      return active ? 3 : 6;
    case 'nearly_gone':
      return active ? 7 : 8;
  }
}

const drop = (c: Pick<ChangeInput, 'oldAmount' | 'newAmount'>) =>
  typeof c.oldAmount === 'number' && typeof c.newAmount === 'number' ? c.oldAmount - c.newAmount : 0;

/** Most important first; then the bigger price drop; then the newest. */
export function orderForText<C extends ChangeInput>(changes: readonly C[], createdAt: ReadonlyMap<string, number>): C[] {
  return [...changes].sort((a, b) => textPriority(a) - textPriority(b) || drop(b) - drop(a) || (createdAt.get(b.id) ?? 0) - (createdAt.get(a.id) ?? 0));
}

export interface MemberPlanInput {
  contact: ContactState | null;
  /** The member's switches; null when they could not be read (then nothing is sent). */
  switches: NotificationState | null;
  /** Batch 6's settled pending changes for this member. */
  changes: readonly (ChangeInput & { mergedIds?: string[] })[];
  /** deal_alerts.created_at (ms) by alert id. */
  createdAt: ReadonlyMap<string, number>;
  /** Alert ids already texted to this member. */
  texted: ReadonlySet<string>;
  slotUsedToday: boolean;
  sentThisMonth: number;
  monthlyCap: number;
  link: string;
  now: Date;
}

export type SkipReason = 'not_receiving' | 'slot_used' | 'monthly_cap' | 'nothing_new' | 'unrenderable';

export type MemberPlan =
  | { send: true; body: string; alertIds: string[]; described: number; counted: number }
  | { send: false; reason: SkipReason };

export function planMemberText(input: MemberPlanInput): MemberPlan {
  if (!contactCanReceive(input.contact)) return { send: false, reason: 'not_receiving' };
  if (input.slotUsedToday) return { send: false, reason: 'slot_used' };
  if (input.sentThisMonth >= input.monthlyCap) return { send: false, reason: 'monthly_cap' };
  const switches = input.switches;
  if (!switches) return { send: false, reason: 'not_receiving' };

  const now = input.now.getTime();
  const eligible = input.changes.filter((c) => {
    if (switches[SMS_SWITCH_FOR[c.alertType]] !== true) return false;
    if (input.texted.has(c.id)) return false;
    const at = input.createdAt.get(c.id);
    return typeof at === 'number' && now - at <= TEXT_FRESH_MS && at <= now;
  });
  if (eligible.length === 0) return { send: false, reason: 'nothing_new' };

  const rendered = renderSmsText(orderForText(eligible, input.createdAt), input.link);
  if (!rendered) return { send: false, reason: 'unrenderable' };
  const alertIds = [...new Set(rendered.counted.flatMap((c) => [c.id, ...((c as { mergedIds?: string[] }).mergedIds ?? [])]))];
  return { send: true, body: rendered.body, alertIds, described: rendered.described.length, counted: rendered.counted.length };
}
