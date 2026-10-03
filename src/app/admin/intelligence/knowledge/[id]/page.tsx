import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { CATEGORY_LABEL, CHANNEL_LABEL, type KbCategory, type KbChannel } from "@/lib/knowledge/config";
import { checkContent, contentHash, renderEntry, type ContentCheck, type EntryContent } from "@/lib/knowledge/render";
import { entryStatus, liveContent, pendingContent, STATUS_LABEL } from "@/lib/knowledge/rows";
import { entryById, historyFor, readGlobalSnapshot } from "@/lib/knowledge/store-server";
import { CONDITIONS } from "@/lib/knowledge/placeholders";
import { readFlash } from "../../flash";
import { approveAction, rejectAction, retireAction, saveDraftAction } from "../../actions";
import { BUTTON, BUTTON_QUIET, CARD, EntryFields, FlashBox, SiAdminNav, when } from "../../SiAdmin";

export const metadata: Metadata = { title: "Knowledge entry — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Content({ c }: { c: EntryContent }) {
  return (
    <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-[10rem_1fr]">
      <dt className="text-muted-foreground">Question</dt><dd className="font-mono text-xs">{c.question}</dd>
      <dt className="text-muted-foreground">Answer</dt><dd className="font-mono text-xs">{c.answer}</dd>
      <dt className="text-muted-foreground">Other phrasings</dt><dd>{c.variants.length ? c.variants.join(" · ") : "—"}</dd>
      <dt className="text-muted-foreground">Category</dt><dd>{CATEGORY_LABEL[c.category as KbCategory] ?? c.category}</dd>
      <dt className="text-muted-foreground">Channels</dt><dd>{c.channels.map((x) => CHANNEL_LABEL[x as KbChannel] ?? x).join(", ") || "—"}</dd>
      <dt className="text-muted-foreground">Show only when</dt><dd>{c.showWhen ? CONDITIONS[c.showWhen]?.label ?? c.showWhen : "Always"}</dd>
    </dl>
  );
}

