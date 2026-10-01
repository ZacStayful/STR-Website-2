// ─── Transactional email (Resend over plain fetch, no SDK) ────────────
//
// Configured with RESEND_API_KEY and EMAIL_FROM (e.g. "Stayful <hello@stayful.co.uk>";
// the domain must be verified in Resend). With either unset, sending is
// skipped and logged rather than throwing — callers decide what that means.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** Batch 21 (G9): a Resend call that hangs is given up on, so a cron's 60 s is never spent waiting on one send. */
const SEND_TIMEOUT_MS = 10_000;
/** Batch 21 (D2): Resend's rate limit (429) is waited out and tried again, up to this many calls in all. */
const RATE_LIMIT_ATTEMPTS = 3;
const RATE_LIMIT_PAUSE_MS = 600;
const RATE_LIMIT_PAUSE_MAX_MS = 5_000;

export interface SendResult {
  sent: boolean;
  /** Why not; or, on a sent email, 'already_sent' when Resend already had this slot's email (Batch 21, D18). */
  reason?: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** How long Resend asked us to wait (Retry-After, in seconds), else a little longer each time; capped. */
export function retryAfterMs(header: string | null, attempt: number): number {
  const seconds = header === null || header.trim() === "" ? Number.NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(RATE_LIMIT_PAUSE_MAX_MS, Math.round(seconds * 1000));
  return Math.min(RATE_LIMIT_PAUSE_MAX_MS, RATE_LIMIT_PAUSE_MS * attempt);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /**
   * Overrides the sender for a white-label funnel email. Build it with
   * `brandedFrom` in ./from.ts, never by hand: the display name comes from a
   * customer-supplied company name and goes straight into a header.
   */
  from?: string;
  /** Where a reply goes. `safeReplyTo` in ./from.ts vets it. */
  replyTo?: string;
  /**
   * Resend's Idempotency-Key (an HTTP header on the API call, not an email
   * header). Resend keeps it 24 hours: the same key and payload again returns
   * the first answer without sending twice, and a different payload under the
   * same key is refused (409). The capped member emails pass their slot
   * (src/lib/notify/cap.ts sendKey). With a key, an ambiguous failure — the
   * network dropped, or Resend answered 5xx, so the email may or may not have
   * gone — is retried once at once with the same key, which settles it.
   */
  idempotencyKey?: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = params.from ?? process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn("[email] not configured (RESEND_API_KEY / EMAIL_FROM) — skipping send");
    return { sent: false, reason: "not_configured" };
  }
  const body = JSON.stringify({
    from,
    to: [params.to],
    subject: params.subject,
    html: params.html,
    text: params.text,
    ...(params.replyTo ? { reply_to: params.replyTo } : {}),
    ...(params.headers ? { headers: params.headers } : {}),
  });
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  if (params.idempotencyKey) headers["Idempotency-Key"] = params.idempotencyKey;
  let last: SendResult = { sent: false, reason: "network" };
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(RESEND_ENDPOINT, { method: "POST", headers, body, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
      if (res.ok) return { sent: true };
      const text = await res.text().catch(() => "<unreadable>");
      console.error(`[email] Resend HTTP ${res.status}: ${text.slice(0, 400)}`);
      last = { sent: false, reason: `http_${res.status}` };
      // Batch 21 (D18): a keyed send refused because its key was already used
      // for a different email means this slot's email went earlier (a pass
      // that tried again after an ambiguous failure): to the caller, sent.
      if (res.status === 409 && params.idempotencyKey) return { sent: true, reason: "already_sent" };
      // Batch 21 (D2): rate-limited (Resend allows two requests a second):
      // nothing was sent, so wait as told and try again, keyed or not.
      if (res.status === 429) {
        if (attempt >= RATE_LIMIT_ATTEMPTS) return last;
        await sleep(retryAfterMs(res.headers.get("retry-after"), attempt));
        continue;
      }
      // Any other 4xx is a definite answer (a bad request): retrying cannot change it.
      if (res.status < 500) return last;
    } catch (err) {
      console.error("[email] send failed:", err);
      last = { sent: false, reason: "network" };
    }
    // Ambiguous (a 5xx, a dropped connection, the timeout): the email may
    // have gone. Without a key a retry could send twice, so only a keyed
    // send gets one, at once, under the same key, which settles it.
    if (!params.idempotencyKey || attempt >= 2) return last;
  }
}
