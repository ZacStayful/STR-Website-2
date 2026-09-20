import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadResponses } from "@/lib/listing/picks-server";
import { filterResponses, patternsFromResponses, type Cut, type ResponseFilter, type ResponseRow } from "@/lib/listing/picks-patterns";
import { PICK_REASONS, LEGACY_REASONS, reasonLabel, isPickReason, type PickReason } from "@/lib/listing/picks";
import { formatListingPrice } from "@/lib/listing/format";

export const metadata: Metadata = { title: "Pick responses — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const WINDOWS = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "12 months", days: 365 },
  { key: "all", label: "All time", days: null },
] as const;

type Search = { days?: string; reaction?: string; reason?: string; kind?: string; basis?: string; area?: string; q?: string };

function sinceIso(days: number | null): string | null {
  return days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString();
}

function money(kind: "sale" | "rent", amount: number | null): string {
  if (amount === null) return "—";
  return formatListingPrice({ amount, period: kind === "rent" ? "pcm" : "total" });
}

function Bar({ label, yes, no, topReasons }: Cut) {
  const total = yes + no;
  const noPct = total > 0 ? Math.round((no / total) * 100) : 0;
  return (
    <tr className="border-t border-border align-top">
      <td className="py-1.5 pr-2">{label}</td>
      <td className="pr-2 tabular-nums">{total}</td>
      <td className="pr-2 tabular-nums text-muted-foreground">{yes}</td>
      <td className="pr-2 tabular-nums">{no}</td>
      <td className="w-28 pr-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2 flex-1 rounded bg-muted">
            <span className="block h-2 rounded bg-primary" style={{ width: `${noPct}%` }} />
          </span>
          <span className="w-8 text-right text-xs text-muted-foreground">{total > 0 ? `${noPct}%` : "—"}</span>
        </span>
      </td>
      <td className="text-xs text-muted-foreground">{topReasons.map((r) => `${r.label} (${r.count})`).join(", ") || "—"}</td>
    </tr>
  );
}

function CutTable({ title, rows, help }: { title: string; rows: Cut[]; help?: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing in this window.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-2">Segment</th>
              <th className="pr-2">Answers</th>
              <th className="pr-2">Yes</th>
              <th className="pr-2">No</th>
              <th className="pr-2">No rate</th>
              <th>Top reasons</th>
            </tr>
          </thead>
          <tbody>{rows.map((c) => <Bar key={c.label} {...c} />)}</tbody>
        </table>
      )}
    </section>
  );
}

/**
 * The store of every answer members have given on a pick, with the pattern
 * cuts that say what to change: which reasons dominate, which segments get
 * the most noes, which members keep saying no, and every free-text comment.
 * Filterable, and exportable as CSV for anything this page does not cut.
 */