function Checks({ check }: { check: ContentCheck }) {
  return (
    <div className="mt-3 space-y-2 text-sm">
      {check.errors.length > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          <p className="font-semibold">Can&apos;t be approved yet:</p>
          <ul className="list-disc pl-5">{check.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {check.warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <p className="font-semibold">Worth a second look:</p>
          <ul className="list-disc pl-5">{check.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {check.previews.length > 0 && (
        <div>
          <p className="font-semibold">As members would see it now (a sample member, every combination):</p>
          <ul className="mt-1 space-y-1">
            {check.previews.map((p, i) => (
              <li key={i} className="rounded-md bg-muted p-2"><span className="text-xs text-muted-foreground">{p.when}: </span><strong>{p.question}</strong> — {p.answer}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Batch 24: one knowledge entry. What is live (as anyone sees it now), the
 * pending draft with every check and a preview of each combination of its
 * sections, Approve / Reject (conditional on the exact version and draft
 * shown), Edit (saves a draft; the live answer stays until approved),
 * Retire, and the history.
 */
export default async function KnowledgeEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/admin/intelligence/knowledge/${encodeURIComponent(id)}`);
  if (!isAdminEmail(user.email)) notFound();
  if (!UUID.test(id) || !hasServiceRole()) notFound();

  const admin = createAdminClient();
  const [row, history, g, flash] = await Promise.all([entryById(id, admin), historyFor(id, admin), readGlobalSnapshot(admin), readFlash()]);
  if (!row) notFound();
  const status = entryStatus(row);
  const live = liveContent(row);
  const pending = row.draft_state === "pending" ? pendingContent(row) : null;
  const rejected = row.draft_state === "rejected" ? pendingContent(row) : null;
  const liveNow = live && g ? renderEntry(live, g, null) : null;
  const pendingCheck = pending ? checkContent(pending, g) : null;
  const liveCheck = live && status === "stale" && !pending ? checkContent(live, g) : null;
  const pendingHashOk = pending ? contentHash(pending) === row.draft_hash : false;

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <SiAdminNav current="knowledge" />
      <FlashBox flash={flash} />
      <Link href="/admin/intelligence/knowledge" className="text-sm font-medium text-primary hover:underline">← Knowledge</Link>
      <h1 className="mt-3 text-2xl font-semibold text-foreground">{live?.question ?? pending?.question ?? rejected?.question ?? row.slug}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {row.slug} · {STATUS_LABEL[status]} · from {row.source}
        {row.approved_at ? ` · approved ${when(row.approved_at)} by ${row.approved_by ?? "admin"}` : ""} · version {row.version}
      </p>
      {row.stale_reason && <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">Stale since {when(row.stale_at)}: {row.stale_reason}. Hidden from members until approved again.</p>}

      {live && (
        <section className={`mt-6 ${CARD}`}>
          <h2 className="text-lg font-semibold text-foreground">Live</h2>
          {liveNow?.kind === "ok" && <p className="mt-2 rounded-md bg-muted p-2 text-sm"><strong>{liveNow.question}</strong> — {liveNow.answer}</p>}
          {liveNow?.kind === "skip" && <p className="mt-2 text-sm text-muted-foreground">Uses a member&apos;s own values ({liveNow.missing.join(", ")}): each member sees their own.</p>}
          {liveNow?.kind === "hidden" && <p className="mt-2 text-sm text-muted-foreground">Shown only when its condition is true for a member.</p>}
          {liveNow?.kind === "stale" && <p className="mt-2 text-sm text-red-700">{liveNow.reason}</p>}
          <Content c={live} />
          {liveCheck && (
            <>
              <Checks check={liveCheck} />
              <form action={approveAction} className="mt-3">
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="version" value={row.version} />
                <input type="hidden" name="hash" value="" />
                <button type="submit" className={BUTTON} disabled={liveCheck.errors.length > 0}>Approve again as it stands</button>
              </form>
            </>
          )}
        </section>
      )}

      {pending && pendingCheck && (
        <section className={`mt-6 ${CARD} border-sky-300`}>
          <h2 className="text-lg font-semibold text-foreground">{live ? "Proposed change" : "Draft"} <span className="text-sm font-normal text-muted-foreground">({row.draft_source ?? "manual"}, {when(row.draft_at)})</span></h2>
          {row.draft_note && <p className="mt-1 text-sm text-muted-foreground">{row.draft_note}</p>}
          <Content c={pending} />
          <Checks check={pendingCheck} />
          {!pendingHashOk && <p className="mt-2 text-sm text-red-700">This draft&apos;s fingerprint doesn&apos;t match; save it again before approving.</p>}
          <div className="mt-4 flex flex-wrap items-start gap-3">
            <form action={approveAction}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="version" value={row.version} />
              <input type="hidden" name="hash" value={row.draft_hash ?? ""} />
              <button type="submit" className={BUTTON} disabled={pendingCheck.errors.length > 0 || !pendingHashOk}>Approve: live on its channels now</button>
            </form>
            <form action={rejectAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="version" value={row.version} />
              <input name="note" placeholder="Why (optional)" maxLength={300} className="rounded-md border border-border bg-background px-2 py-1 text-sm" />
              <button type="submit" className={BUTTON_QUIET}>Reject</button>
            </form>
          </div>
        </section>
      )}

      {rejected && !pending && (
        <section className={`mt-6 ${CARD}`}>
          <h2 className="text-lg font-semibold text-foreground">Rejected draft</h2>
          <p className="mt-1 text-sm text-muted-foreground">Kept so the same answer is not suggested again.{row.draft_note ? ` Why: ${row.draft_note}` : ""}</p>
          <Content c={rejected} />
        </section>
      )}

      {!row.retired_at && (
        <section className={`mt-6 ${CARD}`}>
          <h2 className="text-lg font-semibold text-foreground">{pending ? "Edit the draft" : live ? "Edit (saves a draft; the live answer stays until you approve)" : "Edit"}</h2>
          <form action={saveDraftAction} className="mt-3">
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="version" value={row.version} />
            <EntryFields value={pending ?? live ?? rejected} />
            <button type="submit" className={`mt-3 ${BUTTON_QUIET}`}>Save draft</button>
          </form>
        </section>
      )}

      {!row.retired_at && (
        <section className={`mt-6 ${CARD}`}>
          <h2 className="text-lg font-semibold text-foreground">Retire</h2>
          <p className="mt-1 text-sm text-muted-foreground">Takes it off every channel for good. It stays here, with its history, and is never suggested again.</p>
          <form action={retireAction} className="mt-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="version" value={row.version} />
            <input name="note" placeholder="Why (optional)" maxLength={300} className="rounded-md border border-border bg-background px-2 py-1 text-sm" />
            <button type="submit" className={BUTTON_QUIET}>Retire</button>
          </form>
        </section>
      )}

      <section className={`mt-6 ${CARD}`}>
        <h2 className="text-lg font-semibold text-foreground">History</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {history.map((h, i) => (
            <li key={i}><span className="text-muted-foreground">{when(h.at)}</span> · {h.action} by {h.actor}{h.version ? ` (v${h.version})` : ""}{h.note ? ` — ${h.note}` : ""}</li>
          ))}
          {history.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}
        </ul>
      </section>
    </div>
  );
}
