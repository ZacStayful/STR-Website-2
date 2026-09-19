/**
 * Reading Cloudflare's answer to "was this a real person?".
 *
 * Pure and tested, because this is the decision that stands between a bot
 * and a customer's credit balance — and because the two failure directions
 * are both bad in ways that are easy to get backwards:
 *
 *   Fail CLOSED on a real verdict of "no". That is the whole point.
 *
 *   Fail OPEN when we could not reach Cloudflare at all. A Cloudflare
 *   outage must not stop a customer's funnel collecting leads for the
 *   duration. This is safe here in a way it would not be elsewhere,
 *   because the atomic daily caps and the spend ceiling still apply —
 *   an outage drops us back to exactly the protection the funnel had
 *   before Turnstile existed, which was deemed acceptable then.
 *
 * Nobody can force that outage from outside: the siteverify call is
 * server-to-server, so a prospect (or a bot) has no way to make it fail.
 */

/** Cloudflare's documented response shape. Extra keys are ignored. */
export interface SiteverifyResponse {
  success?: unknown;
  'error-codes'?: unknown;
  action?: unknown;
  hostname?: unknown;
  challenge_ts?: unknown;
}

export type TurnstileOutcome =
  /** Cloudflare said yes. */
  | { allow: true; reason: 'passed' }
  /** Not configured on this deployment — the check is simply not running. */
  | { allow: true; reason: 'not_configured' }
  /** We could not reach Cloudflare. Allowed; the caps still apply. */
  | { allow: true; reason: 'unreachable' }
  /** Cloudflare said no. */
  | { allow: false; reason: 'failed'; codes: string[]; message: string }
  /** The form sent nothing to check. */
  | { allow: false; reason: 'missing_token'; codes: string[]; message: string };

/**
 * Wording a prospect sees. Never mentions bots: the person reading this is
 * overwhelmingly a real customer whose token expired while they filled the
 * form in, and accusing them is a poor way to collect a lead.
 */
const RETRY_MESSAGE = 'That security check expired. Please try again.';
const GENERIC_MESSAGE = 'We could not complete the security check. Please refresh the page and try again.';

/**
 * Codes that mean "this specific token is stale", as opposed to a
 * configuration problem. They get the friendlier wording, because a
 * prospect who spent two minutes on the form and then hit an expired token
 * just needs to be told to try again.
 */
const STALE_CODES = new Set(['timeout-or-duplicate', 'invalid-input-response']);

export function parseErrorCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string' && c.length > 0);
}

/** Turns Cloudflare's JSON into a decision. */
export function readSiteverify(body: SiteverifyResponse | null | undefined): TurnstileOutcome {
  const codes = parseErrorCodes(body?.['error-codes']);
  // Strict equality: a truthy-but-not-true value (a string "false", say)
  // must not read as a pass.
  if (body?.success === true) return { allow: true, reason: 'passed' };
  const stale = codes.some((c) => STALE_CODES.has(c));
  return {
    allow: false,
    reason: 'failed',
    codes,
    message: stale ? RETRY_MESSAGE : GENERIC_MESSAGE,
  };
}

export function missingToken(): TurnstileOutcome {
  return { allow: false, reason: 'missing_token', codes: ['missing-input-response'], message: GENERIC_MESSAGE };
}

export function notConfigured(): TurnstileOutcome {
  return { allow: true, reason: 'not_configured' };
}

export function unreachable(): TurnstileOutcome {
  return { allow: true, reason: 'unreachable' };
}

/** Whether both halves of the key pair are present. Neither alone is usable. */
export function turnstileConfigured(secret: string | undefined, siteKey: string | undefined): boolean {
  return Boolean(secret && secret.trim()) && Boolean(siteKey && siteKey.trim());
}
