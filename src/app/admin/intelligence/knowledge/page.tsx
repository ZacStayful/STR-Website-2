import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { CATEGORY_LABEL, CHANNEL_LABEL, KB_CATEGORIES, KB_CHANNELS, type KbCategory, type KbChannel } from "@/lib/knowledge/config";
import { matchKnowledge } from "@/lib/knowledge/match";
import { renderEntry } from "@/lib/knowledge/render";
import { entryStatus, liveContent, pendingContent, STATUS_LABEL, type EntryStatus, type KnowledgeRow } from "@/lib/knowledge/rows";
import { DEFAULT_KNOWLEDGE_SETTINGS } from "@/lib/knowledge/settings";
import { allEntries, catalogue, checkStale, liveEntries, readGlobalSnapshot, readKnowledgeSettings } from "@/lib/knowledge/store-server";
import { oneOf } from "../../picks/responses/windows";
import { readFlash } from "../flash";
import { saveKnowledgeSettingsAction, seedAction } from "../actions";
import { BUTTON, BUTTON_QUIET, CARD, FlashBox, SiAdminNav, when } from "../SiAdmin";

export const metadata: Metadata = { title: "Knowledge — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATUSES: EntryStatus[] = ["draft", "approved", "stale", "rejected", "retired"];
const BADGE: Record<EntryStatus, string> = {
  draft: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  stale: "bg-red-100 text-red-900",
  rejected: "bg-muted text-muted-foreground",
  retired: "bg-muted text-muted-foreground",
};
const INPUT = "rounded-md border border-border bg-background px-2 py-1 text-sm";

function matches(r: KnowledgeRow, q: string): boolean {
  if (!q) return true;
  const hay = [r.slug, r.question, r.answer, ...(r.variants ?? []), JSON.stringify(r.draft ?? "")].join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/**
 * Batch 24: every knowledge entry, searchable, with its status and stale
 * flag; "try a question" against what is live; the seed one-off; the
 * matching settings and the placeholder catalogue. Every live entry is
 * checked against the settings on each load, and one that no longer
 * resolves is marked stale (hidden from members) here.
 */
export default async function KnowledgeAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/intelligence/knowledge");
  if (!isAdminEmail(user.email)) notFound();

  const q = (oneOf(params.q) ?? "").trim().slice(0, 100);
  const status = oneOf(params.status) ?? "";
  const category = oneOf(params.category) ?? "";
  const channel = oneOf(params.channel) ?? "";
  const ask = (oneOf(params.ask) ?? "").trim().slice(0, 300);

  const ready = hasServiceRole();
  const admin = ready ? createAdminClient() : null;
  const stale = admin ? await checkStale({ dry: false, actor: `admin page (${user.email ?? "admin"})` }, admin) : null;
  const [rows, g, settings, live, flash] = await Promise.all([admin ? allEntries(admin) : null, admin ? readGlobalSnapshot(admin) : null, admin ? readKnowledgeSettings(admin) : DEFAULT_KNOWLEDGE_SETTINGS, admin ? liveEntries(undefined, admin) : null, readFlash()]);

  const list = (rows ?? []).filter((r) => {
    const s = entryStatus(r);
    if (status === "pending" ? r.draft_state !== "pending" : status && s !== status) return false;
    const c = liveContent(r) ?? pendingContent(r);
    if (category && c?.category !== category) return false;
    if (channel && !(c?.channels ?? []).includes(channel)) return false;
    return matches(r, q);
  });
  const counts = Object.fromEntries(STATUSES.map((s) => [s, (rows ?? []).filter((r) => entryStatus(r) === s).length])) as Record<EntryStatus, number>;
  const pendingCount = (rows ?? []).filter((r) => r.draft_state === "pending").length;

  const tried = ask && live ? matchKnowledge(live, ask, { answerMin: settings.answerMinConfidence, lowMin: settings.lowConfidenceMin }) : null;
  const byId = new Map((live ?? []).map((e) => [e.id, e]));

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <SiAdminNav current="knowledge" />
      <FlashBox flash={flash} />
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Knowledge</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Every answer Stayful Intelligence may give, on the chips, on calls and in the chat. Nothing is live until you approve it; every figure is a placeholder read from the settings when the answer is shown, so a price change needs no edit.
          </p>
        </div>
        <Link href="/admin/intelligence/knowledge/new" className={BUTTON}>New entry</Link>
      </div>

      {!rows && <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">The knowledge base can&apos;t be read. Run the &quot;Batch 24&quot; section of supabase/schema.sql.</p>}
      {stale && stale.newlyStale.length > 0 && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-semibold">Marked stale just now (hidden from members until you approve them again):</p>
          <ul className="mt-1 list-disc pl-5">
            {stale.newlyStale.map((s) => (
              <li key={s.id}><Link href={`/admin/intelligence/knowledge/${s.id}`} className="underline">{s.slug}</Link>: {s.reason}</li>
            ))}
          </ul>
        </div>
      )}
      {rows && !g && <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">The settings couldn&apos;t be read just now, so answers are shown to nobody until they can be. Nothing has been marked stale.</p>}

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link key={s} href={`?status=${s}`} className={`rounded-full px-3 py-1 ${BADGE[s]}`}>{STATUS_LABEL[s]}: {counts[s]}</Link>
        ))}
        <Link href="?status=pending" className="rounded-full bg-sky-100 px-3 py-1 text-sky-900">Waiting for approval: {pendingCount}</Link>
        <Link href="?" className="rounded-full px-3 py-1 text-muted-foreground hover:bg-muted">All</Link>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">Search<input name="q" defaultValue={q} className={`ml-2 ${INPUT}`} /></label>
        <label className="text-sm">Status
          <select name="status" defaultValue={status} className={`ml-2 ${INPUT}`}>
            <option value="">Any</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            <option value="pending">Waiting for approval</option>
          </select>
        </label>
        <label className="text-sm">Category
          <select name="category" defaultValue={category} className={`ml-2 ${INPUT}`}>
            <option value="">Any</option>
            {KB_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
        <label className="text-sm">Channel
          <select name="channel" defaultValue={channel} className={`ml-2 ${INPUT}`}>
            <option value="">Any</option>
            {KB_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
          </select>
        </label>
        <button type="submit" className={BUTTON_QUIET}>Filter</button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2">Entry</th><th className="px-3">Status</th><th className="px-3">Category</th><th className="px-3">Channels</th><th className="px-3">Updated</th></tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const s = entryStatus(r);
              const c = liveContent(r) ?? pendingContent(r);
              return (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <Link href={`/admin/intelligence/knowledge/${r.id}`} className="font-medium text-primary hover:underline">{c?.question || r.slug}</Link>
                    <div className="text-xs text-muted-foreground">{r.slug}{r.stale_reason ? ` · ${r.stale_reason}` : ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${BADGE[s]}`}>{STATUS_LABEL[s]}</span>
                    {r.draft_state === "pending" && s !== "draft" && <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900">edit waiting</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">{c && (KB_CATEGORIES as readonly string[]).includes(c.category) ? CATEGORY_LABEL[c.category as KbCategory] : "—"}</td>
                  <td className="px-3 py-2 text-xs">{(c?.channels ?? []).map((x) => CHANNEL_LABEL[x as KbChannel] ?? x).join(", ")}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{when(r.updated_at)}</td>
                </tr>
              );
            })}
            {rows && list.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-muted-foreground">{rows.length === 0 ? "No entries yet: run the seed below (Dry run first)." : "Nothing matches."}</td></tr>}
          </tbody>
        </table>
      </div>

      <section className={`mt-8 ${CARD}`} id="try">
        <h2 className="text-lg font-semibold text-foreground">Try a question</h2>
        <p className="mt-1 text-sm text-muted-foreground">Matched against approved, live answers only, as the chat (Batch 26) and the nightly job will match them. Answered at {settings.answerMinConfidence} or more (and clearly ahead of the next), low confidence from {settings.lowConfidenceMin}.</p>
        <form method="get" action="#try" className="mt-3 flex flex-wrap gap-2">
          <input name="ask" defaultValue={ask} placeholder="How much is a full analysis?" className={`min-w-[18rem] flex-1 ${INPUT}`} />
          <button type="submit" className={BUTTON_QUIET}>Match</button>
        </form>
        {tried && (
          <div className="mt-3 text-sm">
            <p>Outcome: <strong>{tried.outcome.replace(/_/g, " ")}</strong></p>
            <ol className="mt-2 list-decimal space-y-2 pl-5">
              {tried.matches.map((m) => {
                const e = byId.get(m.entryId);
                const r = e && g ? renderEntry(e, g, null) : null;
                return (
                  <li key={m.entryId}>
                    <Link href={`/admin/intelligence/knowledge/${m.entryId}`} className="text-primary hover:underline">{m.slug}</Link> · {m.confidence.toFixed(2)} · matched &quot;{m.phrasing}&quot;
                    <div className="text-muted-foreground">{r?.kind === "ok" ? r.answer : r?.kind === "skip" ? "(needs a member's own values)" : "(not shown now)"}</div>
                  </li>
                );
              })}
              {tried.matches.length === 0 && <li className="list-none text-muted-foreground">No approved answer shares a word with that.</li>}
            </ol>
          </div>
        )}
      </section>

      <section className={`mt-8 ${CARD}`}>
        <h2 className="text-lg font-semibold text-foreground">Seed the first drafts</h2>
        <p className="mt-1 text-sm text-muted-foreground">Adds the drafts written from the chips, the phone agent&apos;s guide and the FAQs (src/lib/knowledge/seed.ts) as drafts for you to approve. It never approves anything or changes a live answer; run it again and it adds only what is new or changed.</p>
        <form action={seedAction} className="mt-3 flex gap-3">
          <button type="submit" name="mode" value="dry" className={BUTTON_QUIET} disabled={!rows}>Dry run</button>
          <button type="submit" name="mode" value="run" className={BUTTON} disabled={!rows}>Seed</button>
        </form>
      </section>

      <section className={`mt-8 ${CARD}`}>
        <h2 className="text-lg font-semibold text-foreground">Settings</h2>
        <form action={saveKnowledgeSettingsAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="text-sm">Answered from (0–1)<input name="answerMinConfidence" type="number" min={0.05} max={1} step={0.01} defaultValue={settings.answerMinConfidence} className={`mt-1 block w-full ${INPUT}`} /></label>
          <label className="text-sm">Low confidence from (0–1)<input name="lowConfidenceMin" type="number" min={0} max={0.95} step={0.01} defaultValue={settings.lowConfidenceMin} className={`mt-1 block w-full ${INPUT}`} /></label>
          <label className="text-sm">Facts kept per member<input name="factsMax" type="number" min={0} max={200} step={1} defaultValue={settings.factsMax} className={`mt-1 block w-full ${INPUT}`} /></label>
          <label className="text-sm">Keep questions (months)<input name="questionRetentionMonths" type="number" min={12} max={120} step={1} defaultValue={settings.questionRetentionMonths} className={`mt-1 block w-full ${INPUT}`} /></label>
          <div className="sm:col-span-4">
            <button type="submit" className={BUTTON_QUIET}>Save settings</button>
            <span className="ml-3 text-xs text-muted-foreground">Decided defaults: answered from {DEFAULT_KNOWLEDGE_SETTINGS.answerMinConfidence}, low confidence from {DEFAULT_KNOWLEDGE_SETTINGS.lowConfidenceMin}, {DEFAULT_KNOWLEDGE_SETTINGS.factsMax} facts, {DEFAULT_KNOWLEDGE_SETTINGS.questionRetentionMonths} months.</span>
          </div>
        </form>
      </section>

      <details className={`mt-8 ${CARD}`}>
        <summary className="cursor-pointer text-lg font-semibold text-foreground">Placeholders and conditions</summary>
        <p className="mt-2 text-sm text-muted-foreground">Write <code>{"{name}"}</code> for a figure and <code>{"{#name}…{/name}"}</code> (or <code>{"{^name}…{/name}"}</code> for &quot;not&quot;) for words shown only sometimes. Answers allowed on calls may use only global placeholders and no sections. Current values are read from the settings now.</p>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-3">Name</th><th className="pr-3">What it is</th><th className="pr-3">Reads</th><th>Now</th></tr></thead>
          <tbody>
            {catalogue(g).map((c) => (
              <tr key={`${c.kind}:${c.name}`} className="border-t border-border align-top">
                <td className="py-1 pr-3 font-mono text-xs">{c.kind === "placeholder" ? `{${c.name}}` : `{#${c.name}}`}</td>
                <td className="pr-3">{c.label}{c.scope === "member" ? " (member's own; never on a call)" : ""}</td>
                <td className="pr-3 text-xs text-muted-foreground">{c.reads}</td>
                <td className="text-xs">{c.scope === "member" ? "per member" : c.value === null ? <span className="text-red-700">doesn&apos;t resolve</span> : c.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
