import "server-only";

import { createAdminClient } from "../supabase/admin";
import { getBalance } from "../credit/ledger";
import { payerIn } from "../team";
import { payersForAll } from "../notify/daily-server";
import { getBillingSettings } from "../credit/unit-costs";
import { dailyDealsMode } from "./daily-deals";
import { areaMetaForCode } from "../market/areas";
import { sendEmail, isEmailConfigured } from "../email/send";
import { siteUrl } from "../url";
import { missesToList, missedPickLine, pausedEmail, pausedEmailDue, type MissedPick } from "./picks-paused";
import { changesPhrase, changesSection, type ChangeInput } from "../notify/message";
import { renderSections, listUnsubscribeHeaders } from "../notify/render-email";
import { claimSlot, finishSend, markSending, releaseClaim, slotsInUse } from "../notify/sends";
import { capDay, newSendToken, sendKey } from "../notify/cap";
import { pendingChanges, trackedAlertsOn } from "../notify/alerts-server";
import type { RunResult } from "./picks-run";
import { allProfilesFor } from "../profiles/server";
import { labelFor } from "../profiles/rules";
import { starterPackStateFor } from "../starter-pack/server";
import { awayLetter } from "../inactivity/letter";

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
// The letter goes INSTEAD of the daily email (Batch 6): it takes the day's
// one email slot (src/lib/notify/cap.ts), so the 08:10 digest skips the
// member, and it carries the changes on deals they track that the daily
// email would have carried. A member whose slot is already spent today is
// left for the next run, when the letter is still due.
//
// Saved profiles (Batch 13): still one letter per member; once they have two
// profiles, each missed pick and each change names the profile it was for.
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
  // Which profile each miss was for, read apart so an older schema reads the
  // queue exactly as before (unlabelled), and the members' profiles for names.
  const missProfile = new Map<string, string>();
  const profileRows = await allProfilesFor(admin, ids);
  if (profileRows) {
    const missIds = [...byUser.values()].flat().map((r) => r.id);
    for (const some of chunk(missIds, ID_CHUNK)) {
      const { data: tags, error: tagErr } = await admin.from("sourcing_missed").select("id, profile_id").in("id", some).not("profile_id", "is", null);
      if (tagErr) {
        console.warn("[picks-paused] miss profiles unreadable:", tagErr.message);
        break;
      }
      for (const t of (tags ?? []) as { id: string; profile_id: string }[]) missProfile.set(t.id, t.profile_id);
    }
  }

  const profiles = new Map<string, ProfileRow>();
  for (const some of chunk(ids, ID_CHUNK)) {
    const { data: rows, error: pErr } = await admin.from("profiles").select("id, email, full_name, sourcing_alerts, alert_credit, sourcing_last_sent_at, picks_paused_email_at").in("id", some);
    if (pErr) return done({ status: 500, body: { error: `profiles read failed (schema behind?): ${pErr.message}` } });
    for (const p of (rows ?? []) as ProfileRow[]) profiles.set(p.id, p);
  }
  // In chunks: one lookup for the whole list is a request too long to send.
  const payers = await payersForAll(ids);
  const perDay = dailyDealsMode((await getBillingSettings()).dealPricing, now) === "per_day";
  // What the daily email would have carried: the changes on deals they track.
  const [alertsOn, pending, slots] = await Promise.all([trackedAlertsOn(admin, ids), pendingChanges(admin, ids, now), slotsInUse(admin, ids, "daily", now)]);

  const summary = { dry: opts.dry, considered: ids.length, emails: 0, emailFailures: 0, superseded: 0, ranOutOfTime: false };
  const perUser: { user: string; email: string | null; picks: number; sent: boolean; reason?: string }[] = [];
  const wouldEmail: { email: string; picks: number; lines: string[]; changes: { id: string; type: string }[]; slot: string; pack: boolean }[] = [];
  for (const [userId, rows] of byUser) {
    if (elapsed() > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      break;
    }
    const p = profiles.get(userId) ?? null;
    const skip = (reason: string) => perUser.push({ user: userId, email: p?.email ?? null, picks: rows.length, sent: false, reason });
    // A member who will never get this letter for these misses (no email,
    // picks or the letter switched off, a team member) has them superseded
    // now. Left open they would sit at the head of the queue, oldest first,
    // until they filled the whole read and starved everyone else's letter.
    const retire = async (reason: string) => {
      skip(reason);
      if (opts.dry) return;
      const { error: supErr } = await admin.from("sourcing_missed").update({ superseded_at: now.toISOString() }).in("id", rows.map((r) => r.id));
      if (supErr) console.error("[picks-paused] supersede failed:", supErr.message);
      else summary.superseded += rows.length;
    };
    if (!p || !p.email) {
      await retire("no_email");
      continue;
    }
    if (p.sourcing_alerts === false) {
      await retire("picks_off");
      continue;
    }
    if (p.alert_credit === false) {
      await retire("switched_off");
      continue;
    }
    if (payerIn(payers, userId).memberId) {
      await retire("team_member");
      continue;
    }
    const { list, superseded } = missesToList(
      rows.map((r) => ({ ...toMissed(r), profileName: labelFor(profileRows?.get(userId), missProfile.get(r.id)) })),
      p.sourcing_last_sent_at,
    );
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
    if (slots?.has(userId)) {
      skip("slot_used");
      continue;
    }
    // Batch 20: a new member who can still buy the starter pack is offered it instead of "top up".
    const packState = await starterPackStateFor(userId);
    const pack = packState.offer.eligible ? { body: packState.copy.body, cta: packState.copy.cardCta } : null;
    const base = siteUrl();
    // The letter with (or, when its delivery cannot be recorded, without) the
    // changes on deals they track. Built after the claim, so changes only ever
    // ride a letter whose slot records them as told.
    const letter = (withChanges: boolean) => {
      const settled = withChanges && alertsOn.has(userId) ? pending.get(userId) ?? null : null;
      const given = (settled?.changes ?? []).map((c) => ({ ...c, profileName: labelFor(profileRows?.get(userId), c.profileId) }));
      const { section: changes, used } = changesSection(given, base);
      const ids = (list: readonly ChangeInput[]) => list.flatMap((c) => [c.id, ...(c.mergedIds ?? [])]);
      const extra = changes ? { ...renderSections([changes]), subjectSuffix: changesPhrase(used) } : null;
      return {
        mail: pausedEmail({ misses: list, siteUrl: base, firstName: firstNameOf(p.full_name), extra, perDay, pack }),
        used,
        // What a sent letter closes: what it told, what it would not tell, what settling dismissed.
        closing: [...new Set([...ids(used), ...ids(given.filter((c) => !used.includes(c))), ...(settled?.dismissed ?? [])])],
      };
    };
    if (opts.dry) {
      const preview = letter(true);
      wouldEmail.push({ email: p.email, picks: list.length, lines: list.map(missedPickLine), changes: preview.used.map((c) => ({ id: c.id, type: c.alertType })), slot: slots === null ? "unreadable" : "free", pack: pack !== null });
      perUser.push({ user: userId, email: p.email, picks: list.length, sent: false, reason: "would_send" });
      continue;
    }
    if (!isEmailConfigured()) {
      skip("email_not_configured");
      continue;
    }
    // The day's slot. A cap table the schema has not caught up with does not
    // stop the letter: it goes as it did before this batch, without changes,
    // and still under the slot's idempotency key, so no second daily email
    // can follow it once the table is readable again.
    const claim = await claimSlot(admin, userId, "picks_paused", now);
    if (!claim.ok && claim.reason === "slot_used") {
      skip("slot_used");
      continue;
    }
    const claimId = claim.ok ? claim.id : null;
    const { mail, used, closing } = letter(claimId !== null);
    const unsubscribeToken = claimId ? newSendToken() : null;
    const unsubscribeUrl = unsubscribeToken ? `${base.replace(/\/$/, "")}/api/notify/unsubscribe/${unsubscribeToken}` : null;
    const sendSummary = { misses: list.length, alerts: used.flatMap((c) => [c.id, ...(c.mergedIds ?? [])]), subject: mail.subject, ...(pack ? { pack: true } : {}) };
    if (claimId && !(await markSending(admin, claimId, sendSummary, unsubscribeToken))) {
      await releaseClaim(admin, claimId);
      skip("slot_unwritable");
      continue;
    }
    const res = await sendEmail({
      to: p.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(unsubscribeUrl ? { headers: listUnsubscribeHeaders({ url: unsubscribeUrl, oneClickUrl: unsubscribeUrl }) } : {}),
      idempotencyKey: sendKey("daily", userId, claim.ok ? claim.day : capDay(now)),
    });
    if (!res.sent) {
      summary.emailFailures += 1;
      if (claimId) await finishSend(admin, claimId, false, sendSummary, []);
      skip(res.reason ?? "send_failed");
      continue;
    }
    if (claimId) await finishSend(admin, claimId, true, sendSummary, closing);
    summary.emails += 1;
    const sentAt = new Date().toISOString();
    const { error: profErr } = await admin.from("profiles").update({ picks_paused_email_at: sentAt }).eq("id", userId);
    if (profErr) console.error("[picks-paused] profile stamp failed:", profErr.message);
    const { error: rowErr } = await admin.from("sourcing_missed").update({ emailed_at: sentAt }).in("id", list.map((m) => m.id!));
    if (rowErr) console.error("[picks-paused] emailed stamp failed:", rowErr.message);
    perUser.push({ user: userId, email: p.email, picks: list.length, sent: true });
  }

  // Batch 20, Part C: "while you're away", after the out-of-credit letters and in the same budget.
  const away = await runAwayLetters(admin, { dry: opts.dry, now, deadline: started + TIME_BUDGET_MS });
  summary.emails += away.emails;
  summary.emailFailures += away.failures;
  if (away.ranOutOfTime) summary.ranOutOfTime = true;
  return done({ status: 200, body: { ...summary, ms: elapsed(), members: perUser, wouldEmail, away: { considered: away.considered, emails: away.emails, members: away.members, ...(opts.dry ? { wouldEmail: away.wouldEmail } : {}) } } });
}

