import type { ReactNode } from "react";
import Link from "next/link";
import type { WeeklyActiveStatus } from "@/lib/activity/admin-server";
import { ACTIVITY_KINDS, type ActivityKind } from "@/lib/activity/kinds";
import { DRILL_WEEKS, pct, type ExcludedRow, type WeekMetrics, type WeeklyActiveReport } from "@/lib/activity/metrics";
import {
  actionsPerVisit,
  CATEGORY_LABELS,
  drillMembers,
  GROUPS,
  keepRate,
  medianVisit,
  memberWeeks,
  onTarget,
  openToReport,
  reportsPerActive,
  shareCell,
  trackingNote,
  trendPanels,
  visitsPerActive,
  type Group,
} from "@/lib/activity/view";
import { WeeklyActiveTrend } from "./TrendChart";
import { BackfillPanel, RetentionCheck } from "./BackfillPanel";
import { setExclusionAction } from "./actions";
import { AnalysisTakeUp } from "./AnalysisTakeUp";

const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  excluded: { text: "Switched off: that account is left out of every figure from now on, past weeks included.", ok: true },
  included: { text: "Switched back on: that account counts again.", ok: true },
  failed: { text: "Not saved. Try again.", ok: false },
};

const EXCLUSION_LABELS: Record<ExcludedRow["reason"], string> = {
  admin: "Admin (ADMIN_EMAILS)",
  staff: "Stayful staff (@stayful.co.uk)",
  manual: "Switched off here",
};

const KIND_NAMES = Object.keys(ACTIVITY_KINDS) as ActivityKind[];

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function day(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" });
}

function weekName(w: WeekMetrics): string {
  return w.current ? `${w.label} (so far)` : w.label;
}

function GroupCard({ group, thisWeek, lastWeek }: { group: Group; thisWeek: WeekMetrics | null; lastWeek: WeekMetrics | null }) {
  const last = lastWeek ? lastWeek[group.key] : null;
  const now = thisWeek ? thisWeek[group.key] : null;
  // Before live tracking the figure undercounts: no verdict on it.
  const backfilled = lastWeek?.tracked === "none";
  const met = last && !backfilled ? onTarget(last, group.target) : null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{group.title}</span>
        <span className="text-xs text-muted-foreground">{group.target === null ? "no target" : `target ${group.target}%`}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{last ? pct(last) : "—"}</div>
      <div className="text-xs text-muted-foreground">
        Last week{last && last.base > 0 ? `: ${last.active} of ${last.base}` : ""}
        {backfilled ? " · backfilled history" : met === null ? "" : met ? " · on target" : " · below target"}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">This week so far: {now ? shareCell(now) : "—"}</div>
      <p className="mt-2 text-xs text-muted-foreground">{group.who}</p>
    </div>
  );
}

/**
 * /admin/weekly-active, drawn from figures already loaded (page.tsx loads
 * them after checking the admin session). No reads here, so the same view
 * can be checked against made-up figures.
 */
