import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { keepRatePct, projectLearningView, type KeepRate } from "@/lib/project/admin-server";
import { LEVEL_LABELS } from "@/lib/project/costing";

export const metadata: Metadata = { title: "Project deals admin — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const DAYS = 30;
const gbp = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
const pence = (p: number) => `£${(p / 100).toFixed(2)}`;
const k = (n: number) => `£${Math.round(n / 1000)}k`;
const dash = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("en-GB"));

const RETIRED_LABELS: Record<string, string> = {
  not_project: "value added under the bar",
  project_excluded: "excluded (construction, lease, listed, conservation, structural)",
  project_no_evidence: "too few sold prices nearby",
  project_uncheckable: "page never readable (Zoopla)",
};

const ACTIVITY_LABELS: Record<string, string> = {
  project_view: "Project section seen",
  project_working: "Working opened",
  project_line_edit: "Lines changed",
  project_line_add: "Lines added",
  project_lock: "Figures locked",
  project_unlock: "Figures unlocked",
};

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-3xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function rateLine(r: KeepRate): string {
  const pct = keepRatePct(r);
  return pct === null ? "no reactions yet" : `${pct}% (${r.keeps} kept, ${r.passes} passed)`;
}

const counts = (o: Record<string, number> | null | undefined) =>
  o && Object.keys(o).length > 0
    ? Object.entries(o)
        .sort((a, b) => b[1] - a[1])
        .map(([key, v]) => `${key} ${v}`)
        .join(" · ")
    : "—";

/**
 * What Project deals are doing (Batch 17): found, held, checked and what came
 * of it; the live ones; what members did with them; members' figures
 * against ours; the live-deal backfill. No address, postcode, listing link
 * or photo, and no member is named.
 */
