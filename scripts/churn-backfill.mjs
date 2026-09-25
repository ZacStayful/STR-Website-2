#!/usr/bin/env node
/**
 * Seeds public.subscription_events from whatever history Stripe still holds, so
 * the churn report is not blank on the day it ships.
 *
 * The existing stripe-backfill-subscribers.mjs cannot do this: it walks
 * PROFILES that already carry a stripe_subscription_id, and a member whose plan
 * was granted by hand has none. This walks Stripe instead, then matches back.
 *
 * For each subscription Stripe knows about:
 *   - a 'started' event at its start_date
 *   - an 'ended' event at ended_at / canceled_at, with the reason taken from
 *     cancellation_details.feedback (the only place a Stripe-portal cancel
 *     leaves one)
 *   - profiles.subscription_started_at filled in where it is null
 *
 * Plans granted by hand have no Stripe record at all, so they get a 'started'
 * at profiles.created_at with source 'manual' and no price. They count towards
 * retention and add nothing to revenue, which is the truth about them.
 *
 * Re-running is safe: every row carries a deterministic stripe_event_id of
 * backfill:<subId>:<kind>, which the unique index dedupes on.
 *
 *   node scripts/churn-backfill.mjs            # dry run (prints the plan)
 *   node scripts/churn-backfill.mjs --apply    # write it
 *
 * Needs STRIPE_SECRET_KEY, STRIPE_PRICE_* (from stripe-setup),
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
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

const need = ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const k of need) if (!process.env[k]) { console.error(`${k} is not set`); process.exit(1); }

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PLAN_BY_PRICE = Object.fromEntries(
  [['starter', 'STRIPE_PRICE_STARTER'], ['pro', 'STRIPE_PRICE_PRO'], ['scale', 'STRIPE_PRICE_SCALE'], ['pro_annual', 'STRIPE_PRICE_PRO_ANNUAL']]
    .filter(([, k]) => process.env[k])
    .map(([code, k]) => [process.env[k], code]),
);

/** Monthly-equivalent pence, matching monthlyPence() in src/lib/billing/churn.ts. */
const MRR_BY_PLAN = { starter: 1900, pro: 3999, scale: 9900, pro_annual: 3000 };

/** Stripe's cancellation feedback in our vocabulary (see webhook.ts). */
const REASON_BY_FEEDBACK = {
  too_expensive: 'too_expensive',
  missing_features: 'missing_feature',
  switched_service: 'another_tool',
  unused: 'not_using',
  customer_service: 'other',
  too_complex: 'other',
  low_quality: 'other',
  other: 'other',
};

const iso = (secs) => (secs ? new Date(secs * 1000).toISOString() : null);

(async () => {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, created_at, plan, plan_code, plan_source, stripe_customer_id, stripe_subscription_id, subscription_started_at');
  if (error) throw error;

  const byCustomer = new Map();
  const bySubscription = new Map();
  for (const p of profiles) {
    if (p.stripe_customer_id) byCustomer.set(p.stripe_customer_id, p);
    if (p.stripe_subscription_id) bySubscription.set(p.stripe_subscription_id, p);
  }

  const rows = [];
  const profilePatches = [];
  const matched = new Set();
  let seen = 0;
  let orphans = 0;

  for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer'] })) {
    seen += 1;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    const profile = bySubscription.get(sub.id) ?? (customerId ? byCustomer.get(customerId) : null);
    if (!profile) {
      orphans += 1;
      console.log(`- ${sub.id}: no profile for customer ${customerId ?? '?'}; skipped`);
      continue;
    }
    matched.add(profile.id);

    const priceId = sub.items?.data?.[0]?.price?.id ?? null;
    const planCode = priceId ? (PLAN_BY_PRICE[priceId] ?? null) : null;
    const mrrPence = planCode ? (MRR_BY_PLAN[planCode] ?? null) : null;
    const startedAt = iso(sub.start_date);
    if (!startedAt) {
      console.log(`- ${sub.id}: no start_date; skipped`);
      continue;
    }

    rows.push({
      user_id: profile.id,
      at: startedAt,
      kind: 'started',
      cycle_started_at: startedAt,
      plan_code: planCode,
      mrr_pence: mrrPence,
      source: 'backfill',
      stripe_subscription_id: sub.id,
      stripe_event_id: `backfill:${sub.id}:started`,
      metadata: { status: sub.status },
    });

    const endedAt = iso(sub.ended_at) ?? iso(sub.canceled_at);
    if (endedAt) {
      const feedback = sub.cancellation_details?.feedback ?? null;
      const reason = feedback ? (REASON_BY_FEEDBACK[feedback] ?? 'other') : sub.status === 'unpaid' ? 'payment_failed' : null;
      rows.push({
        user_id: profile.id,
        at: endedAt,
        kind: 'ended',
        cycle_started_at: startedAt,
        plan_code: planCode,
        mrr_pence: mrrPence,
        reason,
        reason_comment: sub.cancellation_details?.comment ?? null,
        source: 'backfill',
        stripe_subscription_id: sub.id,
        stripe_event_id: `backfill:${sub.id}:ended`,
        metadata: { status: sub.status, stripe_feedback: feedback },
      });
    }

    if (!profile.subscription_started_at) {
      profilePatches.push({ id: profile.id, subscription_started_at: startedAt });
    }
  }

  // Plans granted by hand: real paying-or-comped customers Stripe has no record
  // of, so the only start date available is when they signed up.
  for (const p of profiles) {
    const isPro = p.plan === 'pro' || p.plan_code;
    if (!isPro || matched.has(p.id) || !p.created_at) continue;
    rows.push({
      user_id: p.id,
      at: p.created_at,
      kind: 'started',
      cycle_started_at: p.created_at,
      plan_code: p.plan_code ?? null,
      mrr_pence: p.plan_code ? (MRR_BY_PLAN[p.plan_code] ?? null) : null,
      source: 'manual',
      stripe_event_id: `backfill:manual:${p.id}:started`,
      metadata: { plan_source: p.plan_source ?? null, note: 'no Stripe subscription; started from profiles.created_at' },
    });
  }

  const started = rows.filter((r) => r.kind === 'started').length;
  const ended = rows.filter((r) => r.kind === 'ended').length;
  console.log(`\n${seen} Stripe subscription(s) seen, ${orphans} without a profile.`);
  console.log(`${rows.length} event row(s) to write: ${started} started, ${ended} ended.`);
  console.log(`${profilePatches.length} profile(s) need subscription_started_at.`);
  console.log(`Mode: ${apply ? 'APPLY' : 'dry run — re-run with --apply to write'}\n`);

  if (!apply || rows.length === 0) {
    for (const r of rows.slice(0, 20)) console.log(`  ${r.kind.padEnd(8)} ${r.at} ${r.plan_code ?? '—'} ${r.reason ?? ''}`);
    if (rows.length > 20) console.log(`  … and ${rows.length - 20} more`);
    return;
  }

  // Chunked, and ignoring duplicates so a re-run is a no-op rather than an error.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error: insertError } = await supabase
      .from('subscription_events')
      .upsert(chunk, { onConflict: 'stripe_event_id,kind', ignoreDuplicates: true });
    if (insertError) {
      console.error(`insert failed at row ${i}: ${insertError.message}`);
      process.exit(1);
    }
    console.log(`wrote ${Math.min(i + 200, rows.length)}/${rows.length}`);
  }

  for (const patch of profilePatches) {
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ subscription_started_at: patch.subscription_started_at })
      .eq('id', patch.id);
    if (updateError) console.error(`profile ${patch.id}: ${updateError.message}`);
  }

  console.log('\nDone.');
})();
