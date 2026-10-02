import 'server-only';

/**
 * Batch 23: every charge a call makes, through the existing credit ledger
 * (no second charging path):
 *   answered minutes   the si:call_minute unit row (raw × markup, 65p a minute), per second
 *   each text          si_text_pence (22p)
 *   a fallback email   si_email_pence (20p)
 * Unanswered calls, voicemail, failures and unknown callers are never
 * charged: callers check status and member before calling these.
 *
 * Each charge first inserts its guard row (si_call_charges.charge_key,
 * unique), so a webhook redelivery or a retried tool call never charges
 * twice. The debit is debitFace — exactly the displayed price, whatever
 * credit pays it — capped at the member's balance, so a call never takes
 * the balance below zero (the rest is absorbed as house spend).
 * Raw cost is logged to provider_calls for /admin/billing's reconciliation.
 */
import { createAdminClient } from '../supabase/admin';
import { debitFace, getBalance, InsufficientCreditError } from '../credit/ledger';
import { getBillingSettings, getUnitCostTable } from '../credit/unit-costs';
import { priceFor } from '../credit/pricing';
import { isAdminEmail } from '../admin';
import { payerFor } from '../team';
import { CALL_ACTION, CALL_MINUTE_UNIT } from './config';
import { capToBalance, minutesChargePence } from './charge';

type Admin = ReturnType<typeof createAdminClient>;

export interface ChargeResult {
  charged: number;
  duplicate: boolean;
}

/** The per-minute price members pay (displayed pence), from the unit row. */
export async function callPencePerMinute(): Promise<number> {
  const table = await getUnitCostTable();
  return priceFor(table, CALL_MINUTE_UNIT.provider, CALL_MINUTE_UNIT.unit, 1).basePence;
}

async function isAdminAccount(admin: Admin, userId: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('email').eq('id', userId).maybeSingle();
  return isAdminEmail((data as { email: string | null } | null)?.email ?? null);
}

interface ChargeSpec {
  key: string;
  callId: string | null;
  userId: string;
  kind: 'minutes' | 'text' | 'email';
  quantity: number;
  pricePence: number;
  description: string;
  rawPence: number;
  unit: { provider: string; unit: string };
}

/**
 * Claim a charge's guard row: its id the first time, null when the key was
 * already used (a redelivery: do nothing) or the guard could not be written
 * (do nothing either — never send or charge on a guess).
 */
export async function claimCharge(key: string, callId: string | null, userId: string, kind: ChargeSpec['kind']): Promise<string | null> {
  const { data, error } = await createAdminClient().from('si_call_charges').insert({ charge_key: key, call_id: callId, user_id: userId, kind, charged_pence: 0 }).select('id').single();
  if (error) {
    if (error.code !== '23505') console.error('[voice] charge guard failed:', error.message);
    return null;
  }
  return String((data as { id: string }).id);
}

/** Give a claim back when the thing it paid for never happened (a text Twilio refused). */
export async function releaseCharge(guardId: string): Promise<void> {
  const { error } = await createAdminClient().from('si_call_charges').delete().eq('id', guardId).eq('charged_pence', 0).is('transaction_id', null);
  if (error) console.error('[voice] charge release failed:', error.message);
}