/**
 * Batch 20, Part C: one "while you're away" letter per inactivity pause
 * (profiles.picks_paused_inactive_at set by the nightly, the letter stamped in
 * picks_paused_inactive_email_at). Only while both "Daily picks" and "Picks
 * paused / out of credit" are on. It takes the day's daily slot and carries
 * that day's changes, as the out-of-credit letter does; a slot already used
 * today leaves it for tomorrow. Every read of the Batch 20 columns is its own
 * query: before the schema is run, nothing is sent.
 */
async function runAwayLetters(admin: ReturnType<typeof createAdminClient>, opts: { dry: boolean; now: Date; deadline: number }) {
  const result = { considered: 0, emails: 0, failures: 0, ranOutOfTime: false, members: [] as { user: string; sent: boolean; reason?: string }[], wouldEmail: [] as { email: string; changes: { id: string; type: string }[]; team: boolean }[] };
  const { data: due, error } = await admin.from("profiles").select("id").not("picks_paused_inactive_at", "is", null).is("picks_paused_inactive_email_at", null).limit(2000);
  if (error) {
    console.warn("[picks-paused] away letters skipped (schema not run?):", error.message);
    return result;
  }
  const ids = ((due ?? []) as { id: string }[]).map((r) => r.id);
  result.considered = ids.length;
  if (ids.length === 0) return result;
  const rows: { id: string; email: string | null; full_name: string | null; sourcing_alerts: boolean | null; alert_credit: boolean | null }[] = [];
  for (const some of chunk(ids, ID_CHUNK)) {
    const { data, error: pErr } = await admin.from("profiles").select("id, email, full_name, sourcing_alerts, alert_credit").in("id", some);
    if (pErr) {
      console.error("[picks-paused] away profiles read failed:", pErr.message);
      return result;
    }
    rows.push(...((data ?? []) as typeof rows));
  }
  const [payers, alertsOn, pending, slots, profileRows] = await Promise.all([payersForAll(ids), trackedAlertsOn(admin, ids), pendingChanges(admin, ids, opts.now), slotsInUse(admin, ids, "daily", opts.now), allProfilesFor(admin, ids)]);
  const base = siteUrl();
  for (const p of rows) {
    if (Date.now() > opts.deadline) {
      result.ranOutOfTime = true;
      break;
    }
    const skip = (reason: string) => result.members.push({ user: p.id, sent: false, reason });
    if (!p.email) {
      skip("no_email");
      continue;
    }
    if (p.sourcing_alerts !== true) {
      skip("picks_off");
      continue;
    }
    if (p.alert_credit === false) {
      skip("switched_off");
      continue;
    }
    const payer = payerIn(payers, p.id);
    if (payer.suspended) {
      skip("seat_suspended");
      continue;
    }
    if (slots?.has(p.id)) {
      skip("slot_used");
      continue;
    }
    const letter = (withChanges: boolean) => {
      const settled = withChanges && alertsOn.has(p.id) ? pending.get(p.id) ?? null : null;
      const given = (settled?.changes ?? []).map((c) => ({ ...c, profileName: labelFor(profileRows?.get(p.id), c.profileId) }));
      const { section: changes, used } = changesSection(given, base);
      const idsOf = (list: readonly ChangeInput[]) => list.flatMap((c) => [c.id, ...(c.mergedIds ?? [])]);
      const extra = changes ? { ...renderSections([changes]), subjectSuffix: changesPhrase(used) } : null;
      return {
        mail: awayLetter({ siteUrl: base, firstName: firstNameOf(p.full_name), team: Boolean(payer.memberId), extra }),
        used,
        closing: [...new Set([...idsOf(used), ...idsOf(given.filter((c) => !used.includes(c))), ...(settled?.dismissed ?? [])])],
      };
    };
    if (opts.dry) {
      const preview = letter(true);
      result.wouldEmail.push({ email: p.email, changes: preview.used.map((c) => ({ id: c.id, type: c.alertType })), team: Boolean(payer.memberId) });
      skip("would_send");
      continue;
    }
    if (!isEmailConfigured()) {
      skip("email_not_configured");
      continue;
    }
    const claim = await claimSlot(admin, p.id, "picks_paused", opts.now);
    if (!claim.ok) {
      skip(claim.reason);
      continue;
    }
    const { mail, used, closing } = letter(true);
    const unsubscribeToken = newSendToken();
    const unsubscribeUrl = `${base.replace(/\/$/, "")}/api/notify/unsubscribe/${unsubscribeToken}`;
    const sendSummary = { away: true, alerts: used.flatMap((c) => [c.id, ...(c.mergedIds ?? [])]), subject: mail.subject };
    if (!(await markSending(admin, claim.id, sendSummary, unsubscribeToken))) {
      await releaseClaim(admin, claim.id);
      skip("slot_unwritable");
      continue;
    }
    const res = await sendEmail({ to: p.email, subject: mail.subject, html: mail.html, text: mail.text, headers: listUnsubscribeHeaders({ url: unsubscribeUrl, oneClickUrl: unsubscribeUrl }), idempotencyKey: sendKey("daily", p.id, claim.day) });
    await finishSend(admin, claim.id, res.sent, sendSummary, res.sent ? closing : []);
    if (!res.sent) {
      result.failures += 1;
      skip(res.reason ?? "send_failed");
      continue;
    }
    result.emails += 1;
    const { error: stampErr } = await admin.from("profiles").update({ picks_paused_inactive_email_at: new Date().toISOString() }).eq("id", p.id);
    if (stampErr) console.error("[picks-paused] away stamp failed:", stampErr.message);
    result.members.push({ user: p.id, sent: true });
  }
  return result;
}
