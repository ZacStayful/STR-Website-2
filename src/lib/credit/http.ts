/**
 * The one place the out-of-credit HTTP response is built, so every route and
 * the client interceptor agree on its shape.
 */

import { InsufficientCreditError } from './ledger';

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

export function insufficientCreditPayload(err: InsufficientCreditError | { requiredPence: number; availablePence: number }, action: string): InsufficientCreditPayload {
  const required = Math.max(0, Math.round(err.requiredPence));
  const available = Math.round(err.availablePence);
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