/** Take the price for a claimed guard, capped at the balance. A team member's usage is paid by their owner. */
async function settle(admin: Admin, guardId: string, spec: ChargeSpec): Promise<number> {
  await admin.from('si_call_charges').update({ quantity: spec.quantity }).eq('id', guardId);
  const payer = await payerFor(spec.userId);
  if (payer.suspended) return 0;
  const o: ChargeSpec = { ...spec, userId: payer.payerId };
  // Admin accounts are never charged (the same rule as metered usage).
  if (o.pricePence <= 0 || (await isAdminAccount(admin, o.userId))) return 0;
  let charged = 0;
  let txId: number | null = null;
  for (let attempt = 0; attempt < 2 && txId === null; attempt++) {
    const balance = await getBalance(o.userId).catch(() => null);
    charged = capToBalance(o.pricePence, balance?.totalPence ?? 0);
    if (charged <= 0) break;
    try {
      txId = await debitFace(o.userId, charged, {
        action_id: guardId,
        action: CALL_ACTION,
        provider: o.unit.provider,
        unit: o.unit.unit,
        quantity: o.quantity,
        raw_cost_pence: o.rawPence,
        description: o.description,
        ...(charged < o.pricePence ? { capped_from_pence: o.pricePence } : {}),
      });
    } catch (err) {
      // The balance moved between the read and the debit: read it again once.
      if (!(err instanceof InsufficientCreditError)) {
        console.error('[voice] debit failed:', err);
        break;
      }
    }
  }
  if (txId === null) charged = 0;
  await admin.from('si_call_charges').update({ charged_pence: charged, transaction_id: txId }).eq('id', guardId);
  if (o.callId) await refreshCallCharged(admin, o.callId);
  // Raw cost for /admin/billing (provider_calls is where unit rows reconcile).
  // Texts' raw cost is already there (sendSms meters it as house spend).
  if (o.rawPence <= 0) {
    if (charged > 0) void import('../credit/after-debit').then((m) => m.afterDebit(o.userId)).catch(() => {});
    return charged;
  }
  const { error } = await admin.from('provider_calls').insert({
    provider: o.unit.provider, question: `si.${o.kind}`, key: o.key, cost_pence: Math.round(o.rawPence), raw_pence: Math.round(o.rawPence * 10_000) / 10_000,
    user_id: o.userId, billed_user_id: o.userId, ok: true, unit: o.unit.unit, quantity: o.quantity, base_pence: o.pricePence, charged_pence: charged, action_id: guardId, bypass: false,
  });
  if (error) console.error('[voice] provider_calls insert failed:', error.message);
  if (charged > 0) void import('../credit/after-debit').then((m) => m.afterDebit(o.userId)).catch(() => {});
  return charged;
}

/** si_calls_log.charged_pence: everything the call charged (minutes, texts, the fallback email). */
async function refreshCallCharged(admin: Admin, callId: string): Promise<void> {
  const { data, error } = await admin.from('si_call_charges').select('charged_pence').eq('call_id', callId);
  if (error) return;
  const total = ((data ?? []) as { charged_pence: number }[]).reduce((n, r) => n + (Number(r.charged_pence) || 0), 0);
  await admin.from('si_calls_log').update({ charged_pence: total }).eq('id', callId);
}

/** Claim and settle in one go (minutes and emails: the thing has already happened). */
async function chargeOnce(admin: Admin, o: ChargeSpec): Promise<ChargeResult> {
  const guardId = await claimCharge(o.key, o.callId, o.userId, o.kind);
  if (!guardId) return { charged: 0, duplicate: true };
  return { charged: await settle(admin, guardId, o), duplicate: false };
}

/** Answered seconds, at the unit row's per-minute price. */
export async function chargeCallMinutes(callId: string, userId: string, seconds: number): Promise<ChargeResult> {
  const admin = createAdminClient();
  const table = await getUnitCostTable();
  const perMin = priceFor(table, CALL_MINUTE_UNIT.provider, CALL_MINUTE_UNIT.unit, 1);
  const price = minutesChargePence(seconds, perMin.basePence);
  return chargeOnce(admin, { key: `call:${callId}:minutes`, callId, userId, kind: 'minutes', quantity: Math.round((seconds / 60) * 10_000) / 10_000, pricePence: price, description: 'Call from Stayful Intelligence', rawPence: (perMin.rawPence * seconds) / 60, unit: CALL_MINUTE_UNIT });
}

/**
 * Charge a text that was sent under a claimed guard (claimCharge first, then
 * send, then this; releaseCharge if the send never happened). The text's raw
 * cost is already logged by sendSms as house spend, so none is logged here.
 */
export async function settleText(guardId: string, key: string, callId: string | null, userId: string): Promise<number> {
  const settings = await getBillingSettings();
  return settle(createAdminClient(), guardId, { key, callId, userId, kind: 'text', quantity: 1, pricePence: settings.intelligence.siTextPence, description: 'Text from Stayful Intelligence', rawPence: 0, unit: { provider: 'si', unit: 'text' } });
}

/** Charge an email sent under a claimed guard (flat si_email_pence). */
export async function settleEmail(guardId: string, key: string, callId: string | null, userId: string): Promise<number> {
  const settings = await getBillingSettings();
  return settle(createAdminClient(), guardId, { key, callId, userId, kind: 'email', quantity: 1, pricePence: settings.intelligence.siEmailPence, description: 'Email from Stayful Intelligence', rawPence: 0, unit: { provider: 'si', unit: 'email' } });
}
