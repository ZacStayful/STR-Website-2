/**
 * Stripe price ids → plans / top-ups. Pure, read from env so the setup
 * script's output is the single source of truth. Tested.
 */

export const PLAN_PRICE_ENV: Record<string, string> = {
  starter: 'STRIPE_PRICE_STARTER',
  pro: 'STRIPE_PRICE_PRO',
  scale: 'STRIPE_PRICE_SCALE',
  pro_annual: 'STRIPE_PRICE_PRO_ANNUAL',
};

export const TOPUP_PRICE_ENV: Record<number, string> = {
  1000: 'STRIPE_PRICE_TOPUP_1000',
  2500: 'STRIPE_PRICE_TOPUP_2500',
  5000: 'STRIPE_PRICE_TOPUP_5000',
};

export type Env = Record<string, string | undefined>;

export function priceIdForPlan(planCode: string, env: Env = process.env): string | null {
  const key = PLAN_PRICE_ENV[planCode];
  return key ? env[key] || null : null;
}

export function planForPriceId(priceId: string | null | undefined, env: Env = process.env): string | null {
  if (!priceId) return null;
  for (const [code, key] of Object.entries(PLAN_PRICE_ENV)) if (env[key] && env[key] === priceId) return code;
  return null;
}

export function priceIdForTopup(amountPence: number, env: Env = process.env): string | null {
  const key = TOPUP_PRICE_ENV[amountPence];
  return key ? env[key] || null : null;
}

export function topupPenceForPriceId(priceId: string | null | undefined, env: Env = process.env): number | null {
  if (!priceId) return null;
  for (const [pence, key] of Object.entries(TOPUP_PRICE_ENV)) if (env[key] && env[key] === priceId) return Number(pence);
  return null;
}

export function configuredPlanCodes(env: Env = process.env): string[] {
  return Object.keys(PLAN_PRICE_ENV).filter((c) => Boolean(env[PLAN_PRICE_ENV[c]]));
}