export default async function PickResponsesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/picks/responses");
  if (!isAdminEmail(user.email)) notFound();

  const sp = await searchParams;
  const window = WINDOWS.find((w) => w.key === sp.days) ?? WINDOWS[1];
  const filter: ResponseFilter = {
    reaction: sp.reaction === "yes" || sp.reaction === "no" ? sp.reaction : null,
    reason: isPickReason(sp.reason) ? (sp.reason as PickReason) : null,
    kind: sp.kind === "sale" || sp.kind === "rent" ? sp.kind : null,
    basis: sp.basis === "goals" || sp.basis === "house" ? sp.basis : null,
    area: sp.area ?? null,
    q: sp.q ?? null,
  };
  const all = await loadResponses({ since: sinceIso(window.days) });
  const rows = filterResponses(all, filter);
  const p = patternsFromResponses(rows);
  const comments = rows.filter((r) => r.comment.trim());

  const qs = (over: Partial<Search>) => {
    const next = new URLSearchParams();
    const merged: Search = { days: window.key, reaction: filter.reaction ?? undefined, reason: filter.reason ?? undefined, kind: filter.kind ?? undefined, basis: filter.basis ?? undefined, area: filter.area ?? undefined, q: filter.q ?? undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, String(v));
    return `?${next.toString()}`;
  };
  const chip = (active: boolean) => "rounded-full border px-3 py-1 text-xs font-medium " + (active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted");
  const filtered = Boolean(filter.reaction || filter.reason || filter.kind || filter.basis || filter.area || filter.q);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Pick responses</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every answer a member has given on a daily pick. {p.total} answers in the last {window.label.toLowerCase()}
            {filtered ? ` (filtered from ${all.length})` : ""}: {p.yes} yes, {p.no} no, {p.withReasons} with reasons, {p.withComment} with a comment.
            {p.linkOnly > 0 && ` ${p.linkOnly} were a bare email click with no reason given.`}
          </p>
        </div>
        <div className="flex gap-3">
          <a href={`/admin/picks/responses/export${qs({})}`} className="text-sm font-medium text-primary hover:underline">Download CSV</a>
          <Link href="/admin/picks" className="text-sm font-medium text-primary hover:underline">← Daily picks</Link>
        </div>
      </div>

      <section className="mb-6 rounded-xl border border-border bg-card p-5">
        <form className="flex flex-wrap items-end gap-3" action="/admin/picks/responses">
          <input type="hidden" name="days" value={window.key} />
          {filter.reaction && <input type="hidden" name="reaction" value={filter.reaction} />}
          {filter.reason && <input type="hidden" name="reason" value={filter.reason} />}
          {filter.kind && <input type="hidden" name="kind" value={filter.kind} />}
          {filter.basis && <input type="hidden" name="basis" value={filter.basis} />}
          <label className="text-xs font-medium text-muted-foreground">
            Search member, address or comment
            <input name="q" defaultValue={filter.q ?? ""} placeholder="e.g. leicester, garden, @gmail" className="mt-1 block w-72 rounded-md border border-border bg-card px-2 py-1.5 text-sm font-normal text-foreground" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Area
            <input name="area" defaultValue={filter.area ?? ""} placeholder="YO" maxLength={2} className="mt-1 block w-20 rounded-md border border-border bg-card px-2 py-1.5 text-sm font-normal uppercase text-foreground" />
          </label>
          <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Apply</button>
          {filtered && <Link href={`/admin/picks/responses?days=${window.key}`} className="text-sm text-muted-foreground underline">Clear</Link>}
        </form>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {WINDOWS.map((w) => <Link key={w.key} href={qs({ days: w.key })} className={chip(w.key === window.key)}>{w.label}</Link>)}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Link href={qs({ reaction: undefined })} className={chip(!filter.reaction)}>Yes and no</Link>
          <Link href={qs({ reaction: "no" })} className={chip(filter.reaction === "no")}>Said no</Link>
          <Link href={qs({ reaction: "yes" })} className={chip(filter.reaction === "yes")}>Said yes</Link>
          <span className="mx-1 w-px bg-border" />
          <Link href={qs({ kind: undefined })} className={chip(!filter.kind)}>Both kinds</Link>
          <Link href={qs({ kind: "sale" })} className={chip(filter.kind === "sale")}>To buy</Link>
          <Link href={qs({ kind: "rent" })} className={chip(filter.kind === "rent")}>Rent-to-rent</Link>
          <span className="mx-1 w-px bg-border" />
          <Link href={qs({ basis: undefined })} className={chip(!filter.basis)}>Any basis</Link>
          <Link href={qs({ basis: "goals" })} className={chip(filter.basis === "goals")}>From a filter</Link>
          <Link href={qs({ basis: "house" })} className={chip(filter.basis === "house")}>House picks</Link>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Link href={qs({ reason: undefined })} className={chip(!filter.reason)}>Any reason</Link>
          {[...PICK_REASONS, ...LEGACY_REASONS].map((r) => (
            <Link key={r.key} href={qs({ reason: r.key })} className={chip(filter.reason === r.key)}>{r.label}</Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Why members said no</h2>
          <p className="mt-1 text-xs text-muted-foreground">Share is of the {p.no} noes in this window. Click a reason to filter everything on this page by it.</p>
          {p.reasons.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No reasons given yet.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {p.reasons.map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  <Link href={qs({ reason: r.key })} className="w-44 flex-none truncate hover:underline">{r.label}</Link>
                  <span className="h-2 flex-1 rounded bg-muted"><span className="block h-2 rounded bg-primary" style={{ width: `${Math.round((r.count / p.reasons[0].count) * 100)}%` }} /></span>
                  <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{r.count} · {r.share}%</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Answers by week</h2>
          <p className="mt-1 text-xs text-muted-foreground">Is the feedback loop getting used? Reasons given matter more than raw answers.</p>
          {p.weekly.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Week of</th><th>Yes</th><th>No</th><th>With reasons</th></tr></thead>
              <tbody>
                {p.weekly.map((w) => (
                  <tr key={w.week} className="border-t border-border">
                    <td className="py-1.5">{new Date(w.week).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                    <td className="tabular-nums">{w.yes}</td>
                    <td className="tabular-nums">{w.no}</td>
                    <td className="tabular-nums">{w.withReasons}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <CutTable title="By kind" rows={p.byKind} help="Buying versus rent-to-rent." />
        <CutTable title="By basis" rows={p.byBasis} help="Picks from a member's own filter versus Stayful house picks." />
        <CutTable title="By price" rows={p.byPrice} help="Where the price bands start losing people." />
        <CutTable title="By property type" rows={p.byType} />
        <CutTable title="By size" rows={p.bySize} />
        <CutTable title="By area" rows={p.byArea} help="Worst-performing areas first: candidates to drop from the house list." />
      </div>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Members who answer</h2>
        <p className="mt-1 text-xs text-muted-foreground">Two or more answers. A member saying no every time with the same reason is a filter we are not honouring.</p>
        {p.members.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nobody has answered twice yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-2">Member</th><th className="pr-2">Yes</th><th className="pr-2">No</th><th className="pr-2">Their reasons</th><th>Last answer</th></tr></thead>
            <tbody>
              {p.members.map((m) => (
                <tr key={m.userId} className="border-t border-border">
                  <td className="py-1.5 pr-2"><Link href={qs({ q: m.email ?? m.userId })} className="hover:underline">{m.email ?? m.userId.slice(0, 8)}</Link></td>
                  <td className="pr-2 tabular-nums">{m.yes}</td>
                  <td className="pr-2 tabular-nums">{m.no}</td>
                  <td className="pr-2 text-xs text-muted-foreground">{m.reasons.map((r) => `${r.label} (${r.count})`).join(", ") || "—"}</td>
                  <td className="text-xs text-muted-foreground">{new Date(m.lastAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">What they said</h2>
        <p className="mt-1 text-xs text-muted-foreground">Every comment in this window, newest first. This is where the next feature request usually is.</p>
        {comments.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {comments.slice(0, 100).map((r) => (
              <li key={r.id} className="py-2.5">
                <p className="italic text-foreground">“{r.comment}”</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.email ?? r.userId.slice(0, 8)} · {r.reaction} · {r.reasons.map(reasonLabel).join(", ") || "no reasons"} · {new Date(r.respondedAt ?? r.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Every answer</h2>
        <p className="mt-1 text-xs text-muted-foreground">{rows.length} rows{rows.length > 300 ? ", newest 300 shown; the CSV has them all" : ""}.</p>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing matches these filters.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2">When</th>
                  <th className="pr-2">Member</th>
                  <th className="pr-2">Answer</th>
                  <th className="pr-2">Reasons</th>
                  <th className="pr-2">Property</th>
                  <th className="pr-2">Price</th>
                  <th className="pr-2">Area</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((r: ResponseRow) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="py-1.5 pr-2 whitespace-nowrap text-xs text-muted-foreground">{new Date(r.respondedAt ?? r.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                    <td className="pr-2 text-xs">{r.email ?? r.userId.slice(0, 8)}</td>
                    <td className="pr-2">
                      <span className={"rounded-full px-2 py-0.5 text-xs font-semibold " + (r.reaction === "yes" ? "bg-primary/10 text-primary" : "bg-muted")}>{r.reaction}</span>
                      {r.reactionSource === "link" && <span className="ml-1 text-[11px] text-muted-foreground">link</span>}
                    </td>
                    <td className="pr-2 text-xs">{r.reasons.map(reasonLabel).join(", ") || "—"}</td>
                    <td className="pr-2 text-xs">
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">{r.address ?? r.title}</a>
                      <span className="block text-muted-foreground">{[r.bedrooms !== null ? `${r.bedrooms} bed` : null, r.rawType, r.tenure, r.kind === "rent" ? "R2R" : "buy", r.basis].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="pr-2 whitespace-nowrap text-xs tabular-nums">{money(r.kind, r.amount)}</td>
                    <td className="pr-2 text-xs">{r.postcodeArea ?? "—"}</td>
                    <td className="text-xs italic text-muted-foreground">{r.comment || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
