/**
 * What a Monday reply means for the funnel's writes (Batch 20, Part F). Pure.
 *
 *   stop     Monday's limits (complexity budget, rate, daily calls,
 *            concurrency), an outage (5xx), a refused token, or no reply at
 *            all: stop the run; the next one carries on. Whatever did get
 *            through is still counted, so nothing that was done is sent again.
 *   refused  the request as a whole was turned down (a value Monday will not
 *            take, a column that has gone): not worth repeating as it is.
 *   per row  an error on one alias fails that row alone; the others' data is
 *            kept.
 *
 * Both of Monday's error shapes are read: GraphQL `errors` (with the alias in
 * `path`, and partial `data`) and the older `{ error_code, error_message }`.
 */

export interface RawReply {
  status: number | null;
  data: Record<string, unknown> | null;
  errors: { message: string; code: string | null; alias: string | null }[];
  errorCode: string | null;
  errorMessage: string | null;
  transport: string | null;
}

export interface Reply {
  /** Results by alias (partial when some failed). */
  data: Record<string, unknown>;
  /** Errors on one alias each. */
  aliasErrors: Map<string, string>;
  /** Why the run should stop now, if it should. */
  stop: string | null;
  /** Why the request as a whole was refused, if it was. */
  refused: string | null;
}

const LIMITS = /complexity|rate ?limit|ratelimit|daily ?limit|limit exceeded|concurrency|too many requests|internal server error|temporarily|timed? ?out|try again/i;

/** A limit or an outage: worth another go later, not now. */
export function isTemporary(code: string | null, message: string | null): boolean {
  return LIMITS.test(code ?? '') || LIMITS.test(message ?? '');
}

export function readReply(raw: RawReply): Reply {
  const reply: Reply = { data: raw.data ?? {}, aliasErrors: new Map(), stop: null, refused: null };
  if (raw.transport) {
    reply.stop = raw.transport;
    return reply;
  }
  if (raw.status !== null && (raw.status === 429 || raw.status >= 500 || raw.status === 401 || raw.status === 403)) {
    reply.stop = raw.errorMessage ?? raw.errors[0]?.message ?? `Monday returned HTTP ${raw.status}`;
    return reply;
  }
  if (raw.errorCode || (raw.errorMessage && raw.errors.length === 0)) {
    const message = [raw.errorCode, raw.errorMessage].filter(Boolean).join(': ') || 'Monday refused the request';
    if (isTemporary(raw.errorCode, raw.errorMessage)) reply.stop = message;
    else reply.refused = message;
    return reply;
  }
  for (const e of raw.errors) {
    if (isTemporary(e.code, e.message)) {
      reply.stop ??= e.message;
      continue;
    }
    if (e.alias) reply.aliasErrors.set(e.alias, e.message);
    else reply.refused ??= e.message;
  }
  return reply;
}
