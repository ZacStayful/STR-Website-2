/**
 * The one place the out-of-credit HTTP response is built, so every route and
 * the client interceptor agree on its shape.
 */

import { InsufficientCreditError } from './ledger.ts';

export const INSUFFICIENT_CREDIT_CODE = 'insufficient_credit';

export interface InsufficientCreditPayload {
  error: string;
  code: typeof INSUFFICIENT_CREDIT_CODE;
  action: string;
  requiredPence: number;
  availablePence: number;
  shortfallPence: number;
  topupUrl: string;
  upgradeUrl: string;
}

/** CREDIT_ENFORCE=true blocks actions; anything else is shadow mode (meter, never block). */
export function isEnforcing(): boolean {
  return process.env.CREDIT_ENFORCE === 'true';
}

/**
 * Batch 21 (B2): whether a reservation (or a known-cost call) the member
 * cannot afford goes ahead anyway. Shadow mode lets a member who was given
 * the welcome credit carry on into overdraft while prices are calibrated; a
 * requireCredit caller never does, and neither does a payer who was not
 * welcomed (a pack-era account, pack bought or not; an account whose welcome
 * credit was withheld): held to what it holds, so its next grant is never
 * eaten by a debt.
 */
export function shadowModeAllows(p: { requireCredit?: boolean; welcomeGranted: boolean; enforcing?: boolean }): boolean {
  if (p.enforcing ?? isEnforcing()) return false;
  if (p.requireCredit) return false;
  return p.welcomeGranted;
}

export function insufficientCreditPayload(err: InsufficientCreditError | { requiredPence: number; availablePence: number }, action: string): InsufficientCreditPayload {
  const required = Math.max(0, Math.round(err.requiredPence));
  // Batch 21 (B27): a shadow-mode overdraft reads as a negative balance; the
  // dialog says "you have £0", never "you have -£13.20".
  const available = Math.max(0, Math.round(err.availablePence));
  return {
    error: available <= 0 ? "You're out of credit." : "You don't have enough credit for this.",
    code: INSUFFICIENT_CREDIT_CODE,
    action,
    requiredPence: required,
    availablePence: available,
    shortfallPence: Math.max(0, required - available),
    topupUrl: '/account/billing#topup',
    upgradeUrl: '/upgrade',
  };
}

export function insufficientCreditResponse(err: InsufficientCreditError | { requiredPence: number; availablePence: number }, action: string, headers: Record<string, string> = {}): Response {
  return Response.json(insufficientCreditPayload(err, action), { status: 402, headers });
}
