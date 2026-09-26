import 'server-only';

/**
 * The text alerts run (/api/internal/sms-alerts, every 15 minutes).
 *
 * For every member who can receive texts, it reads their changes on tracked
 * deals from Batch 6 (the same settled, pending alerts the daily email
 * reads), decides with ./choose.ts whether a text is due and what it says,
 * and sends at most one, through Batch 6's send record:
 *
 *   claimSlot(channel 'sms')  one text per member per day; two runs can never both win
 *   markSending               about to call Twilio
 *   finishSend(no alerts)     sent (or maybe sent) / failed. The alerts are NOT
 *                             closed: the daily email still carries them.
 *
 * sms_messages records every text with the alert ids it counted, so an alert
 * is never texted twice, and Twilio's sid, status and price for the bill.
 *
 * Refuses to run outside 08:00–20:00 UK time. Sends nothing unless
 * SMS_ALERTS_ENABLED=true and Twilio is configured. A dry run (?dry=1, or
 * SMS_DRY_RUN=true) does everything except claim, record and send, and
 * returns the texts it would have sent.
 */
import { createAdminClient } from '../supabase/admin';
import { pendingChanges } from '../notify/alerts-server';
import { claimSlot, finishSend, markSending, releaseClaim, slotsInUse } from '../notify/sends';
import { siteUrl } from '../url';
import { isSmsConfigured, isSmsDryRun, smsAlertsEnabled, twilioConfig } from './config';
import { contactCanReceive, planMemberText, TEXTED_LOOKBACK_MS } from './choose';
import { maskPhone } from './phone';
import { myDealsLink } from './render';
import { sendSms } from './send';
import {
  alertCreatedAt, getContact, insertMessage, receivingContacts, smsMonthlyCap, smsSwitchesFor, stopNumber, textedAlertIds, textsThisMonth, unpricedMessages, updateMessage,
} from './store';
import { basicAuth, messageUrl, parseMessagePrice } from './twilio';
import { inSendingWindow, londonMonthStart } from './uk-time';

/** Stop starting members here; the route's limit is 60 s. */
const TIME_BUDGET_MS = 45_000;
const PRICE_BACKFILL_PER_RUN = 25;

export interface RunResult {
  status: number;
  body: Record<string, unknown>;
}

interface PerMember {
  user: string;
  sent: boolean;
  reason?: string;
  body?: string;
  alerts?: number;
}

