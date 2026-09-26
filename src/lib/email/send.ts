// ─── Transactional email (Resend over plain fetch, no SDK) ────────────
//
// Configured with RESEND_API_KEY and EMAIL_FROM (e.g. "Stayful <hello@stayful.co.uk>";
// the domain must be verified in Resend). With either unset, sending is
// skipped and logged rather than throwing — callers decide what that means.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendResult {
  sent: boolean;
  reason?: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

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
  // Without a key a retry could send twice, so only a keyed send gets one.
  const attempts = params.idempotencyKey ? 2 : 1;
  let last: SendResult = { sent: false, reason: "network" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(RESEND_ENDPOINT, { method: "POST", headers, body });
      if (res.ok) return { sent: true };
      const text = await res.text().catch(() => "<unreadable>");
      console.error(`[email] Resend HTTP ${res.status}: ${text.slice(0, 400)}`);
      last = { sent: false, reason: `http_${res.status}` };
      // A 4xx is a definite answer (bad request, or this key already used for
      // another email): retrying cannot change it.
      if (res.status < 500) return last;
    } catch (err) {
      console.error("[email] send failed:", err);
      last = { sent: false, reason: "network" };
    }
  }
  return last;
}
