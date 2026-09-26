import { createAdminClient } from "@/lib/supabase/admin";
import { classifyKeyword, keywordFromOptOutType, type Keyword } from "@/lib/sms/keywords";
import { isUkMobile, maskPhone, ukMobile } from "@/lib/sms/phone";
import { insertMessage, startNumber, stopNumber } from "@/lib/sms/store";
import { twiml, verifiedTwilioForm } from "@/lib/sms/webhook";

// ─── Twilio inbound texts: STOP / START / HELP (Batch 8) ──────────────
// The Messaging Service's incoming-message webhook points here. Every request
// must carry a valid X-Twilio-Signature (our auth token); anything unsigned is
// refused before a field is read.
//
//   STOP (UNSUBSCRIBE, STOPALL, OPT OUT…)  every account with that number stops
//                                         getting texts, at once
//   START (UNSTOP, YES)                   texts may go again; each account's own
//                                         switches still apply
//   HELP (INFO)                           where to manage texts
//
// When Twilio's Advanced Opt-Out has already recognised the keyword (it sends
// OptOutType) it has also replied, so we record it and reply with nothing.
// Other messages get no reply (a reply costs a text). Only the keyword is
// stored, never what the member wrote.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPLIES: Record<Keyword, string> = {
  stop: "Stayful: you will not get any more texts from us. Reply START to turn them back on.",
  start: "Stayful: texts are back on. Manage them in your account under Notifications. Reply STOP to opt out",
  help: "Stayful deal alerts. Manage texts in your account under Notifications. Reply STOP to opt out",
};

export async function POST(request: Request) {
  const form = await verifiedTwilioForm(request);
  if (!form.ok) return form.response;
  const p = form.params;
  const from = p.get("From") ?? "";
  const phone = isUkMobile(from) ? from : ukMobile(from);
  const optOutType = p.get("OptOutType");
  const keyword = keywordFromOptOutType(optOutType) ?? classifyKeyword(p.get("Body"));
  const twilioReplied = Boolean(optOutType);

  if (!phone) {
    // Not a number we ever text: nothing to switch.
    return twiml(null);
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // Twilio's own opt-out still blocks our sends (error 21610), and the send
    // path records that; but this should never happen, so say it loudly.
    console.error(`[sms] inbound ${keyword ?? "text"} from ${maskPhone(phone)} could not be recorded: storage not configured`);
    return new Response("Storage not configured", { status: 503 });
  }

  if (keyword === "stop") {
    const n = await stopNumber(admin, phone, "keyword");
    if (n === null) return new Response("Could not record STOP", { status: 500 });
    console.log(`[sms] STOP from ${maskPhone(phone)}: ${n} account(s) stopped`);
  } else if (keyword === "start") {
    const n = await startNumber(admin, phone);
    if (n === null) return new Response("Could not record START", { status: 500 });
    console.log(`[sms] START from ${maskPhone(phone)}: ${n} account(s) restarted`);
  }

  // The keyword, never the words. A repeat delivery of the same MessageSid is refused by the unique index, harmlessly.
  await insertMessage(admin, {
    user_id: null,
    direction: "inbound",
    kind: "keyword",
    phone_e164: phone,
    body: keyword ? keyword.toUpperCase() : null,
    outcome: "received",
    twilio_sid: p.get("MessageSid") ?? p.get("SmsSid"),
  });

  if (!keyword || twilioReplied) return twiml(null);
  return twiml(REPLIES[keyword]);
}
