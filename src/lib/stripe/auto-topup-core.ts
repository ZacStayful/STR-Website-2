/**
 * Opt-in auto top-up, as a rule over injected dependencies so it runs under
 * `node --test`: when a debit leaves the balance below the member's
 * threshold, charge their saved card for their chosen amount. At most one
 * attempt per ten minutes per member (a claim on auto_topup_last_at, so two
 * concurrent debits cannot double-charge); a decline switches the setting off
 * and emails them. The live wiring is in auto-topup.ts.
 *
 * The receipt: grantTopup is always given the member's email, which is what
 * makes it send one (the review's G19 pinned this by reading the source;
 * auto-topup.test.ts now asserts it by running the rule).
 */

export const AUTO_TOPUP_COOLDOWN_MS = 10 * 60 * 1000;

export interface AutoTopupProfile {
  email: string | null;
  stripe_customer_id: string | null;
  stripe_default_payment_method_id: string | null;
  auto_topup_amount_pence: number | null;
  auto_topup_threshold_pence: number | null;
  auto_topup_last_at: string | null;
}

/** What the rule needs of a PaymentIntent; the live deps hand the whole Stripe object through. */
export interface AutoTopupIntent {
  id: string;
  status: string;
}

export interface AutoTopupDeps<PI extends AutoTopupIntent = AutoTopupIntent> {
  /** Stripe is configured at all. */
  configured(): boolean;
  profile(userId: string): Promise<AutoTopupProfile | null>;
  spendableBasePence(userId: string): Promise<number>;
  /** Stamp auto_topup_last_at = nowIso where it is null or before cutoffIso; true when this call won the slot. */
  claim(userId: string, nowIso: string, cutoffIso: string): Promise<boolean>;
  /** Create and confirm the off-session PaymentIntent under the idempotency key. */
  charge(p: { userId: string; amountPence: number; customerId: string; paymentMethodId: string; idempotencyKey: string }): Promise<PI>;
  /** The credit grant; with the email so the receipt goes. */
  grantTopup(userId: string, amountPence: number, sourceRef: string, opts: { email: string | null }): Promise<unknown>;
  /** After a successful charge: Total paid and the activity log. */
  recordCharge(userId: string, intent: PI, amountPence: number): Promise<void>;
  /** A decline switches auto top-up off. */
  switchOff(userId: string): Promise<void>;
  cardNeedsUpdate(email: string): Promise<unknown>;
  now(): Date;
  defaultThresholdPence: number;
}

export async function runAutoTopup<PI extends AutoTopupIntent>(userId: string, d: AutoTopupDeps<PI>): Promise<'charged' | 'skipped' | 'failed'> {
  if (!d.configured()) return 'skipped';
  const p = await d.profile(userId);
  if (!p || !p.auto_topup_amount_pence || !p.stripe_default_payment_method_id || !p.stripe_customer_id) return 'skipped';
  const nowMs = d.now().getTime();
  const last = p.auto_topup_last_at ? new Date(String(p.auto_topup_last_at)).getTime() : 0;
  if (nowMs - last < AUTO_TOPUP_COOLDOWN_MS) return 'skipped';
  if ((await d.spendableBasePence(userId)) >= Number(p.auto_topup_threshold_pence ?? d.defaultThresholdPence)) return 'skipped';

  // Claim the slot before charging so two concurrent debits can't double-charge.
  const now = new Date(nowMs).toISOString();
  if (!(await d.claim(userId, now, new Date(nowMs - AUTO_TOPUP_COOLDOWN_MS).toISOString()))) return 'skipped';

  const amount = Number(p.auto_topup_amount_pence);
  try {
    const pi = await d.charge({
      userId,
      amountPence: amount,
      customerId: String(p.stripe_customer_id),
      paymentMethodId: String(p.stripe_default_payment_method_id),
      idempotencyKey: `autotopup:${userId}:${now.slice(0, 16)}`,
    });
    if (pi.status !== 'succeeded') throw new Error(`payment intent ${pi.status}`);
    await d.grantTopup(userId, amount, `pi:${pi.id}`, { email: (p.email as string | null) ?? null });
    await d.recordCharge(userId, pi, amount);
    return 'charged';
  } catch (err) {
    console.warn('[auto-topup] charge failed; switching off:', (err as Error).message);
    await d.switchOff(userId);
    if (p.email) await d.cardNeedsUpdate(String(p.email)).catch(() => {});
    return 'failed';
  }
}