export async function runSmsAlerts(opts: { dry: boolean; onlyUserIds?: string[]; ignoreWindow?: boolean; now?: Date }): Promise<RunResult> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const dry = opts.dry || isSmsDryRun();

  if (!dry && !smsAlertsEnabled()) return { status: 200, body: { enabled: false, reason: "SMS_ALERTS_ENABLED is not 'true'" } };
  if (!inSendingWindow(now) && !(dry && opts.ignoreWindow)) return { status: 200, body: { dry, skipped: 'quiet_hours', note: 'Texts only go 08:00–20:00 UK time.' } };
  if (!dry && !isSmsConfigured()) {
    console.warn('[sms] alerts run skipped: Twilio is not configured');
    return { status: 200, body: { skipped: 'not_configured' } };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: 503, body: { error: 'Storage not configured' } };
  }

  // ── Who can receive texts at all ──
  const contacts = await receivingContacts(admin, opts.onlyUserIds);
  if (contacts === null) return { status: 503, body: { error: 'sms_contacts unreadable (schema behind?); nothing sent' } };
  const summary = { dry, considered: contacts.length, sent: 0, failed: 0, maybeSent: 0, ranOutOfTime: false, windowClosed: false, priced: 0 };
  const members: PerMember[] = [];
  if (contacts.length === 0) return { status: 200, body: { ...summary, members } };
  const ids = contacts.map((c) => c.user_id);

  // ── Everything the decision needs, one query per table ──
  const [switches, pending, texted, slots, monthly, cap] = await Promise.all([
    smsSwitchesFor(admin, ids),
    pendingChanges(admin, ids, now),
    textedAlertIds(admin, ids, TEXTED_LOOKBACK_MS, now),
    slotsInUse(admin, ids, 'daily', now, 'sms'),
    textsThisMonth(admin, ids, londonMonthStart(now)),
    smsMonthlyCap(admin),
  ]);
  // Any of these unreadable means we cannot know it is safe to text: send nothing.
  if (!switches || !texted || !monthly || (!slots && !dry)) {
    return { status: 503, body: { error: 'a Batch 6 / Batch 8 table is unreadable (schema behind?); nothing sent', switches: Boolean(switches), texted: Boolean(texted), monthly: Boolean(monthly), slots: Boolean(slots) } };
  }
  const allAlertIds = [...pending.values()].flatMap((s) => s.changes.map((c) => c.id));
  const createdAt = await alertCreatedAt(admin, allAlertIds);
  const link = myDealsLink(siteUrl());

  for (const contact of contacts) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      break;
    }
    // A run that starts at 19:59 must not send at 20:00: the clock, not the start time, decides each text.
    if (!dry && !inSendingWindow(new Date())) {
      summary.windowClosed = true;
      break;
    }
    const userId = contact.user_id;
    const plan = planMemberText({
      contact,
      switches: switches.get(userId) ?? null,
      changes: pending.get(userId)?.changes ?? [],
      createdAt,
      texted: texted.get(userId) ?? new Set(),
      slotUsedToday: slots?.has(userId) ?? false,
      sentThisMonth: monthly.get(userId) ?? 0,
      monthlyCap: cap,
      link,
      now,
    });
    if (!plan.send) {
      if (plan.reason !== 'nothing_new') members.push({ user: userId, sent: false, reason: plan.reason });
      continue;
    }
    if (dry) {
      // Logged the way a real send is, so a dry run in the logs reads like the real thing.
      await sendSms({ to: contact.phone_e164!, body: plan.body, purpose: 'alert', dryRun: true });
      members.push({ user: userId, sent: false, reason: 'dry_run', body: plan.body, alerts: plan.alertIds.length });
      continue;
    }

    // ── Just before sending: the contact again (a STOP may have landed seconds ago) ──
    const fresh = await getContact(admin, userId);
    if (!contactCanReceive(fresh) || fresh.phone_e164 !== contact.phone_e164) {
      members.push({ user: userId, sent: false, reason: 'contact_changed' });
      continue;
    }

    const claim = await claimSlot(admin, userId, 'deal_changes', now, 'sms');
    if (!claim.ok) {
      members.push({ user: userId, sent: false, reason: claim.reason });
      continue;
    }
    const messageId = await insertMessage(admin, {
      user_id: userId,
      direction: 'outbound',
      kind: 'alert',
      phone_e164: fresh.phone_e164,
      body: plan.body,
      alert_ids: plan.alertIds,
      send_id: claim.id,
      outcome: 'pending',
    });
    if (!messageId) {
      await releaseClaim(admin, claim.id);
      members.push({ user: userId, sent: false, reason: 'record_failed' });
      continue;
    }
    const sendSummary = { message_id: messageId, alert_ids: plan.alertIds, described: plan.described };
    if (!(await markSending(admin, claim.id, sendSummary, null))) {
      // The slot could not be marked: do not send (it may be taken over later), and never leave the text looking sent.
      await updateMessage(admin, messageId, { outcome: 'refused' });
      await releaseClaim(admin, claim.id);
      members.push({ user: userId, sent: false, reason: 'slot_unmarked' });
      continue;
    }

    const result = await sendSms({ to: fresh.phone_e164, body: plan.body, purpose: 'alert', messageId, statusCallback: siteUrl(`/api/twilio/status?m=${messageId}`) });
    const outcome = result.sent ? 'accepted' : result.reason === 'unknown' ? 'unknown' : 'refused';
    await updateMessage(admin, messageId, { outcome, twilio_sid: result.sid ?? null, status: result.status ?? null, segments: result.segments ?? null, error_code: result.errorCode ?? null });
    // "unknown" may well have gone: it counts as sent (the day's slot and the month's cap).
    const counted = result.sent || result.reason === 'unknown';
    await finishSend(admin, claim.id, counted, { ...sendSummary, outcome }, []);
    if (result.reason === 'opted_out') await stopNumber(admin, fresh.phone_e164, 'twilio', now);

    if (result.sent) summary.sent += 1;
    else if (result.reason === 'unknown') summary.maybeSent += 1;
    else {
      summary.failed += 1;
      console.warn(`[sms] alert text to ${maskPhone(fresh.phone_e164)} not sent: ${result.reason}`);
    }
    members.push({ user: userId, sent: result.sent, reason: result.sent ? undefined : result.reason, alerts: plan.alertIds.length });
  }

  if (!dry) summary.priced = await backfillPrices(admin, started, now);
  return { status: 200, body: { ...summary, members } };
}

/** Twilio's price for recent texts, for reconciliation. Best effort, inside the run's time budget. */
async function backfillPrices(admin: ReturnType<typeof createAdminClient>, started: number, now: Date): Promise<number> {
  const config = twilioConfig();
  if (!config) return 0;
  let priced = 0;
  for (const row of await unpricedMessages(admin, PRICE_BACKFILL_PER_RUN, now)) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      const res = await fetch(messageUrl(config.accountSid, row.twilio_sid), { headers: { Authorization: basicAuth(config.accountSid, config.authToken), Accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
      if (!res.ok) continue;
      const { price, priceUnit, segments } = parseMessagePrice(await res.json());
      if (price === null) continue;
      if (await updateMessage(admin, row.id, { price, price_unit: priceUnit, ...(segments !== null ? { segments } : {}) })) priced += 1;
    } catch (err) {
      console.warn('[sms] price lookup failed:', err);
    }
  }
  return priced;
}
