import { createAdminClient } from "@/lib/supabase/admin";
import { messageById, stopNumber, updateMessage } from "@/lib/sms/store";
import { ERROR_OPTED_OUT, statusAdvances } from "@/lib/sms/twilio";
import { verifiedTwilioForm } from "@/lib/sms/webhook";

// ─── Twilio delivery status (Batch 8) ─────────────────────────────────
// Every text we send passes StatusCallback=<site>/api/twilio/status?m=<sms_messages.id>.
// Twilio posts here as the text moves queued → sent → delivered (or failed /
// undelivered). Signed with our auth token; anything unsigned is refused.
// The status only ever moves forward, so callbacks arriving out of order
// cannot undo "delivered". A 21610 means the number replied STOP to us at
// Twilio's end, so it is stopped here too. Texts are free, so there is
// nothing to charge or refund.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const form = await verifiedTwilioForm(request);
  if (!form.ok) return form.response;
  const p = form.params;
  const id = new URL(request.url).searchParams.get("m");
  const sid = p.get("MessageSid") ?? p.get("SmsSid");
  const status = (p.get("MessageStatus") ?? p.get("SmsStatus") ?? "").toLowerCase();
  const errorCode = Number(p.get("ErrorCode")) || null;
  // Nothing we can file: acknowledge, so Twilio does not retry.
  if (!id || !UUID.test(id) || !sid || !status) return new Response(null, { status: 204 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return new Response("Storage not configured", { status: 503 });
  }
  const row = await messageById(admin, id);
  if (!row) return new Response(null, { status: 204 });
  if (row.twilio_sid && row.twilio_sid !== sid) {
    console.warn("[sms] status callback sid does not match the message it names; ignored");
    return new Response(null, { status: 204 });
  }

  const patch: Record<string, unknown> = {};
  if (!row.twilio_sid) patch.twilio_sid = sid;
  if (statusAdvances(row.status, status)) {
    patch.status = status;
    patch.status_at = new Date().toISOString();
    if (errorCode) patch.error_code = errorCode;
  }
  if (Object.keys(patch).length > 0) await updateMessage(admin, id, patch);
  if (errorCode === ERROR_OPTED_OUT) await stopNumber(admin, row.phone_e164, "twilio");
  return new Response(null, { status: 204 });
}