export function WeeklyActiveView({ status, message, report, msg, showAll }: { status: WeeklyActiveStatus; message: string | null; report: WeeklyActiveReport; msg: string | null; showAll: boolean }) {
  const weeks = report.weeks;
  const newestFirst = [...weeks].reverse();
  const thisWeek = weeks.at(-1) ?? null;
  const lastWeek = weeks.at(-2) ?? null;
  const members = drillMembers(report.members, showAll);
  const drill = weeks.slice(-DRILL_WEEKS);
  const notice = msg ? MESSAGES[msg] ?? null : null;
  const qualifying = KIND_NAMES.filter((k) => ACTIVITY_KINDS[k].qualifying);
  const recordOnly = KIND_NAMES.filter((k) => !ACTIVITY_KINDS[k].qualifying);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Weekly active</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            A member is active in a week (Monday to Sunday, UK time) when they did at least one thing in the app. Admins, @stayful.co.uk addresses and accounts switched off below are left out of every figure. Billing groups are judged at the end of each week; a team member is in their owner&rsquo;s group.
          </p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">
          ← Admin
        </Link>
      </div>

      {status === "no_service_role" && <Notice>The service role key (SUPABASE_SERVICE_ROLE_KEY) is not set, so nothing can be read.</Notice>}
      {status === "schema_missing" && <Notice>The Batch 9 section of supabase/schema.sql has not been run on this database yet. Run it in the Supabase SQL editor, then reload.</Notice>}
      {status === "failed" && <Notice>Couldn&rsquo;t read the figures: {message}</Notice>}
      {status === "ok" && (
        <Notice>
          {report.trackingSince
            ? `Live tracking since ${when(report.trackingSince)}. Weeks before it come from the backfill, which undercounts.`
            : "Live tracking has not started: nothing has been logged in production yet. Until it has, the figures are backfilled history only."}
        </Notice>
      )}
      {notice && <div className={`mb-4 rounded-lg border p-3 text-sm ${notice.ok ? "border-border bg-card text-foreground" : "border-destructive/40 bg-card text-destructive"}`}>{notice.text}</div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {GROUPS.map((g) => (
          <GroupCard key={g.key} group={g} thisWeek={thisWeek} lastWeek={lastWeek} />
        ))}
      </div>

      <h2 className="mt-10 mb-3 text-lg font-semibold text-foreground">The last 12 weeks</h2>
      <WeeklyActiveTrend panels={trendPanels(weeks)} />

      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Week of</th>
              {GROUPS.map((g) => (
                <th key={g.key} className="px-4 py-2 font-medium">
                  {g.title}
                  {g.target !== null && <span className="font-normal"> ({g.target}%)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((w) => (
              <tr key={w.week} className="border-t border-border/60">
                <td className="px-4 py-2 whitespace-nowrap">
                  {weekName(w)}
                  {trackingNote(w) && <div className="text-xs text-muted-foreground">{trackingNote(w)}</div>}
                </td>
                {GROUPS.map((g) => (
                  <td key={g.key} className="px-4 py-2 whitespace-nowrap tabular-nums">
                    {shareCell(w[g.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 mb-3 text-lg font-semibold text-foreground">How they use it</h2>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Week of</th>
              <th className="px-4 py-2 font-medium">Visits per active member</th>
              <th className="px-4 py-2 font-medium">Actions per visit</th>
              <th className="px-4 py-2 font-medium">
                Median visit <span className="font-normal">(a warning sign, not a goal)</span>
              </th>
              <th className="px-4 py-2 font-medium">Open → report within 14 days</th>
              <th className="px-4 py-2 font-medium">Reports per active member</th>
              <th className="px-4 py-2 font-medium">Keep rate on Today&rsquo;s 5</th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((w) => {
              const o2r = openToReport(w);
              return (
                <tr key={w.week} className="border-t border-border/60">
                  <td className="px-4 py-2 whitespace-nowrap">{weekName(w)}</td>
                  <td className="px-4 py-2 tabular-nums">{visitsPerActive(w)}</td>
                  <td className="px-4 py-2 tabular-nums">{actionsPerVisit(w)}</td>
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">{medianVisit(w)}</td>
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                    {o2r.value}
                    {o2r.note && <div className="text-xs text-muted-foreground">{o2r.note}</div>}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{reportsPerActive(w)}</td>
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">{keepRate(w)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Before live tracking: visits, actions per visit, visit time and the keep rate were not recorded (shown as —); weekly active is undercounted; reports per active member reads high, because every report was recorded but not every active member. A visit ends after 30 minutes with nothing happening; its time runs from the first page to the last sign of use.
      </p>

      <h2 className="mt-10 mb-3 text-lg font-semibold text-foreground">Full analyses and reminders</h2>
      <AnalysisTakeUp ready={status === "ok"} excluded={report.excluded.map((x) => x.id)} />

      <h2 id="members" className="mt-10 mb-1 text-lg font-semibold text-foreground">
        Members
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        The last {drill.length} weeks, oldest first: ● active, ○ not, – not a member yet.{" "}
        {showAll ? (
          <>
            All {report.members.length} members ·{" "}
            <Link href="/admin/weekly-active#members" className="text-primary hover:underline">
              only those who did something
            </Link>
          </>
        ) : (
          <>
            The {members.length} of {report.members.length} members who did something in these weeks ·{" "}
            <Link href="/admin/weekly-active?all=1#members" className="text-primary hover:underline">
              show everyone
            </Link>
          </>
        )}
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Member</th>
              <th className="px-4 py-2 font-medium">Billing group</th>
              <th className="px-4 py-2 font-medium">
                Weeks active
                <div className="font-normal">
                  {drill[0]?.label ?? ""} → {drill.at(-1)?.label ?? ""}
                </div>
              </th>
              <th className="px-4 py-2 font-medium">Visits</th>
              <th className="px-4 py-2 font-medium">Actions</th>
              <th className="px-4 py-2 font-medium">Last action</th>
              <th className="px-4 py-2 font-medium">
                <span className="sr-only">Exclude from metrics</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-muted-foreground" colSpan={7}>
                  {report.members.length === 0 ? "No members to show." : "Nobody did anything in these weeks."}
                </td>
              </tr>
            ) : (
              members.map((m) => {
                const weeksShown = memberWeeks(m);
                const activeWeeks = weeksShown.filter((w) => w.active).length;
                const weeksAsMember = weeksShown.filter((w) => w.member).length;
                return (
                  <tr key={m.id} className="border-t border-border/60 align-top">
                    <td className="px-4 py-2">
                      <div className="text-foreground">{m.email ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.name ? `${m.name} · ` : ""}joined {day(m.joined)}
                      </div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {CATEGORY_LABELS[m.category]}
                      {m.category === "paying" && <div className="text-xs text-muted-foreground">{m.paidRecently ? "paid in the last 90 days" : "not paid in 90 days"}</div>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1" aria-hidden="true">
                        {weeksShown.map((w, i) =>
                          w.member ? (
                            <span
                              key={w.week}
                              title={`Week of ${drill[i]?.label ?? w.week}: ${w.active ? "active" : "not active"} · ${w.visits} visits · ${w.actions} actions`}
                              className={`inline-block h-2.5 w-2.5 rounded-full ${w.active ? "bg-primary" : "border border-border"}`}
                            />
                          ) : (
                            <span key={w.week} title={`Week of ${drill[i]?.label ?? w.week}: not a member yet`} className="inline-block h-0.5 w-2.5 rounded bg-border" />
                          ),
                        )}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                        {activeWeeks}/{weeksAsMember}
                      </span>
                      <span className="sr-only">
                        Active in {activeWeeks} of {weeksAsMember} weeks as a member
                      </span>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{m.weeks.reduce((n, w) => n + w.visits, 0)}</td>
                    <td className="px-4 py-2 tabular-nums">{m.weeks.reduce((n, w) => n + w.actions, 0)}</td>
                    <td className="px-4 py-2">
                      {m.lastAction ? (
                        <>
                          <div className="text-foreground">{m.lastAction.label}</div>
                          <div className="text-xs text-muted-foreground">{when(m.lastAction.at)}</div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <form action={setExclusionAction}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="exclude" value="1" />
                        {showAll && <input type="hidden" name="all" value="1" />}
                        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted" title="Leave this account out of every figure (a test account, a colleague)">
                          Exclude
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 mb-3 text-lg font-semibold text-foreground">Left out of the figures ({report.excluded.length})</h2>
      {report.excluded.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Why</th>
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">Include again</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {report.excluded.map((x) => (
                <tr key={x.id} className="border-t border-border/60">
                  <td className="px-4 py-2">
                    <div className="text-foreground">{x.email ?? "—"}</div>
                    {x.name && <div className="text-xs text-muted-foreground">{x.name}</div>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {EXCLUSION_LABELS[x.reason]}
                    {x.note ? `: ${x.note}` : ""}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {x.reason === "manual" && (
                      <form action={setExclusionAction}>
                        <input type="hidden" name="id" value={x.id} />
                        <input type="hidden" name="exclude" value="0" />
                        {showAll && <input type="hidden" name="all" value="1" />}
                        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
                          Include again
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="mt-10 rounded-xl border border-border bg-card p-5 text-sm">
        <summary className="cursor-pointer font-medium text-foreground">What counts as doing something</summary>
        <div className="mt-3 grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Counts towards weekly active</div>
            <ul className="space-y-0.5 text-foreground">
              {qualifying.map((k) => (
                <li key={k}>{ACTIVITY_KINDS[k].label}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Recorded, but does not count</div>
            <ul className="space-y-0.5 text-foreground">
              {recordOnly.map((k) => (
                <li key={k}>{ACTIVITY_KINDS[k].label}</li>
              ))}
            </ul>
          </div>
        </div>
      </details>

      <h2 id="backfill" className="mt-10 mb-1 text-lg font-semibold text-foreground">
        Backfill
      </h2>
      <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
        Copies history from the tables that already recorded what members did (deal opens, Keep and Pass, reports, shares, top-ups, answers to pick emails, next steps and plan changes) into the log, up to the first event logged live in production and no further back than 24 months. Every copied row has a key, and a key already in the log is skipped, so running it twice adds nothing. Today&rsquo;s lists and first-week steps are not copied.
      </p>
      <BackfillPanel />

      <h2 className="mt-10 mb-1 text-lg font-semibold text-foreground">Retention</h2>
      <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
        Events and visits older than 24 months are deleted every night at 02:35 UTC (/api/internal/activity-retention; add ?dry=1 to count only).
      </p>
      <RetentionCheck />
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="mb-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{children}</div>;
}
