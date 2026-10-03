"use server";

import { redirect } from "next/navigation";
import { verifyExpiringFromEnv } from "@/lib/crypto/sign";
import { feedbackPayloadId } from "@/lib/briefing/email";
import { isFeedback, recordFeedback } from "@/lib/briefing/marks-server";

/** Batch 23b: "Useful" / "Not for me" from the email, recorded on one press (never on the GET a link scanner makes). */
export async function recordBriefingFeedbackAction(formData: FormData): Promise<void> {
  const b = String(formData.get("b") ?? "");
  const e = String(formData.get("e") ?? "");
  const s = String(formData.get("s") ?? "");
  const a = String(formData.get("a") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(b) || !isFeedback(a) || !verifyExpiringFromEnv(feedbackPayloadId(b), e, s)) redirect("/briefing/feedback?done=0");
  const ok = await recordFeedback(b, a);
  redirect(`/briefing/feedback?done=${ok ? "1" : "0"}`);
}
