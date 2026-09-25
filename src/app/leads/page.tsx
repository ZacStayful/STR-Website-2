import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { listFunnels } from "@/lib/funnels";
import { funnelWalls } from "@/lib/funnels/alerts";
import { listLeads, countLeads, type LeadRecord } from "@/lib/api/leads-query";
import { leadScope } from "@/lib/leads/scope";
import { LEAD_TABS, PAGE_SIZE, parseLeadFilters, queryFor, filtersQuery, isFiltered, type LeadFilters, type LeadTab } from "@/lib/leads/filters";
import { LEAD_STAGES, STAGE_LABELS } from "@/lib/leads/stage";
import { archivingSoon, archiveDueAt, retentionDate } from "@/lib/leads/retention";
import { saturationBand } from "@/lib/market/competition";
import { WallBanner, type WallNotice } from "./WallBanner";
import { LeadList, type LeadListRow } from "./LeadList";

export const metadata: Metadata = {
  title: "Leads — Stayful Intelligence",
  robots: { index: false, follow: false },
};

// Qualified and Not qualified are separate views with their own counts, not
// one list behind a filter: a lead that missed the filter needs a different
// decision from one that passed, and the reason it missed is the point.
// Archived is its own view because those leads are on their way out, and
// nothing about them should be mistaken for a live enquiry.

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

function toRow(r: LeadRecord, now: Date): LeadListRow {
  const l = r.lead;
  const saturation = saturationBand(l.metrics.averageReviewCount);
  const facts = [
    l.property.bedrooms !== null ? `${l.property.bedrooms} bed` : null,
    l.property.postcodeArea,
    saturation ? `${saturation.headline} market` : null,
    l.funnel.name,
  ].filter((x): x is string => Boolean(x));

  let retention: string | null = null;
  if (r.archivedAt) {
    retention = r.deletesAt
      ? `Archived · deleted on ${retentionDate(r.deletesAt)} unless restored`
      : `Archived ${retentionDate(r.archivedAt)} · we'll email you the deletion date`;
  } else if (r.lastActivityAt && archivingSoon(r.lastActivityAt, now)) {
    retention = `Archives on ${retentionDate(archiveDueAt(r.lastActivityAt))} unless opened`;
  }

  return {
    id: r.id,
    title: l.contact.name || l.contact.email || "Unnamed enquiry",
    subtitle: l.contact.name && l.contact.email ? l.contact.email : null,
    address: l.property.address,
    enquired: retentionDate(l.createdAt),
    facts,
    revenue: l.metrics.annualRevenue !== null && l.metrics.annualRevenue > 0 ? gbp(l.metrics.annualRevenue) : null,
    stage: STAGE_LABELS[r.stage],
    unqualifiedReason: l.qualification.qualified === false && l.qualification.summary ? l.qualification.summary : null,
    unknownChecks: l.qualification.unknownChecks,
    retention,
    archived: Boolean(r.archivedAt),
    canPush: r.status !== "queued" && Boolean(l.report.url) && !r.archivedAt,
    pushed: r.status === "pushed",
  };
}

