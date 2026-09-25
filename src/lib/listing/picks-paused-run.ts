import "server-only";

import { createAdminClient } from "../supabase/admin";
import { getBalance } from "../credit/ledger";
import { payersFor, payerIn } from "../team";
import { areaMetaForCode } from "../market/areas";
import { sendEmail, isEmailConfigured } from "../email/send";
import { siteUrl } from "../url";
import { missesToList, missedPickLine, pausedEmail, pausedEmailDue, type MissedPick } from "./picks-paused";
import type { RunResult } from "./picks-run";

// ─── "Your picks have paused": the run ────────────────────────────────
// The daily-picks run records, for every member it could not send to for
// want of credit, the pick they would have had (sourcing_missed: figures
// only). This run, after the last picks pass, turns those rows into one
// letter per member under the rules in picks-paused.ts: on the first day,
// then at most every seven days, listing everything missed since the last
// letter, and never once they have credit again. Team members are skipped
// (their owner pays, and already gets the out-of-credit email); so is anyone
// who switched "picks paused / out of credit" or daily picks off.
//
// Entry points: /api/internal/picks-paused (the cron, secret-gated, ?dry=1)
// and the admin page's dry-run button (session-gated).

const TIME_BUDGET_MS = 50_000;
const ID_CHUNK = 100;

type MissRow = {
  id: string;
  user_id: string;
  missed_at: string;
  kind: string;
  postcode_area: string | null;
  bedrooms: number | null;
  price_amount: number | string | null;
  price_period: string | null;
  annual_profit: number | string | null;
  need_pence: number | string | null;
  emailed_at: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  sourcing_alerts: boolean | null;
  alert_credit: boolean | null;
  sourcing_last_sent_at: string | null;
  picks_paused_email_at: string | null;
};

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function num(v: number | string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toMissed(r: MissRow): MissedPick {
  return {
    id: r.id,
    missedAt: r.missed_at,
    kind: r.kind === "rent" ? "rent" : "sale",
    areaName: r.postcode_area ? areaMetaForCode(r.postcode_area).name : "your area",
    bedrooms: r.bedrooms,
    priceAmount: num(r.price_amount),
    pricePeriod: r.price_period === "pcm" ? "pcm" : r.price_period === "total" ? "total" : null,
    annualProfit: num(r.annual_profit),
    emailedAt: r.emailed_at,
  };
}

function firstNameOf(fullName: string | null): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first && first.length > 1 ? first : null;
}

