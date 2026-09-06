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

export async function sendEmail(params: { to: string; subject: string; html: string; text: string }): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn("[email] not configured (RESEND_API_KEY / EMAIL_FROM) — skipping send");
    return { sent: false, reason: "not_configured" };
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [params.to], subject: params.subject, html: params.html, text: params.text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<unreadable>");
      console.error(`[email] Resend HTTP ${res.status}: ${body.slice(0, 400)}`);
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("[email] send failed:", err);
    return { sent: false, reason: "network" };
  }
}