/** Leads archived for inactivity, so the customer is told here as well as by email. */
async function inactiveArchives(ownerId: string): Promise<{ count: number; firstDeletion: string | null }> {
  if (!hasServiceRole()) return { count: 0, firstDeletion: null };
  const { data, count } = await createAdminClient()
    .from("leads")
    .select("purge_after", { count: "exact" })
    .eq("user_id", ownerId)
    .eq("archive_reason", "inactive")
    .not("archived_at", "is", null)
    .order("purge_after", { ascending: true, nullsFirst: false })
    .limit(1);
  const first = (data?.[0] as { purge_after: string | null } | undefined)?.purge_after ?? null;
  return { count: count ?? 0, firstDeletion: first };
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseLeadFilters(await searchParams);

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const scope = await leadScope(user);

  const [page, counts, funnels, archives] = await Promise.all([
    listLeads(scope.ownerId, queryFor(filters)),
    Promise.all(LEAD_TABS.map((t) => countLeads(scope.ownerId, queryFor(filters, t.key, false)))),
    listFunnels(scope.ownerId),
    inactiveArchives(scope.ownerId),
  ]);
  const countFor = (tab: LeadTab) => counts[LEAD_TABS.findIndex((t) => t.key === tab)] ?? 0;
  const now = new Date();
  const rows = page.leads.map((r) => toRow(r, now));
  const pages = Math.max(1, Math.ceil(page.total / PAGE_SIZE));

  // Only live funnels: a paused one is not turning anybody away or running out
  // of anything, and the app already shows it as paused.
  const notices: WallNotice[] = (
    await Promise.all(
      funnels
        .filter((f) => f.active)
        .map(async (f) =>
          (await funnelWalls(f)).map((w) => ({ ...w, funnelId: f.id, funnelName: f.name })),
        ),
    )
  ).flat();

  const anyLeads = LEAD_TABS.some((t) => countFor(t.key) > 0) || isFiltered(filters);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 pb-10 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Leads</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enquiries from your funnels. Your own analyser reports live separately, under{" "}
              <Link href="/reports" className="underline underline-offset-2">My reports</Link>.
            </p>
          </div>
          <Link
            href="/leads/funnels"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            {funnels.length === 0 ? "Create a funnel" : "Manage funnels"}
          </Link>
        </div>

        <WallBanner notices={notices} showFunnelName={funnels.length > 1} />

        {archives.count > 0 && filters.tab !== "archived" ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
            <p className="min-w-0 flex-1 text-sm text-foreground">
              {archives.count} lead{archives.count === 1 ? " was" : "s were"} archived after 6 months without being used
              {archives.firstDeletion ? <> and will be deleted from {retentionDate(archives.firstDeletion)}</> : null}.
              Restore any you still need.
            </p>
            <Link
              href="/leads?tab=archived"
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Review archived
            </Link>
          </div>
        ) : null}

        {funnels.length === 0 && !anyLeads ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm font-medium text-foreground">No funnels yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A funnel gives you a link to put behind your own enquiry form. Whoever fills it in gets a report
              under your branding, and the lead lands here.
            </p>
            <Link
              href="/leads/funnels"
              className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Create your first funnel
            </Link>
          </div>
        ) : (
          <>
            <SearchForm filters={filters} funnels={funnels.map((f) => ({ id: f.id, name: f.name }))} />

            <nav className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-sm" aria-label="Filter leads">
              {LEAD_TABS.map((t) => (
                <Link
                  key={t.key}
                  href={`/leads${filtersQuery(filters, { tab: t.key })}`}
                  className={
                    "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-center font-medium " +
                    (filters.tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
                  }
                  aria-current={filters.tab === t.key ? "page" : undefined}
                >
                  {t.label} <span className="text-xs opacity-70">{countFor(t.key)}</span>
                </Link>
              ))}
            </nav>

            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <p className="text-sm font-medium text-foreground">{emptyTitle(filters, anyLeads)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{emptyHint(filters, anyLeads)}</p>
              </div>
            ) : (
              <LeadList key={filters.tab} rows={rows} archivedTab={filters.tab === "archived"} />
            )}

            {pages > 1 ? (
              <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
                {filters.page > 1 ? (
                  <Link href={`/leads${filtersQuery(filters, { page: filters.page - 1 })}`} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">
                    ← Newer
                  </Link>
                ) : <span />}
                <span className="text-xs text-muted-foreground">Page {filters.page} of {pages}</span>
                {filters.page < pages ? (
                  <Link href={`/leads${filtersQuery(filters, { page: filters.page + 1 })}`} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">
                    Older →
                  </Link>
                ) : <span />}
              </nav>
            ) : null}

            <p className="mt-6 text-xs text-muted-foreground">
              A lead that hasn&apos;t been opened, sent to your CRM or revisited by the homeowner for 6 months is archived.
              We email you 2 days before and again when it happens. Archived leads can be restored for 7 days, then they
              are deleted, and any report links already sent out stop working.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function emptyTitle(f: LeadFilters, anyLeads: boolean): string {
  if (!anyLeads) return "No leads yet";
  if (isFiltered(f)) return "Nothing matches that search";
  if (f.tab === "archived") return "Nothing archived";
  if (f.tab === "queued") return "Nothing queued";
  return f.tab === "qualified" ? "Nothing qualified" : "Nothing here";
}

function emptyHint(f: LeadFilters, anyLeads: boolean): string {
  if (!anyLeads) return "Point your enquiry form at your funnel link and the first lead will appear here.";
  if (isFiltered(f)) return "Try part of the email or address, a wider date range, or another tab.";
  if (f.tab === "archived") return "Leads you archive, or that go unused for 6 months, wait here for 7 days before they are deleted.";
  if (f.tab === "queued") return "Leads land here only when your balance was too low to run the report. They run automatically once you top up.";
  return "Leads that fall outside your filter appear under Not qualified, with the reason.";
}

/**
 * A plain GET form: the search lives in the URL, so it can be bookmarked,
 * shared and navigated back to, and needs no client code at all.
 */
function SearchForm({ filters, funnels }: { filters: LeadFilters; funnels: { id: string; name: string }[] }) {
  const input = "rounded-md border border-border bg-background px-2.5 py-1.5 text-sm";
  return (
    <form method="get" action="/leads" className="mb-4 rounded-xl border border-border bg-card p-3" role="search">
      {filters.tab !== "qualified" ? <input type="hidden" name="tab" value={filters.tab} /> : null}
      <div className="flex flex-wrap gap-2">
        <label className="min-w-48 flex-[2]">
          <span className="sr-only">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Email, name, address or postcode"
            className={`${input} w-full`}
            maxLength={100}
          />
        </label>
        {funnels.length > 1 ? (
          <label className="min-w-36 flex-1">
            <span className="sr-only">Funnel</span>
            <select name="funnel" defaultValue={filters.funnel ?? ""} className={`${input} w-full`}>
              <option value="">All funnels</option>
              {funnels.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="min-w-36 flex-1">
          <span className="sr-only">Stage</span>
          <select name="stage" defaultValue={filters.stage ?? ""} className={`${input} w-full`}>
            <option value="">Any stage</option>
            {LEAD_STAGES.map((s) => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          Enquired from
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={`${input} mt-0.5 block`} />
        </label>
        <label className="text-xs text-muted-foreground">
          to
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={`${input} mt-0.5 block`} />
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          {isFiltered(filters) ? (
            <Link href={`/leads${filtersQuery({ ...filters, q: null, funnel: null, from: null, to: null, stage: null })}`} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Clear
            </Link>
          ) : null}
          <a
            href={`/leads/export${filtersQuery(filters)}`}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            Export CSV
          </a>
          <button type="submit" className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
            Search
          </button>
        </div>
      </div>
    </form>
  );
}
