/**
 * Saying so when an enhanced report could not get its second opinion.
 *
 * The enhanced report's distinguishing feature is a second, independent
 * revenue estimate from PMI. That call can fail — most often because PMI's
 * free tier allows two requests per ten seconds and several funnels fired at
 * once — and until now it failed SILENTLY: the promise caught, returned null,
 * and the customer got a standard report at enhanced prices with nothing
 * telling them why.
 *
 * Billing was never the problem. A failed provider call logs at `basePence:
 * 0` and the over-reservation is released, so the customer pays for what
 * actually ran. The problem is that they could not tell, which is the part
 * that matters when they are the one who chose to pay more.
 *
 * Pure, so the web report and the PDF cannot word the same event
 * differently — the kind of drift nobody notices until a customer is reading
 * both side by side on a call.
 */

export type EnhancedFailureReason = 'rate_limited' | 'unavailable';

export interface EnhancedNotice {
  reason: EnhancedFailureReason;
  /** One sentence for the customer, on the report and in the PDF. */
  message: string;
  /** Short form for a list row or a billing line. */
  headline: string;
}

const MESSAGES: Record<EnhancedFailureReason, { headline: string; message: string }> = {
  rate_limited: {
    headline: 'Second opinion unavailable',
    message:
      'The second revenue estimate was not available for this report — our data provider was rate limiting us at the time. ' +
      'Everything else here is unaffected, and you have not been charged for the part that did not run.',
  },
  unavailable: {
    headline: 'Second opinion unavailable',
    message:
      'The second revenue estimate could not be fetched for this report. ' +
      'Everything else here is unaffected, and you have not been charged for the part that did not run.',
  },
};

/**
 * Reads a failure and decides which of the two things to say.
 *
 * A 429 is worth naming separately because it is transient and re-running in
 * a minute will usually work — advice the generic message cannot give.
 */
export function classifyEnhancedFailure(err: unknown): EnhancedFailureReason {
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 429) return 'rate_limited';
  // PmiError carries its status, but a failure can also surface as a plain
  // Error from a wrapper, so the message is checked too rather than
  // defaulting a real rate limit to the vaguer wording.
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (/\b429\b|rate limit/i.test(message)) return 'rate_limited';
  return 'unavailable';
}

export function enhancedNotice(reason: EnhancedFailureReason): EnhancedNotice {
  const copy = MESSAGES[reason] ?? MESSAGES.unavailable;
  return { reason, ...copy };
}

/** Straight from a caught error to the notice, which is how callers use it. */
export function noticeForFailure(err: unknown): EnhancedNotice {
  return enhancedNotice(classifyEnhancedFailure(err));
}

/**
 * An enhanced run that returned no second opinion WITHOUT throwing — PMI
 * answered, but with nothing usable. Worth its own entry point so a caller
 * never has to invent an error to get a notice.
 */
export function noticeForEmptyResult(): EnhancedNotice {
  return enhancedNotice('unavailable');
}
