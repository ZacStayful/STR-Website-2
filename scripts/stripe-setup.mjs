#!/usr/bin/env node
/**
 * One-off Stripe setup for usage-based credit billing. Idempotent: prices are
 * found by lookup_key before anything is created, so it is safe to re-run.
 *
 * Creates (in the account behind STRIPE_SECRET_KEY):
 *   - Starter £19/month, Scale £99/month, Pro annual £360/year
 *   - Top-ups £10 / £25 / £50 (one-off)
 *   - a Billing Portal configuration (switch between the four plans, cancel
 *     at period end, update card, see invoices)
 * and prints the STRIPE_PRICE_* / STRIPE_PORTAL_CONFIG_ID lines for .env.
 *
 * The existing £39.99/month price behind the old Payment Link is REUSED as
 * the Pro monthly price so current subscribers land on Pro untouched:
 *
 *   node scripts/stripe-setup.mjs --pro-monthly=price_xxx [--pro-annual=price_yyy] [--live]
 *
 * Reads STRIPE_SECRET_KEY from the environment or .env.local. Test mode by
 * default; pass --live only once the test run looks right.
 */

import fs from 'node:fs';
import path from 'node:path';
import Stripe from 'stripe';

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

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
}));

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set (env or .env.local).');
  process.exit(1);
}
if (key.startsWith('sk_live_') && args.live !== 'true') {
  console.error('Refusing to run against a LIVE key without --live.');
  process.exit(1);
}
const stripe = new Stripe(key);

const PLANS = [
  { code: 'starter', lookup: 'stayful_starter_monthly', name: 'Stayful Starter', amount: 1900, interval: 'month', credit: 1900 },
  { code: 'pro', lookup: 'stayful_pro_monthly', name: 'Stayful Pro', amount: 3999, interval: 'month', credit: 5000 },
  { code: 'scale', lookup: 'stayful_scale_monthly', name: 'Stayful Scale', amount: 9900, interval: 'month', credit: 14000 },
  { code: 'pro_annual', lookup: 'stayful_pro_annual', name: 'Stayful Pro (annual)', amount: 36000, interval: 'year', credit: 5000 },
];
const TOPUPS = [1000, 2500, 5000];

async function findByLookup(lookup) {
  const r = await stripe.prices.list({ lookup_keys: [lookup], limit: 1, active: true });
  return r.data[0] ?? null;
}

async function ensureProduct(name, metadata) {
  const search = await stripe.products.search({ query: `name:'${name.replace(/'/g, "\\'")}' AND active:'true'`, limit: 1 });
  if (search.data[0]) return search.data[0];
  return stripe.products.create({ name, metadata });
}

async function ensureRecurringPrice(plan) {
  const existing = await findByLookup(plan.lookup);
  if (existing) return { price: existing, created: false };
  const product = await ensureProduct(plan.name, { plan_code: plan.code, monthly_credit_pence: String(plan.credit) });
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'gbp',
    unit_amount: plan.amount,
    recurring: { interval: plan.interval },
    lookup_key: plan.lookup,
    transfer_lookup_key: true,
    metadata: { plan_code: plan.code, monthly_credit_pence: String(plan.credit) },
  });
  return { price, created: true };
}

async function ensureTopupPrice(pence) {
  const lookup = `stayful_topup_${pence}`;
  const existing = await findByLookup(lookup);
  if (existing) return { price: existing, created: false };
  const product = await ensureProduct('Stayful credit top-up', { kind: 'topup' });
  const price = await stripe.prices.create({ product: product.id, currency: 'gbp', unit_amount: pence, lookup_key: lookup, transfer_lookup_key: true, metadata: { kind: 'topup', amount_pence: String(pence) }, nickname: `Top-up £${(pence / 100).toFixed(2)}` });
  return { price, created: true };
}

