import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { oneOf, windowFor, WINDOWS } from "@/app/admin/picks/responses/windows";
import { loadMetaStatus, loadSignupReport, type ConversionLine, type MetaStatusLoad } from "@/lib/tracking/report-server";
import { shareText, type SourceRow } from "@/lib/tracking/report";
import { TRACKING } from "@/lib/tracking/config";

export const metadata: Metadata = { title: "Sign-ups by source — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(v: string | null): Date | null {
  if (!v || !DAY.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

const chip = (active: boolean) => "rounded-full border px-3 py-1 text-xs font-medium " + (active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted");

/**
 * Batch 19's admin page: which ads and links bring members, and whether the
 * members they bring stay (src/lib/tracking/report.ts; weekly active is
 * Batch 9's own figure). Below it, whether Meta measurement is set up and
 * what it sent last. No member is named on this page.
 */
export default async function SignupsPage({ searchParams }: { searchParams: Promise<{ days?: string | string[]; from?: string | string[]; to?: string | string[] }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/signups");
  if (!isAdminEmail(user.email)) notFound();

  const sp = await searchParams;
  const now = new Date();
  const customFrom = day(oneOf(sp.from));
  const customToDay = day(oneOf(sp.to));
  const custom = Boolean(customFrom || customToDay);
  const window = windowFor(oneOf(sp.days));
  const from = custom ? customFrom : window.days === null ? null : new Date(now.getTime() - window.days * 86_400_000);
  const to = custom && customToDay ? new Date(customToDay.getTime() + 86_400_000) : null;

  const [{ status, message, weeklyMissing, report }, meta] = await Promise.all([loadSignupReport({ from, to, now }), loadMetaStatus()]);
  const left = report.left;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sign-ups by source</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Which ads and links bring members, and whether those members stay. A sign-up is an account made in the range on the live site that has signed in at least once. Rows group utm_source, then utm_campaign, then utm_content (the ad); untagged sign-ups sit under
            “direct / unknown” by the site they came from. Each figure is shown as members / the members it applies to. Weekly active is the same figure as on{" "}
            <Link href="/admin/weekly-active" className="underline">
              Weekly active
            </Link>
            : week 1 is the sign-up week (Monday to Sunday, UK time), and a week only counts once it is over.
          </p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">
          ← Admin
        </Link>
      </div>

      <section className="mb-6 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap gap-1.5">
          {WINDOWS.map((w) => (
            <Link key={w.key} href={`/admin/signups?days=${w.key}`} className={chip(!custom && w.key === window.key)}>
              {w.label}
            </Link>
          ))}
        </div>
        <form className="mt-4 flex flex-wrap items-end gap-3" action="/admin/signups">
          <label className="text-xs font-medium text-muted-foreground">
            From
            <input type="date" name="from" defaultValue={customFrom ? oneOf(sp.from) ?? "" : ""} className="mt-1 block rounded-md border border-border bg-card px-2 py-1.5 text-sm font-normal text-foreground" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            To
            <input type="date" name="to" defaultValue={customToDay ? oneOf(sp.to) ?? "" : ""} className="mt-1 block rounded-md border border-border bg-card px-2 py-1.5 text-sm font-normal text-foreground" />
          </label>
          <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
            Show
          </button>
          {custom && (
            <Link href="/admin/signups" className="text-sm text-muted-foreground underline">
              Clear
            </Link>
          )}
        </form>
      </section>

      {status !== "ok" && (
        <p className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {status === "schema_missing"
            ? "The Batch 19 section of supabase/schema.sql has not been run yet, so nothing has been recorded."
            : status === "no_service_role"
              ? "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment."
              : `The figures could not be read${message ? `: ${message}` : "."}`}
        </p>
      )}
      {status === "ok" && weeklyMissing && <p className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">Weekly active could not be read, so the week columns are empty.</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2">Source → campaign → ad</th>
              <th className="px-2 py-2">Sign-ups</th>
              <th className="px-2 py-2">Finished profile</th>
              <th className="px-2 py-2">First report in {TRACKING.firstReportDays} days</th>
              <th className="px-2 py-2">Paid</th>
              <th className="px-2 py-2">Active week 2</th>
              <th className="px-2 py-2">Week 3</th>
              <th className="px-2 py-2">Week 4</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                  No sign-ups in this range yet.
                </td>
              </tr>
            ) : (
              report.rows.flatMap((r) => flatten(r)).map((r, i) => <Row key={`${i}-${r.key}`} row={r} />)
            )}
            <Row row={report.total} total />
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Rows with fewer than {TRACKING.minRowSignups} sign-ups are greyed: too few to trust. Left out: {left.teamInvites} team invitee{left.teamInvites === 1 ? "" : "s"} (their team pays), {left.excluded} admin, staff or excluded account
        {left.excluded === 1 ? "" : "s"}, {left.neverSignedIn} never signed in, {left.notProduction} made on a preview or local build. Lead-form accounts show under their lead source.
      </p>

      <MetaStatus meta={meta} />
    </div>
  );
}

function flatten(r: SourceRow): SourceRow[] {
  return [r, ...r.children.flatMap(flatten)];
}

function Row({ row, total = false }: { row: SourceRow; total?: boolean }) {
  const pad = row.level === 0 ? "pl-4" : row.level === 1 ? "pl-9" : "pl-14";
  const tone = total ? "border-t border-border font-semibold text-foreground" : row.grey ? "text-muted-foreground/70" : row.level === 0 ? "font-medium text-foreground" : "text-foreground";
  return (
    <tr className={`${tone} ${row.level === 0 && !total ? "border-t border-border/60" : ""}`}>
      <td className={`${pad} py-1.5 pr-2`}>{total ? "All sign-ups" : row.label}</td>
      <td className="px-2 py-1.5">{row.signups}</td>
      <td className="px-2 py-1.5">{shareText(row.profile)}</td>
      <td className="px-2 py-1.5">{shareText(row.firstReport)}</td>
      <td className="px-2 py-1.5">{shareText(row.paid)}</td>
      <td className="px-2 py-1.5">{shareText(row.weeks[0])}</td>
      <td className="px-2 py-1.5">{shareText(row.weeks[1])}</td>
      <td className="px-2 py-1.5">{shareText(row.weeks[2])}</td>
    </tr>
  );
}

const yes = (v: boolean) => (v ? "Yes" : "No");

function serverResult(c: ConversionLine): string {
  if (c.server === "sent") return c.testEvent ? "Sent (test event)" : "Sent";
  if (c.server === "failed") return `Failed${c.serverHttp ? ` (HTTP ${c.serverHttp})` : ""}${c.serverNote ? `: ${c.serverNote}` : ""}`;
  if (c.server === "skipped") return `Skipped${c.serverNote ? `: ${c.serverNote.replace(/_/g, " ")}` : ""}`;
  if (c.server === "held") return "Held: no consent yet";
  return c.server.charAt(0).toUpperCase() + c.server.slice(1);
}

function MetaStatus({ meta }: { meta: MetaStatusLoad }) {
  const s = meta.settings;
  const reason = s.serverReason === "no_dataset" ? "no dataset id" : s.serverReason === "no_token" ? "no access token" : s.serverReason === "not_production" ? "not the live site, and no test event code" : null;
  return (
    <section className="mt-10 rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">Meta measurement</h2>
      {s.testMode && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Test mode is on (META_TEST_EVENT_CODE is set): server events only show in Events Manager → Test events, not in your ads&apos; results. Remove it and redeploy when testing is done.
        </p>
      )}
      <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">NEXT_PUBLIC_META_PIXEL_ID set</dt>
          <dd>{s.pixelIdSet ? (s.pixelIdValid ? "Yes" : "Yes, but not digits only: ignored") : "No"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">META_CAPI_ACCESS_TOKEN set</dt>
          <dd>{yes(s.tokenSet)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">META_TEST_EVENT_CODE set</dt>
          <dd>{yes(s.testMode)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">META_DRY_RUN</dt>
          <dd>{s.dryRun ? "On: nothing is sent" : "Off"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">This deployment</dt>
          <dd>{s.deployment}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Pixel loads (after Accept)</dt>
          <dd>{yes(s.pixelLoads)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Server events sent from here</dt>
          <dd>{s.serverSends ? "Yes" : `No${reason ? `: ${reason}` : ""}`}</dd>
        </div>
      </dl>

      <h3 className="mt-6 text-sm font-semibold text-foreground">The last 20 conversions</h3>
      {meta.status === "schema_missing" ? (
        <p className="mt-2 text-sm text-muted-foreground">The Batch 19 section of supabase/schema.sql has not been run yet.</p>
      ) : meta.recent.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">None yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">When</th>
                <th className="pr-3">Event</th>
                <th className="pr-3">Value</th>
                <th className="pr-3">Server</th>
                <th className="pr-3">Browser fired it</th>
                <th>Site</th>
              </tr>
            </thead>
            <tbody>
              {meta.recent.map((c, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="py-1 pr-3 whitespace-nowrap">{new Date(c.at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="pr-3">{c.event}</td>
                  <td className="pr-3">{c.valuePence === null ? "—" : `£${(c.valuePence / 100).toFixed(2)}`}</td>
                  <td className="pr-3">{serverResult(c)}</td>
                  <td className="pr-3">{yes(c.browser)}</td>
                  <td>{c.env}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
