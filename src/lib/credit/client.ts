/**
 * Browser-side helpers for the credit system. One fetch wrapper intercepts
 * the standard 402 payload (src/lib/credit/http.ts) and raises a window
 * event the CreditProvider turns into the out-of-credit modal, so every
 * caller gets the same behaviour without wiring a modal each time.
 */

export const OUT_OF_CREDIT_EVENT = 'stayful:out-of-credit';
export const CREDIT_CHANGED_EVENT = 'stayful:credit-changed';
export const INSUFFICIENT_CREDIT_CODE = 'insufficient_credit';

export interface OutOfCreditDetail {
  action?: string;
  requiredPence?: number;
  availablePence?: number;
  shortfallPence?: number;
  error?: string;
  /** Open straight on the top-up buttons (banner / badge clicks). */
  mode?: 'blocked' | 'topup';
}

export function openOutOfCredit(detail: OutOfCreditDetail = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OutOfCreditDetail>(OUT_OF_CREDIT_EVENT, { detail }));
}

export function notifyCreditChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CREDIT_CHANGED_EVENT));
}

/**
 * fetch() that surfaces an out-of-credit response as the modal (unless
 * `silent`) and otherwise returns the response untouched, so existing
 * `!res.ok` handling keeps working. The body is cloned, never consumed.
 */
export async function creditFetch(input: RequestInfo | URL, init?: RequestInit, opts: { silent?: boolean } = {}): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 402 && !opts.silent) {
    try {
      const body = (await res.clone().json()) as OutOfCreditDetail & { code?: string };
      if (body.code === INSUFFICIENT_CREDIT_CODE) openOutOfCredit({ ...body, mode: 'blocked' });
    } catch {
      /* not our payload */
    }
  }
  return res;
}

export interface EstimateResponse {
  action: string;
  typicalBasePence: number;
  maxBasePence: number;
  planCreditPence: number;
  topupCreditPence: number;
  maxTopupCreditPence: number;
  spendableBasePence: number;
  availablePence: number;
  sufficient: boolean;
  paidFrom: 'plan' | 'welcome' | 'topup' | 'mixed' | 'none';
  rates: { plan: number; welcome: number; topup: number; adjustment: number };
  admin: boolean;
}

export async function fetchEstimate(action: string): Promise<EstimateResponse | null> {
  try {
    const res = await fetch(`/api/credit/estimate?action=${encodeURIComponent(action)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as EstimateResponse;
  } catch {
    return null;
  }
}

/** Check before an expensive action; opens the modal and returns false when it can't be afforded. */
export async function preflight(action: string): Promise<boolean> {
  const est = await fetchEstimate(action);
  if (!est) return true; // never block on a failed estimate; the server enforces anyway
  if (est.sufficient) return true;
  openOutOfCredit({ action, requiredPence: est.maxBasePence, availablePence: est.availablePence, shortfallPence: Math.max(0, est.maxBasePence - est.spendableBasePence), mode: 'blocked' });
  return false;
}

export function formatGbp(pence: number): string {
  const pounds = pence / 100;
  return `${pounds < 0 ? '-' : ''}£${Math.abs(pounds).toFixed(2)}`;
}

export const ACTION_LABELS: Record<string, string> = {
  report: 'report',
  quick_view: 'listing check',
  narrate: 'AI narration',
  speak: 'voice summary',
  autocomplete: 'address lookup',
  geocode: 'postcode lookup',
};