async function assertPrice(id, { amount, interval }) {
  const p = await stripe.prices.retrieve(id);
  if (p.currency !== 'gbp' || p.unit_amount !== amount || p.recurring?.interval !== interval) {
    throw new Error(`${id} is ${p.currency} ${p.unit_amount} / ${p.recurring?.interval ?? 'one-off'}, expected gbp ${amount} / ${interval}`);
  }
  return p;
}

async function ensurePortal(priceIds, productIds) {
  const existing = process.env.STRIPE_PORTAL_CONFIG_ID;
  const features = {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name'] },
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none', cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'] } },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      proration_behavior: 'always_invoice',
      schedule_at_period_end: { conditions: [{ type: 'decreasing_item_amount' }, { type: 'shortening_interval' }] },
      products: productIds.map((product, i) => ({ product, prices: priceIds.filter((_, j) => productIds[j] === product) })).filter((x, i, arr) => arr.findIndex((y) => y.product === x.product) === i),
    },
  };
  const business_profile = { headline: 'Stayful Intelligence billing' };
  if (existing) {
    try {
      const c = await stripe.billingPortal.configurations.update(existing, { features, business_profile });
      return { id: c.id, created: false };
    } catch (err) {
      console.warn(`Portal config ${existing} could not be updated (${err.message}); creating a new one.`);
    }
  }
  const c = await stripe.billingPortal.configurations.create({ features, business_profile });
  return { id: c.id, created: true };
}

(async () => {
  const out = {};
  const priceIds = [];
  const productIds = [];

  const proMonthly = args['pro-monthly'] || process.env.STRIPE_PRICE_PRO;
  if (!proMonthly) {
    console.error('Pass --pro-monthly=price_… (the £39.99/month price behind the existing Payment Link).');
    process.exit(1);
  }
  const pro = await assertPrice(proMonthly, { amount: 3999, interval: 'month' });
  console.log(`Pro monthly: reusing ${pro.id}`);
  out.STRIPE_PRICE_PRO = pro.id;
  priceIds.push(pro.id);
  productIds.push(typeof pro.product === 'string' ? pro.product : pro.product.id);

  for (const plan of PLANS.filter((p) => p.code !== 'pro')) {
    let price;
    if (plan.code === 'pro_annual' && (args['pro-annual'] || process.env.STRIPE_PRICE_PRO_ANNUAL)) {
      price = await assertPrice(args['pro-annual'] || process.env.STRIPE_PRICE_PRO_ANNUAL, { amount: 36000, interval: 'year' });
      console.log(`${plan.name}: reusing ${price.id}`);
    } else {
      const r = await ensureRecurringPrice(plan);
      price = r.price;
      console.log(`${plan.name}: ${r.created ? 'created' : 'found'} ${price.id}`);
    }
    out[`STRIPE_PRICE_${plan.code.toUpperCase()}`] = price.id;
    priceIds.push(price.id);
    productIds.push(typeof price.product === 'string' ? price.product : price.product.id);
  }

  for (const pence of TOPUPS) {
    const r = await ensureTopupPrice(pence);
    console.log(`Top-up £${pence / 100}: ${r.created ? 'created' : 'found'} ${r.price.id}`);
    out[`STRIPE_PRICE_TOPUP_${pence}`] = r.price.id;
  }

  const portal = await ensurePortal(priceIds, productIds);
  console.log(`Billing portal configuration: ${portal.created ? 'created' : 'updated'} ${portal.id}`);
  out.STRIPE_PORTAL_CONFIG_ID = portal.id;

  console.log('\nAdd these to .env.local and Vercel:\n');
  for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
  console.log('\nAlso, in the Stripe Dashboard:');
  console.log('  • Settings → Public details: set the Terms of Service URL to https://intelligence.stayful.co.uk/terms so Checkout can collect consent.');
  console.log('  • Developers → Webhooks: point /api/stripe/webhook at checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted, payment_intent.succeeded, payment_method.attached, charge.refunded, charge.dispute.created.');
  console.log('  • Optional: STRIPE_TAX=true once Stripe Tax is enabled to collect VAT automatically.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