export async function runPausedEmails(opts: { dry: boolean }): Promise<RunResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const done = (result: RunResult): RunResult => {
    const rest = Object.fromEntries(Object.entries(result.body).filter(([k]) => k !== "members" && k !== "wouldEmail"));
    console.log("[picks-paused] run", JSON.stringify({ status: result.status, ms: elapsed(), ...rest }));
    return result;
  };
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return done({ status: 503, body: { error: "Storage not configured" } });
  }
  const now = new Date();

  const { data, error } = await admin
    .from("sourcing_missed")
    .select("id, user_id, missed_at, kind, postcode_area, bedrooms, price_amount, price_period, annual_profit, need_pence, emailed_at")
    .is("emailed_at", null)
    .is("superseded_at", null)
    .order("missed_at", { ascending: true })
    .limit(5000);
  if (error) return done({ status: 500, body: { error: `sourcing_missed read failed (schema behind?): ${error.message}` } });
  const byUser = new Map<string, MissRow[]>();
  for (const r of (data ?? []) as MissRow[]) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  const ids = [...byUser.keys()];

  const profiles = new Map<string, ProfileRow>();
  for (const some of chunk(ids, ID_CHUNK)) {
    const { data: rows, error: pErr } = await admin.from("profiles").select("id, email, full_name, sourcing_alerts, alert_credit, sourcing_last_sent_at, picks_paused_email_at").in("id", some);
    if (pErr) return done({ status: 500, body: { error: `profiles read failed (schema behind?): ${pErr.message}` } });
    for (const p of (rows ?? []) as ProfileRow[]) profiles.set(p.id, p);
  }
  const payers = await payersFor(ids);

  const summary = { dry: opts.dry, considered: ids.length, emails: 0, emailFailures: 0, superseded: 0, ranOutOfTime: false };
  const perUser: { user: string; email: string | null; picks: number; sent: boolean; reason?: string }[] = [];
  const wouldEmail: { email: string; picks: number; lines: string[] }[] = [];
  for (const [userId, rows] of byUser) {
    if (elapsed() > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      break;
    }
    const p = profiles.get(userId) ?? null;
    const skip = (reason: string) => perUser.push({ user: userId, email: p?.email ?? null, picks: rows.length, sent: false, reason });
    if (!p || !p.email) {
      skip("no_email");
      continue;
    }
    if (p.sourcing_alerts === false) {
      skip("picks_off");
      continue;
    }
    if (p.alert_credit === false) {
      skip("switched_off");
      continue;
    }
    if (payerIn(payers, userId).memberId) {
      skip("team_member");
      continue;
    }
    const { list, superseded } = missesToList(rows.map(toMissed), p.sourcing_last_sent_at);
    if (superseded.length > 0 && !opts.dry) {
      const { error: supErr } = await admin.from("sourcing_missed").update({ superseded_at: now.toISOString() }).in("id", superseded.map((m) => m.id!));
      if (supErr) console.error("[picks-paused] supersede failed:", supErr.message);
      else summary.superseded += superseded.length;
    }
    if (list.length === 0) {
      skip("nothing_new");
      continue;
    }
    // Stop as soon as they have credit again: the next picks run will send
    // to them instead, and these misses are superseded by that pick.
    const listed = new Set(list.map((m) => m.id));
    const need = Math.max(0, ...rows.filter((r) => listed.has(r.id)).map((r) => num(r.need_pence) ?? 0));
    const bal = await getBalance(userId).catch(() => null);
    if (!bal) {
      skip("balance_unknown");
      continue;
    }
    if (need > 0 ? bal.spendableBasePence >= need : bal.spendableBasePence > 0) {
      skip("has_credit");
      continue;
    }
    if (!pausedEmailDue({ lastEmailAt: p.picks_paused_email_at, lastPickSentAt: p.sourcing_last_sent_at, now })) {
      skip("not_due");
      continue;
    }
    const mail = pausedEmail({ misses: list, siteUrl: siteUrl(), firstName: firstNameOf(p.full_name) });
    if (opts.dry) {
      wouldEmail.push({ email: p.email, picks: list.length, lines: list.map(missedPickLine) });
      perUser.push({ user: userId, email: p.email, picks: list.length, sent: false, reason: "would_send" });
      continue;
    }
    if (!isEmailConfigured()) {
      skip("email_not_configured");
      continue;
    }
    const res = await sendEmail({ to: p.email, subject: mail.subject, html: mail.html, text: mail.text });
    if (!res.sent) {
      summary.emailFailures += 1;
      skip(res.reason ?? "send_failed");
      continue;
    }
    summary.emails += 1;
    const sentAt = new Date().toISOString();
    const { error: profErr } = await admin.from("profiles").update({ picks_paused_email_at: sentAt }).eq("id", userId);
    if (profErr) console.error("[picks-paused] profile stamp failed:", profErr.message);
    const { error: rowErr } = await admin.from("sourcing_missed").update({ emailed_at: sentAt }).in("id", list.map((m) => m.id!));
    if (rowErr) console.error("[picks-paused] emailed stamp failed:", rowErr.message);
    perUser.push({ user: userId, email: p.email, picks: list.length, sent: true });
  }

  return done({ status: 200, body: { ...summary, ms: elapsed(), members: perUser, wouldEmail } });
}
