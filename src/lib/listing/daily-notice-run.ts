import "server-only";

import { createAdminClient } from "../supabase/admin";
import { sendEmail, isEmailConfigured } from "../email/send";
import { dailyNoticeEmail } from "../email/daily-notice";
import { siteUrl } from "../url";
import type { RunResult } from "./picks-run";
import { abandonSend, claimSlot, finishSend, markSending, releaseClaim } from "../notify/sends";
import { capDay, newSendToken, sendKey } from "../notify/cap";
import { listUnsubscribeHeaders } from "../notify/render-email";
import { LOW_CREDIT_ALONE_FROM_MINUTE_UTC } from "../credit/low-credit";

// ─── One-off "picks are now daily" notice ─────────────────────────────
// Pressed by hand from /admin/picks, dry run first. Goes to every member
// who currently has daily picks on (the same audience as the picks run:
// enrolled and signed in at least once) and has not had it yet. Each send
// is stamped on the profile as it goes, so a second press, or a press after
// a run out of time, never sends twice. Nothing here runs on deploy.
//
// It counts toward the one-a-day cap (src/lib/notify/cap.ts): a member who
// has already had their daily email today is skipped, unstamped, and gets
// the notice from a later press. Batch 21 (D26): a real press is refused
// before 08:30 UTC, when it would take the day's slot from that morning's
// Today's 5; and each notice carries one-click unsubscribe (daily picks).

const TIME_BUDGET_MS = 50_000;
const SAMPLE = 20;

type Row = { id: string; email: string | null; full_name: string | null };

function firstNameOf(fullName: string | null): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first && first.length > 1 ? first : null;
}

export async function runDailyNotice(opts: { dry: boolean }): Promise<RunResult> {
  const started = Date.now();
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: 503, body: { error: "Storage not configured" } };
  }
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .eq("sourcing_alerts", true)
    .not("welcome_checked_at", "is", null)
    .is("daily_notice_sent_at", null)
    .not("email", "is", null)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) return { status: 500, body: { error: `profiles read failed (schema behind?): ${error.message}` } };
  const rows = (data ?? []) as Row[];
  if (opts.dry) {
    return { status: 200, body: { dry: true, audience: rows.length, sample: rows.slice(0, SAMPLE).map((r) => r.email), ms: Date.now() - started } };
  }
  const now = new Date();
  if (now.getUTCHours() * 60 + now.getUTCMinutes() < LOW_CREDIT_ALONE_FROM_MINUTE_UTC) {
    return { status: 400, body: { error: "Press this after 08:30 UTC: before then it would take the day's slot from that morning's daily email." } };
  }
  const base = siteUrl();
  if (!isEmailConfigured()) return { status: 200, body: { dry: false, audience: rows.length, sent: 0, failed: 0, remaining: rows.length, error: "email_not_configured" } };
  let sent = 0;
  let failed = 0;
  // Already had today's email: left for a later press.
  let capped = 0;
  const failures: string[] = [];
  let i = 0;
  for (; i < rows.length; i += 1) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const r = rows[i];
    if (!r.email) continue;
    const claim = await claimSlot(admin, r.id, "notice");
    if (!claim.ok && claim.reason === "slot_used") {
      capped += 1;
      continue;
    }
    const claimId = claim.ok ? claim.id : null;
    const mail = dailyNoticeEmail({ siteUrl: base, firstName: firstNameOf(r.full_name) });
    // The one-click unsubscribe token, stored with the slot (a slot the table could not record gets no link).
    const token = claimId ? newSendToken() : null;
    const unsubscribeUrl = token ? `${base.replace(/\/$/, "")}/api/notify/unsubscribe/${token}` : null;
    if (claimId && !(await markSending(admin, claimId, { notice: "daily_picks" }, token))) {
      await releaseClaim(admin, claimId);
      capped += 1;
      continue;
    }
    // Always under the slot's key, claimed or not: a slot the table could not
    // record still cannot be sent a second, different daily email.
    const res = await sendEmail({ to: r.email, subject: mail.subject, html: mail.html, text: mail.text, ...(unsubscribeUrl ? { headers: listUnsubscribeHeaders({ url: unsubscribeUrl, oneClickUrl: unsubscribeUrl }) } : {}), idempotencyKey: sendKey("daily", r.id, claim.ok ? claim.day : capDay()) });
    if (claimId) {
      if (res.sent) await finishSend(admin, claimId, true, null, []);
      else await abandonSend(admin, claimId);
    }
    if (!res.sent) {
      failed += 1;
      if (failures.length < SAMPLE) failures.push(`${r.email} (${res.reason ?? "failed"})`);
      continue;
    }
    // Stamped after the send: a send that was accepted but not recorded would
    // repeat, and that is the worse mistake here.
    const { error: stampErr } = await admin.from("profiles").update({ daily_notice_sent_at: new Date().toISOString() }).eq("id", r.id);
    if (stampErr) console.error("[daily-notice] stamp failed:", stampErr.message);
    sent += 1;
  }
  const remaining = rows.length - i + failed + capped;
  return { status: 200, body: { dry: false, audience: rows.length, sent, failed, capped, failures, remaining, ranOutOfTime: i < rows.length, ms: Date.now() - started } };
}