export default async function ProjectDealsAdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/deals/projects");
  if (!isAdminEmail(user.email)) notFound();

  const v = await projectLearningView(createAdminClient(), DAYS);
  const passed = v.outcomes.project ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Project deals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The last {DAYS} days. A sale whose own words say it needs work is held for its comparables check and then its Project check (photos, sold prices, the estimate); it goes live as a Project deal only when the value added passes. Settings, the allowance and the run buttons are on the deals page.
          </p>
        </div>
        <Link href="/admin/deals" className="text-sm font-medium text-primary hover:underline">← Deals marketplace</Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Flagged as needing work" value={dash(v.found)} sub="new deals whose words say so" />
        <Stat label="Photo checks" value={v.photoChecks ? Object.values(v.photoChecks.byStatus).reduce((a, b) => a + b, 0) : "—"} sub={v.photoChecks ? `${counts(v.photoChecks.byStatus)} · ${pence(v.photoChecks.costPence)} · ${v.photoChecks.fellBack} on the fallback model` : undefined} />
        <Stat label="Passed: live as Project deals" value={passed} sub={`outcomes: ${counts(v.outcomes)}`} />
        <Stat label="Retired, never shown" value={v.retired ? Object.values(v.retired).reduce((a, b) => a + b, 0) : "—"} sub={v.retired ? Object.entries(v.retired).map(([r, n]) => `${RETIRED_LABELS[r] ?? r} ${n}`).join(" · ") : undefined} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Ever a Project deal" value={dash(v.everProject)} sub={`${v.live ? v.live.length : "—"} live now`} />
        <Stat label="Opened" value={v.opened ? v.opened.opens : "—"} sub={v.opened ? `${v.opened.deals} Project deals opened at least once` : undefined} />
        <Stat label="Full analyses" value={dash(v.analysed)} />
        <Stat label="Figures locked" value={v.locked ? v.locked.versions : "—"} sub={v.locked ? `by ${v.locked.members} member${v.locked.members === 1 ? "" : "s"}` : undefined} />
      </div>

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">What members do with them</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="text-sm">
            <p className="font-medium text-foreground">Keep rate, last {DAYS} days</p>
            <p className="mt-1 text-muted-foreground">Project deals: {v.keep ? rateLine(v.keep.project) : "—"}</p>
            <p className="text-muted-foreground">Every other deal: {v.keep ? rateLine(v.keep.others) : "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">Keeps ÷ (keeps + passes), on reactions changed in the window.</p>
          </div>
          <div className="text-sm">
            <p className="font-medium text-foreground">The working, last {DAYS} days</p>
            <ul className="mt-1 text-muted-foreground">
              {v.activity ? Object.entries(v.activity).map(([kind, n]) => <li key={kind}>{ACTIVITY_LABELS[kind] ?? kind}: {n}</li>) : <li>—</li>}
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Live Project deals</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Deal</th><th>Level</th><th>Price</th><th>Works</th><th>Value after works</th><th>Value added</th><th>Cash needed</th><th>Live since</th><th>Opens</th></tr></thead>
            <tbody>
              {(v.live ?? []).map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="py-1.5"><Link href={`/deals/${d.id}`} className="text-primary hover:underline">{d.area ?? "?"} · {d.bedrooms ?? "?"} bed {d.type ?? ""}</Link></td>
                  <td>{d.card ? LEVEL_LABELS[d.card.level] : "—"}</td>
                  <td>{d.price !== null ? gbp(d.price) : "—"}</td>
                  <td>{d.card ? `${k(d.card.worksLow)}–${k(d.card.worksHigh)}` : "—"}</td>
                  <td>{d.card ? `${gbp(d.card.value)}${d.card.ceilingApplied ? " (capped)" : ""}` : "—"}</td>
                  <td>{d.card ? `${gbp(d.card.valueAdded)} (${d.card.valueAddedPct.toFixed(1)}%)` : "—"}</td>
                  <td>{d.card ? `${k(d.card.cashLow)}–${k(d.card.cashHigh)}` : "—"}</td>
                  <td>{d.liveSince ? new Date(d.liveSince).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}</td>
                  <td>{d.opens}</td>
                </tr>
              ))}
              {(v.live ?? []).length === 0 && <tr><td className="py-2 text-muted-foreground" colSpan={9}>{v.live ? "No live Project deals yet." : "The Project columns are not in the database yet (run schema.sql's Batch 17 section)."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Members’ locked figures against ours</h2>
        <p className="mt-1 text-sm text-muted-foreground">The latest 50 locked versions, anonymised. Theirs never change our estimate; this is where a rate or a quantity that members keep correcting shows up.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Deal</th><th>Locked</th><th>Works, ours → theirs (high)</th><th>Value added, ours → theirs</th><th>Still passes</th><th>Lines changed / added</th></tr></thead>
            <tbody>
              {(v.figures ?? []).map((f, i) => (
                <tr key={`${f.lockedAt}-${i}`} className="border-t border-border">
                  <td className="py-1.5">{f.area ?? "?"} · {f.bedrooms ?? "?"} bed</td>
                  <td>{new Date(f.lockedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} (v{f.version})</td>
                  <td>{f.oursWorksHigh !== null ? gbp(f.oursWorksHigh) : "—"} → {gbp(f.theirsWorksHigh)}</td>
                  <td>{f.oursValueAdded !== null ? gbp(f.oursValueAdded) : "—"} → {gbp(f.theirsValueAdded)}</td>
                  <td>{f.theirsPass ? "yes" : "no"}</td>
                  <td>{f.changedLines} / {f.ownLines}</td>
                </tr>
              ))}
              {(v.figures ?? []).length === 0 && <tr><td className="py-2 text-muted-foreground" colSpan={6}>No member has locked figures yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Recent photo checks</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">UK day</th><th>Deal</th><th>Status</th><th>Cost</th><th>Model</th><th>Fallback</th></tr></thead>
            <tbody>
              {(v.checks ?? []).map((c, i) => (
                <tr key={`${c.day}-${i}`} className="border-t border-border">
                  <td className="py-1.5">{c.day}</td>
                  <td>{c.area ?? "?"} · {c.bedrooms ?? "?"} bed {c.type ?? ""}</td>
                  <td>{c.status}</td>
                  <td>{pence(c.costPence)}</td>
                  <td>{c.model ?? "—"}</td>
                  <td>{c.fellBack ? "yes" : ""}</td>
                </tr>
              ))}
              {(v.checks ?? []).length === 0 && <tr><td className="py-2 text-muted-foreground" colSpan={6}>{v.checks ? "No photo check in the window." : "The photo checks could not be read (run schema.sql's Batch 17 section)."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Live-deal backfill runs</h2>
        <p className="mt-1 text-sm text-muted-foreground">The one-off pass over the sales already live whose words say they need work (the buttons are in the Project checks panel on the deals page). Every example it would act on, never an address.</p>
        {v.backfills.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Not run yet.</p>}
        {v.backfills.map((r) => (
          <div key={r.id} className="mt-4 rounded-lg border border-border bg-background p-4 text-sm">
            <p className="font-medium text-foreground">
              {r.dry ? "Dry run" : "Run"} · {new Date(r.startedAt).toLocaleString("en-GB")} · read {dash(r.summary.read as number)} · flagged {dash(r.summary.flagged as number)} · held {dash(r.summary.held as number)} · left {dash(r.summary.left as number)} · already Project {dash(r.summary.alreadyProject as number)}
              {r.dry ? "" : ` · written ${dash(r.summary.written as number)}`}
              {r.summary.outOfTime ? " · stopped for time (run again to carry on)" : ""}
            </p>
            <p className="mt-1 text-muted-foreground">Retired: {counts(r.summary.retired as Record<string, number> | undefined)}</p>
            {Array.isArray(r.summary.sample) && (r.summary.sample as unknown[]).length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {(r.summary.sample as unknown[]).map((line, i) => <li key={i}>{String(line)}</li>)}
              </ul>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
