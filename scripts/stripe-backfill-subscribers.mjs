#!/usr/bin/env node
/**
 * Moves existing Pro subscribers (paid through the old Payment Link) onto the
 * credit model without any action from them:
 *   - reads each profile with a stripe_subscription_id
 *   - sets plan_code / stripe_price_id / current_period_end / default card /
 *     customer id from the live Stripe subscription
 *   - grants the CURRENT cycle's Pro credit with the same source_ref the
 *     webhook would use (inv:<latest invoice>), so the next renewal grants
 *     normally and a replayed event can never double-grant
 *   - tags the Stripe customer + subscription with user_id metadata
 *
 *   node scripts/stripe-backfill-subscribers.mjs            # dry run (prints the plan)
 *   node scripts/stripe-backfill-subscribers.mjs --apply    # write it
 *   node scripts/stripe-backfill-subscribers.mjs --apply --notify   # …and send the transition email
 *
 * Needs STRIPE_SECRET_KEY, STRIPE_PRICE_* (from stripe-setup), NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY and, for --notify, RESEND_API_KEY + EMAIL_FROM.
 */

import fs from 'node:fs';
import path from 'node:path';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const apply = process.argv.includes('--apply');
const notify = process.argv.includes('--notify');

const need = ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const k of need) if (!process.env[k]) { console.error(`${k} is not set`); process.exit(1); }

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PLAN_BY_PRICE = Object.fromEntries(
  [['starter', 'STRIPE_PRICE_STARTER'], ['pro', 'STRIPE_PRICE_PRO'], ['scale', 'STRIPE_PRICE_SCALE'], ['pro_annual', 'STRIPE_PRICE_PRO_ANNUAL']]
    .filter(([, k]) => process.env[k])
    .map(([code, k]) => [process.env[k], code]),
);
const CREDIT = { starter: 1900, pro: 5000, scale: 14000, pro_annual: 5000 };

async function sendTransitionEmail(to, firstName, creditPence, renewsAt) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return false;
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://stayful.co.uk').replace(/\/$/, '');
  const when = renewsAt ? new Date(renewsAt).toLocaleDateString('en-GB') : null;
  const text = `${firstName ? `Hi ${firstName},` : 'Hi,'}

We're moving Stayful to usage-based credit. Your Pro subscription stays exactly the same price, and from your next renewal it gives you £${(creditPence / 100).toFixed(2)} of credit every month instead of unlimited reports.

Every report shows what it will use before you run it (about £3.50 for a standard report, or £7.25 with the PMI second opinion), so you always know where you stand. If you ever need more, you can top up in one click or move to the Scale plan.

${when ? `Your next renewal is on ${when}. Until then nothing changes.` : 'Until your next renewal nothing changes.'}

See your billing page: ${site}/account/billing

Stayful`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject: 'A change to how your Stayful subscription works', text, html: `<pre style="font-family:inherit;white-space:pre-wrap">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>` }),
  });
  return res.ok;
}

(async () => {
  const { data: profiles, error } = await supabase.from('profiles').select('id, email, full_name, plan_code, stripe_customer_id, stripe_subscription_id').not('stripe_subscription_id', 'is', null);
  if (error) throw error;
  console.log(`${profiles.length} profile(s) with a Stripe subscription. Mode: ${apply ? 'APPLY' : 'dry run'}${notify ? ' + notify' : ''}\n`);

  for (const p of profiles) {
    let sub;
    try {
      sub = await stripe.subscriptions.retrieve(p.stripe_subscription_id, { expand: ['default_payment_method', 'latest_invoice', 'customer'] });
    } catch (err) {
      console.log(`- ${p.email}: subscription ${p.stripe_subscription_id} not found in Stripe (${err.message}); skipped`);
      continue;
    }
    const item = sub.items.data[0];
    const priceId = item?.price?.id ?? null;
    const planCode = PLAN_BY_PRICE[priceId] ?? null;
    const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
    const customer = typeof sub.customer === 'string' ? null : sub.customer;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    const pm = typeof sub.default_payment_method === 'string' ? sub.default_payment_method : sub.default_payment_method?.id ?? (customer && !customer.deleted ? (typeof customer.invoice_settings?.default_payment_method === 'string' ? customer.invoice_settings.default_payment_method : customer.invoice_settings?.default_payment_method?.id) : null) ?? null;
    const invoiceId = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id ?? null;
    const active = ['active', 'trialing', 'past_due'].includes(sub.status);

    console.log(`- ${p.email}: status=${sub.status} price=${priceId} → plan=${planCode ?? 'UNKNOWN'} periodEnd=${periodEnd?.toISOString().slice(0, 10) ?? '?'} card=${pm ? 'saved' : 'none'} invoice=${invoiceId ?? '?'}`);
    if (!planCode) {
      console.log('    ! price is not one of STRIPE_PRICE_*; run stripe-setup first or map this price. Skipped.');
      continue;
    }
    if (!active) {
      console.log('    subscription not active; profile marked free, no credit.');
      if (apply) await supabase.from('profiles').update({ plan: 'free', plan_code: null, stripe_subscription_status: sub.status }).eq('id', p.id);
      continue;
    }
    if (!apply) continue;

    const { error: upErr } = await supabase.from('profiles').update({
      plan: 'pro',
      plan_code: planCode,
      stripe_price_id: priceId,
      stripe_customer_id: customerId ?? p.stripe_customer_id,
      stripe_subscription_status: sub.status,
      stripe_default_payment_method_id: pm,
      current_period_end: periodEnd?.toISOString() ?? null,
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    }).eq('id', p.id);
    if (upErr) { console.log(`    ! profile update failed: ${upErr.message}`); continue; }

    const sourceRef = planCode === 'pro_annual' ? `annual:${sub.id}:${new Date().toISOString().slice(0, 7)}` : `inv:${invoiceId ?? sub.id}`;
    const expires = planCode === 'pro_annual' ? (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1); return periodEnd && d > periodEnd ? periodEnd : d; })() : periodEnd;
    const { data: grantId, error: gErr } = await supabase.rpc('credit_grant', { p_user: p.id, p_kind: 'plan', p_amount: CREDIT[planCode], p_expires_at: expires?.toISOString() ?? null, p_source_ref: sourceRef, p_description: 'Pro plan credit (transition)' });
    if (gErr) console.log(`    ! grant failed: ${gErr.message}`);
    else console.log(`    granted £${(CREDIT[planCode] / 100).toFixed(2)} (${sourceRef}) → ${grantId}`);

    try {
      if (customerId) await stripe.customers.update(customerId, { metadata: { user_id: p.id } });
      await stripe.subscriptions.update(sub.id, { metadata: { user_id: p.id, plan_code: planCode } });
    } catch (err) {
      console.log(`    (metadata tag failed: ${err.message})`);
    }

    if (notify && p.email) {
      const ok = await sendTransitionEmail(p.email, (p.full_name ?? '').split(/\s+/)[0] || null, CREDIT[planCode], periodEnd?.toISOString() ?? null);
      console.log(`    transition email: ${ok ? 'sent' : 'NOT sent (Resend not configured or failed)'}`);
    }
  }
  console.log(apply ? '\nDone.' : '\nDry run only. Re-run with --apply to write.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
