import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { CHANNEL_LABEL, GAP_SAMPLES_MAX, GAP_SCHEDULE_TEXT, type KbChannel } from "@/lib/knowledge/config";
import { checkContent, contentHash } from "@/lib/knowledge/render";
import { entryStatus, liveContent, pendingContent, type KnowledgeRow } from "@/lib/knowledge/rows";
import { DEFAULT_KNOWLEDGE_SETTINGS, KNOWLEDGE_SETTING_BOUNDS as B } from "@/lib/knowledge/settings";
import { allEntries, readGlobalSnapshot, readKnowledgeSettings } from "@/lib/knowledge/store-server";
import { redactQuestion } from "@/lib/knowledge/gap/prompts";
import { gapJobEnabled, monthSpendPence } from "@/lib/knowledge/gap/run";
import { modelsConfigured } from "@/lib/knowledge/gap/models-server";
import { oneOf } from "../../picks/responses/windows";
import { readFlash } from "../flash";
import { addVariantsAction, approveGapAction, dismissGapAction, rejectGapAction, runGapJobAction, saveGapSettingsAction } from "../actions";
import { BUTTON, BUTTON_QUIET, CARD, FlashBox, SiAdminNav, when } from "../SiAdmin";

export const metadata: Metadata = { title: "Gaps — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
// "Run now" and "Dry run" run the nightly job in this page's server action (it stops drafting at 240 s).
export const maxDuration = 300;

type GapStatus = "open" | "drafted" | "covered" | "rejected" | "dismissed" | "failed";

interface Gap {
  id: string;
  label: string;
  status: GapStatus;
  entry_id: string | null;
  match_kind: string | null;
  asked: number;
  asked_since_decision: number;
  channels: Record<string, number> | null;
  outcomes: Record<string, number> | null;
  draft_attempts: number;
  last_error: string | null;
  uncovered: boolean;
  first_asked_at: string | null;
  last_asked_at: string | null;
  decided_at: string | null;
}

interface RunRow {
  id: string;
  kind: string;
  run_key: string;
  status: string;
  claimed_at: string;
  finished_at: string | null;
  cost_pence: number | string;
  report: Record<string, unknown> | null;
}

const VIEWS = [
  { key: "review", label: "Needs you" },
  { key: "open", label: "Waiting for a draft" },
  { key: "again", label: "Asked again after a decision" },
  { key: "covered", label: "Covered" },
  { key: "rejected", label: "Rejected" },
  { key: "failed", label: "Couldn't be drafted" },
  { key: "dismissed", label: "Dismissed" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const STATUS_BADGE: Record<GapStatus, string> = {
  open: "bg-amber-100 text-amber-900",
  drafted: "bg-sky-100 text-sky-900",
  covered: "bg-emerald-100 text-emerald-900",
  rejected: "bg-muted text-muted-foreground",
  dismissed: "bg-muted text-muted-foreground",
  failed: "bg-red-100 text-red-900",
};
const STATUS_TEXT: Record<GapStatus, string> = { open: "Open", drafted: "Drafted", covered: "Covered", rejected: "Rejected", dismissed: "Dismissed", failed: "Couldn't be drafted" };
const OUTCOME_TEXT: Record<string, string> = { low_confidence: "unsure", could_not_answer: "couldn't answer", member_unhappy: "member unhappy" };
const INPUT = "rounded-md border border-border bg-background px-2 py-1 text-sm";

function inView(g: Gap, v: View, entry: KnowledgeRow | undefined): boolean {
  switch (v) {
    case "review":
      // A draft waiting for approval, or a decided gap people keep asking.
      return (g.status === "drafted" && entry?.draft_state === "pending") || ((g.status === "covered" || g.status === "rejected") && g.asked_since_decision > 0);
    case "open":
      return g.status === "open";
    case "again":
      return (g.status === "covered" || g.status === "rejected") && g.asked_since_decision > 0;
    default:
      return g.status === v;
  }
}

const counts = (m: Record<string, number> | null, labels: Record<string, string>) =>
  Object.entries(m ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${labels[k] ?? k} ${n}`)
    .join(" · ");

/** Raw spend in pounds to the penny (a night costs pennies, so whole-pence rounding would hide it). */
const pence = (n: number) => `£${(Math.max(0, n) / 100).toFixed(2)}`;

/**
 * Batch 24: the questions Stayful Intelligence couldn't answer, grouped by
 * the nightly job, each with the answer it drafted. Approve puts a draft
 * live on its channels at once (and re-syncs the phone agent); Edit opens
 * the entry; Reject is remembered, so the same answer is never drafted
 * again; Add as variants teaches an approved answer new phrasings; Dismiss
 * drops a gap that isn't worth an answer. Also: this month's model spend
 * against the cap, the last runs, Dry run / Estimate / Run now, and the
 * job's limits. Nothing here reaches a member until it is approved.
 */
export default async function GapsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/intelligence/gaps");
  if (!isAdminEmail(user.email)) notFound();

  const requested = oneOf(params.view) ?? "review";
  const view: View = (VIEWS.some((v) => v.key === requested) ? requested : "review") as View;
  const ready = hasServiceRole();
  const admin = ready ? createAdminClient() : null;
  const now = new Date();

  const [settings, spent, runsRes, gapsRes, rows, g, flash] = await Promise.all([
    admin ? readKnowledgeSettings(admin) : DEFAULT_KNOWLEDGE_SETTINGS,
    admin ? monthSpendPence(admin, now) : null,
    admin ? admin.from("si_gap_runs").select("id, kind, run_key, status, claimed_at, finished_at, cost_pence, report").order("claimed_at", { ascending: false }).limit(10) : null,
    admin
      ? admin
          .from("si_knowledge_gaps")
          .select("id, label, status, entry_id, match_kind, asked, asked_since_decision, channels, outcomes, draft_attempts, last_error, uncovered, first_asked_at, last_asked_at, decided_at")
          .order("asked", { ascending: false })
          .order("last_asked_at", { ascending: false })
          .limit(500)
      : null,
    admin ? allEntries(admin) : null,
    admin ? readGlobalSnapshot(admin) : null,
    readFlash(),
  ]);
  const runs = (runsRes?.data ?? []) as RunRow[];
  const allGaps = (gapsRes?.data ?? []) as Gap[];
  const readError = !admin || gapsRes?.error || !rows;
  const entries = new Map((rows ?? []).map((r) => [r.id, r]));
  const viewCounts = Object.fromEntries(VIEWS.map((v) => [v.key, allGaps.filter((x) => inView(x, v.key, x.entry_id ? entries.get(x.entry_id) : undefined)).length])) as Record<View, number>;
  const shown = allGaps.filter((x) => inView(x, view, x.entry_id ? entries.get(x.entry_id) : undefined)).slice(0, 100);

  // Up to GAP_SAMPLES_MAX phrasings per shown gap, newest first.
  const samples = new Map<string, string[]>();
  if (admin && shown.length) {
    const { data } = await admin
      .from("si_knowledge_gap_questions")
      .select("gap_id, si_conversation_questions(question, at)")
      .in("gap_id", shown.map((x) => x.id))
      .limit(3000);
    const byGap = new Map<string, { question: string; at: string }[]>();
    for (const r of (data ?? []) as unknown as { gap_id: string; si_conversation_questions: { question: string; at: string } | { question: string; at: string }[] | null }[]) {
      const q = Array.isArray(r.si_conversation_questions) ? r.si_conversation_questions[0] : r.si_conversation_questions;
      if (!q) continue;
      byGap.set(r.gap_id, [...(byGap.get(r.gap_id) ?? []), q]);
    }
    for (const [id, qs] of byGap) samples.set(id, [...new Set(qs.sort((a, b) => b.at.localeCompare(a.at)).map((q) => redactQuestion(q.question)))].slice(0, GAP_SAMPLES_MAX));
  }

  const enabled = gapJobEnabled();
  const keyed = modelsConfigured();
  const cap = settings.gapMonthlyCapPence;
  const share = spent !== null && cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : null;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <SiAdminNav current="gaps" />
      <FlashBox flash={flash} />
      <h1 className="text-2xl font-semibold text-foreground">Gaps</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        The questions Stayful Intelligence couldn&apos;t answer, grouped each night, with an answer drafted from the service facts. Nothing here reaches a member until you approve it; a rejected answer is never drafted again.
      </p>

      {readError && <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">The gaps can&apos;t be read. Run the &quot;Batch 24&quot; section of supabase/schema.sql.</p>}

      <section className={`mt-6 ${CARD}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">The nightly job</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {GAP_SCHEDULE_TEXT}. {enabled ? "On." : "Off (SI_GAP_JOB_ENABLED is not \"true\"): Dry run and Estimate still work."} {keyed ? "" : "No ANTHROPIC_API_KEY: only Estimate can run."}
            </p>
            <p className="mt-2 text-sm">
              Model spend this month: <strong>{spent === null ? "can't be read" : pence(spent)}</strong> of {pence(cap)}
              {share !== null && <span className="text-muted-foreground"> ({share}%)</span>}. House spend: never charged to a member.
            </p>
            {share !== null && (
              <div className="mt-2 h-2 w-64 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className={`h-full ${share >= 90 ? "bg-red-500" : share >= 60 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${share}%` }} />
              </div>
            )}
          </div>
          <form action={runGapJobAction} className="flex flex-wrap gap-2">
            <button type="submit" name="mode" value="estimate" className={BUTTON_QUIET} disabled={!!readError}>Estimate (no model calls)</button>
            <button type="submit" name="mode" value="dry" className={BUTTON_QUIET} disabled={!!readError || !keyed}>Dry run</button>
            <button type="submit" name="mode" value="run" className={BUTTON} disabled={!!readError || !keyed || !enabled}>Run now</button>
          </form>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">A dry run makes the model calls (so it can show real groups and drafts; its cost counts against the cap) and writes nothing else. Run now uses the same once-a-day claim as the cron, so it never runs twice in a UK day.</p>

        {runs.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-1 pr-3">Started</th><th className="pr-3">Kind</th><th className="pr-3">Status</th><th className="pr-3">Questions</th><th className="pr-3">Groups</th><th className="pr-3">Drafts</th><th className="pr-3">Cost</th><th>Note</th></tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const rep = r.report ?? {};
                  const num = (k: string) => (typeof rep[k] === "number" ? (rep[k] as number) : "—");
                  return (
                    <tr key={r.id} className="border-t border-border">
                      <td className="py-1 pr-3 text-xs">{when(r.claimed_at)}</td>
                      <td className="pr-3">{r.kind}</td>
                      <td className="pr-3">{r.status}</td>
                      <td className="pr-3">{num("questions")}</td>
                      <td className="pr-3">{num("groups")}</td>
                      <td className="pr-3">{num("drafts")}</td>
                      <td className="pr-3">{(Number(r.cost_pence) || 0).toFixed(2)}p</td>
                      <td className="text-xs text-muted-foreground">{[rep.stopped ? `stopped: ${String(rep.stopped)}` : "", rep.error ? String(rep.error) : "", rep.triggeredBy ? `by ${String(rep.triggeredBy)}` : ""].filter(Boolean).join(" · ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <form action={saveGapSettingsAction} className="mt-5 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-4">
          <label className="text-sm">Drafts a night<input name="gapMaxGroupsPerNight" type="number" min={B.gapMaxGroupsPerNight.min} max={B.gapMaxGroupsPerNight.max} step={1} defaultValue={settings.gapMaxGroupsPerNight} className={`mt-1 block w-full ${INPUT}`} /></label>
          <label className="text-sm">Questions read a night<input name="gapMaxQuestions" type="number" min={B.gapMaxQuestions.min} max={B.gapMaxQuestions.max} step={1} defaultValue={settings.gapMaxQuestions} className={`mt-1 block w-full ${INPUT}`} /></label>
          <label className="text-sm">Monthly cap (£)<input name="gapMonthlyCapPounds" type="number" min={B.gapMonthlyCapPence.min / 100} max={B.gapMonthlyCapPence.max / 100} step={0.01} defaultValue={(settings.gapMonthlyCapPence / 100).toFixed(2)} className={`mt-1 block w-full ${INPUT}`} /></label>
          <div className="flex items-end">
            <button type="submit" className={BUTTON_QUIET}>Save limits</button>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-4">Decided defaults: {DEFAULT_KNOWLEDGE_SETTINGS.gapMaxGroupsPerNight} drafts, {DEFAULT_KNOWLEDGE_SETTINGS.gapMaxQuestions} questions, {pence(DEFAULT_KNOWLEDGE_SETTINGS.gapMonthlyCapPence)} a month. A cap of £0 stops the model calls.</p>
        </form>
      </section>

      <div className="mt-8 flex flex-wrap gap-2 text-sm">
        {VIEWS.map((v) => (
          <Link key={v.key} href={`?view=${v.key}`} aria-current={v.key === view ? "page" : undefined} className={`rounded-full px-3 py-1 ${v.key === view ? "bg-foreground text-background" : "bg-muted text-foreground hover:opacity-80"}`}>
            {v.label}: {viewCounts[v.key]}
          </Link>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {shown.map((gap) => {
          const entry = gap.entry_id ? entries.get(gap.entry_id) : undefined;
          const pending = entry && entry.draft_state === "pending" ? pendingContent(entry) : null;
          const live = entry ? liveContent(entry) : null;
          const check = pending ? checkContent(pending, g) : null;
          const hashOk = pending && entry ? contentHash(pending) === entry.draft_hash : false;
          const phr = samples.get(gap.id) ?? [];
          const have = new Set([live?.question ?? "", ...(live?.variants ?? [])].map((x) => x.trim().toLowerCase()));
          const newPhrasings = phr.filter((p) => p && !/[{}]/.test(p) && !have.has(p.toLowerCase()));
          const state = entry ? entryStatus(entry) : null;
          return (
            <article key={gap.id} className={CARD}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold text-foreground">{gap.label}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[gap.status]}`}>{STATUS_TEXT[gap.status]}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Asked {gap.asked} time{gap.asked === 1 ? "" : "s"}
                {gap.asked_since_decision > 0 ? `, ${gap.asked_since_decision} since it was ${gap.status === "rejected" ? "rejected" : "answered"}` : ""}
                {" · "}
                {counts(gap.channels, CHANNEL_LABEL as Record<KbChannel, string>) || "—"}
                {" · "}
                {counts(gap.outcomes, OUTCOME_TEXT) || "—"}
                {" · "}first {when(gap.first_asked_at)}, last {when(gap.last_asked_at)}
              </p>
              {phr.length > 0 && (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">How people asked it ({phr.length})</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {phr.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </details>
              )}

              {pending && entry && check && (
                <div className="mt-3 rounded-md border border-sky-300 p-3">
                  <p className="text-xs text-muted-foreground">{gap.uncovered ? "The service facts don't cover this: write the answer yourself, or reject it." : `Drafted ${when(entry.draft_at)}`}{entry.draft_note ? ` · ${entry.draft_note}` : ""}</p>
                  <p className="mt-2 text-sm"><strong>{pending.question}</strong></p>
                  {pending.answer ? <p className="mt-1 font-mono text-xs">{pending.answer}</p> : <p className="mt-1 text-sm text-muted-foreground">(no answer yet)</p>}
                  {check.previews.length > 0 && (
                    <p className="mt-2 rounded-md bg-muted p-2 text-sm"><span className="text-xs text-muted-foreground">As members hear it now: </span>{check.previews[0].answer}</p>
                  )}
                  {check.errors.length > 0 && <p className="mt-2 text-sm text-red-700">Can&apos;t be approved yet: {check.errors.join(" ")}</p>}
                  {check.warnings.length > 0 && <p className="mt-1 text-sm text-amber-800">{check.warnings.join(" ")}</p>}
                  {!hashOk && <p className="mt-1 text-sm text-red-700">This draft&apos;s fingerprint doesn&apos;t match; open it and save it again.</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <form action={approveGapAction}>
                      <input type="hidden" name="id" value={entry.id} />
                      <input type="hidden" name="version" value={entry.version} />
                      <input type="hidden" name="hash" value={entry.draft_hash ?? ""} />
                      <button type="submit" className={BUTTON} disabled={check.errors.length > 0 || !hashOk}>Approve: live on {pending.channels.map((c) => CHANNEL_LABEL[c as KbChannel] ?? c).join(" and ")}</button>
                    </form>
                    <Link href={`/admin/intelligence/knowledge/${entry.id}`} className={BUTTON_QUIET}>Edit, then approve</Link>
                    <form action={rejectGapAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={entry.id} />
                      <input type="hidden" name="version" value={entry.version} />
                      <input name="note" placeholder="Why (optional)" maxLength={300} className={INPUT} />
                      <button type="submit" className={BUTTON_QUIET}>Reject</button>
                    </form>
                  </div>
                </div>
              )}

              {!pending && entry && state === "approved" && (
                <div className="mt-3 text-sm">
                  <p>
                    Answered by <Link href={`/admin/intelligence/knowledge/${entry.id}`} className="text-primary hover:underline">{entry.slug}</Link>
                    {live ? `: ${live.question}` : ""}
                  </p>
                  {newPhrasings.length > 0 && (
                    <form action={addVariantsAction} className="mt-2">
                      <input type="hidden" name="entryId" value={entry.id} />
                      {newPhrasings.map((p, i) => <input key={i} type="hidden" name="phrasing" value={p} />)}
                      <button type="submit" className={BUTTON_QUIET}>Add these {newPhrasings.length} phrasing{newPhrasings.length === 1 ? "" : "s"} as variants</button>
                      <span className="ml-2 text-xs text-muted-foreground">(a draft on the entry; approve it there)</span>
                    </form>
                  )}
                </div>
              )}
              {!pending && entry && state !== "approved" && (
                <p className="mt-3 text-sm">
                  Linked to <Link href={`/admin/intelligence/knowledge/${entry.id}`} className="text-primary hover:underline">{entry.slug}</Link> ({state}
                  {state === "rejected" && entry.draft_note ? `: ${entry.draft_note}` : ""}). {state === "rejected" ? "It won't be drafted again; write an answer on the entry if people keep asking." : ""}
                </p>
              )}
              {!entry && gap.status === "open" && <p className="mt-3 text-sm text-muted-foreground">Waiting for the nightly job to draft an answer{gap.draft_attempts ? ` (${gap.draft_attempts} attempt so far${gap.last_error ? `: ${gap.last_error}` : ""})` : ""}.</p>}
              {gap.status === "failed" && (
                <p className="mt-3 text-sm text-red-700">
                  Couldn&apos;t be drafted after {gap.draft_attempts} attempts{gap.last_error ? ` (${gap.last_error})` : ""}. <Link href="/admin/intelligence/knowledge/new" className="text-primary underline">Write the answer</Link>, or dismiss it.
                </p>
              )}

              {gap.status !== "dismissed" && (
                <form action={dismissGapAction} className="mt-3">
                  <input type="hidden" name="gapId" value={gap.id} />
                  <button type="submit" className="text-xs text-muted-foreground underline hover:text-foreground">Dismiss (not worth an answer)</button>
                </form>
              )}
            </article>
          );
        })}
        {!readError && shown.length === 0 && <p className="text-sm text-muted-foreground">{allGaps.length === 0 ? "No gaps yet: the nightly job groups the questions Stayful Intelligence couldn't answer." : "Nothing here."}</p>}
      </div>
    </div>
  );
}
