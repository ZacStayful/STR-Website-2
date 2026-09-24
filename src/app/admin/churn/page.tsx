import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { hasServiceRole } from "@/lib/supabase/admin";
import { loadConversionInputs, loadPriceMap, loadSubscriptionEvents } from "@/lib/billing/churn-server";
import {
  CHURN_REASON_LABELS,
  TENURE_BANDS,
  churnReasonLabel,
  cyclesEndedSince,
  cyclesFromEvents,
  cyclesOnPlan,
  firstCycleMonth,
  monthlyTrend,
  planCodesIn,
  reasonsByBand,
  retentionByHorizon,
  retentionByPlan,
  revenueByTenureBand,
  type Cycle,
  type HorizonRetention,
} from "@/lib/billing/churn";
import { CONVERSION_WINDOW_DAYS, conversionFunnel } from "@/lib/billing/conversion";
import { WINDOWS, oneOf, windowFor } from "../picks/responses/windows";
import { ChurnTrend, ConversionHistogram, StabilityTrend } from "./ChurnCharts";

export const metadata: Metadata = {
  title: "Churn & retention — Stayful Intelligence",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-3xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

// Next hands a repeated query param (?plan=a&plan=b) as an array, so nothing
// here may assume a string. `oneOf` and `windowFor` are shared with
// /admin/picks/responses rather than re-implemented — windowFor also guards the
// inherited-key case (`toString` passing a bare `in` check and multiplying into
// NaN), which is not worth writing twice.
type Param = string | string[] | undefined;
type Search = { days?: Param; plan?: Param };

const chipClass = (active: boolean) =>
  "rounded-full border px-3 py-1 text-xs font-medium " +
  (active
    ? "border-primary bg-primary/10 text-primary"
    : "border-border text-muted-foreground hover:bg-muted");

function planLabel(code: string): string {
  return code === "none" ? "Granted by hand" : code;
}

/**
 * A note on the sections a filter deliberately does not reach.
 *
 * Half-filtering a page silently is worse than not filtering it at all: the
 * numbers would look like they answered the question on screen when they did
 * not. So every section the window skips says so.
 */
function Ignores({ what }: { what: string }) {
  return <span className="ml-2 text-xs font-normal text-muted-foreground">({what})</span>;
}

function gbp(pence: number): string {
  return `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

/**
 * One horizon.
 *
 * A horizon nobody has answered yet says so, and says when the first answer is
 * due. It never shows 0%, which would read as "everybody left" when it means
 * "nobody has been here long enough to tell".
 */
function HorizonCard({ row }: { row: HorizonRetention }) {
  const measured = row.retentionPct !== null;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{row.months} month{row.months === 1 ? "" : "s"}</span>
        <span className="text-xs text-muted-foreground">{row.label}</span>
      </div>
      {measured ? (
        <>
          <div className="mt-2 text-3xl font-semibold text-foreground">{row.retentionPct}%</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {row.retained} of {row.answerable} still paying
          </div>
          {row.churned > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              {row.churned} left before {row.months} month{row.months === 1 ? "" : "s"}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mt-2 text-lg font-semibold text-muted-foreground">Not measurable yet</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {row.maturing === 0
              ? "No subscriptions recorded."
              : `${row.maturing} customer${row.maturing === 1 ? "" : "s"} still maturing`}
          </div>
          {row.firstAnswerDue && (
            <div className="mt-1 text-xs text-muted-foreground">First answer due {fmtDate(row.firstAnswerDue)}</div>
          )}
        </>
      )}
      {measured && row.maturing > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">{row.maturing} still maturing</div>
      )}
    </div>
  );
}

export default async function ChurnPage({ searchParams }: { searchParams: Promise<Search> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?redirect=/admin/churn");
  // Non-admins get a 404 — don't reveal that the admin area exists.
  if (!isAdminEmail(user.email)) notFound();

  const now = new Date();
  const sp = await searchParams;
  const timeWindow = windowFor(oneOf(sp.days));
  const planParam = oneOf(sp.plan);
  const since = timeWindow.days === null ? null : new Date(now.getTime() - timeWindow.days * 86_400_000).toISOString();

  const [events, prices, conversionInputs] = await Promise.all([
    loadSubscriptionEvents().catch(() => []),
    loadPriceMap().catch(() => ({})),
    loadConversionInputs().catch(() => ({ signups: [], payments: [] })),
  ]);

  const allCycles = cyclesFromEvents(events, now);
  const plans = planCodesIn(allCycles);
  // An unknown ?plan= would otherwise silently empty the page, so it falls back
  // to showing everything rather than to showing nothing.
  const plan = planParam && plans.includes(planParam) ? planParam : null;

  // The PLAN filter is a lens on who, so it reaches everything.
  const cycles = cyclesOnPlan(allCycles, plan);

  // The TIME filter is a lens on when people LEFT, so it reaches only the
  // sections about leaving. Retention deliberately ignores it: a recent window
  // would drop the older cohorts that are the only ones able to answer the long
  // horizons at all, and push the figure towards a flattering 100%. Income
  // stability ignores it too — it is a snapshot of what is being paid now.
  const endedInWindow = cyclesEndedSince(cycles, since);

  const horizons = retentionByHorizon(cycles, now);
  const stability = revenueByTenureBand(cycles, now, prices);
  const crossTab = reasonsByBand(endedInWindow);
  const byPlan = retentionByPlan(cycles, now);
  const windowStart = since ? new Date(since) : null;
  const firstCycle = firstCycleMonth(cycles) ?? now;
  const trendFrom = windowStart && windowStart > firstCycle ? windowStart : firstCycle;
  const trend = monthlyTrend(cycles, trendFrom, now, prices);
  const funnel = conversionFunnel(conversionInputs.signups, conversionInputs.payments, now);

  const atRiskCycles = cycles.filter((c) => c.state === "at_risk");
  const endedCycles = [...endedInWindow].sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
  // At-risk members are a present-tense state, so they show whatever the window
  // is; the ones who left follow it.
  const commentCycles: Cycle[] = [...endedInWindow, ...atRiskCycles];
  const comments = commentCycles
    .filter((c) => c.reasonComment || c.intentComment)
    .map((c) => ({
      comment: (c.reasonComment ?? c.intentComment) as string,
      reason: churnReasonLabel(c.reason ?? c.intentReason),
      at: c.endedAt,
      left: c.endedAt !== null,
    }));

  /** Current filters with `over` applied, on `base`. Shared with the CSV link
   *  so the download can never drift from what is on screen. */
  const qs = (over: { days?: string; plan?: string | null } = {}, base = "/admin/churn") => {
    const next = new URLSearchParams();
    const days = over.days ?? timeWindow.key;
    const p = over.plan === undefined ? plan : over.plan;
    if (days !== "all") next.set("days", days);
    if (p) next.set("plan", p);
    const q = next.toString();
    return q ? `${base}?${q}` : base;
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Churn &amp; retention</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Where members drop off, why they said they left, and how much of the income is the settled kind.
          </p>
        </div>
        <span className="flex gap-4">
          <Link href="/admin" className="text-sm font-medium text-primary hover:underline">
            ← Dashboard
          </Link>
          <Link href={qs({}, "/admin/churn/export")} className="text-sm font-medium text-primary hover:underline">
            Download CSV
          </Link>
        </span>
      </div>

      <div className="mb-6 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">Left in</span>
          {WINDOWS.map((w) => (
            <Link key={w.key} href={qs({ days: w.key })} className={chipClass(w.key === timeWindow.key)}>
              {w.label}
            </Link>
          ))}
        </div>
        {plans.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">Plan</span>
            <Link href={qs({ plan: null })} className={chipClass(plan === null)}>
              All plans
            </Link>
            {plans.map((code) => (
              <Link key={code} href={qs({ plan: code })} className={chipClass(code === plan)}>
                {planLabel(code)}
              </Link>
            ))}
          </div>
        )}
      </div>

      {!hasServiceRole() && (
        <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Couldn’t reach the database (check SUPABASE_SERVICE_ROLE_KEY). Everything below will be empty.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Paying now" value={stability.customers} sub={stability.unpriced > 0 ? `${stability.unpriced} granted by hand, no price` : undefined} />
        <Stat label="Monthly revenue" value={gbp(stability.mrrPence)} sub="annual plans counted by the month" />
        <Stat
          label="Settled income"
          value={stability.stableSharePct === null ? "—" : `${stability.stableSharePct}%`}
          sub="share from customers 6 months or older"
        />
        <Stat
          label="At risk"
          value={stability.atRisk}
          sub={stability.atRiskMrrPence > 0 ? `${gbp(stability.atRiskMrrPence)} past due or paused` : "nobody past due or paused"}
        />
      </div>

      {/* ── Free credit → first payment ─────────────────────────────────── */}
      <h2 className="mt-10 mb-1 text-lg font-semibold text-foreground">
        Free credit → first payment
        <Ignores what={`its own ${CONVERSION_WINDOW_DAYS}-day rule, and no plan yet`} />
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        How long members take to top up. A member who has gone {CONVERSION_WINDOW_DAYS} days without paying
        is discarded rather than left pending; one who pays after that is counted as an anomaly and kept out
        of the headline. Signing straight up to a plan counts as converting, same as buying credit.
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Converted"
          value={funnel.converted}
          sub={funnel.settledPct === null ? "no member has had the full window yet" : `${funnel.settledPct}% of the ${funnel.settled} whose window is up`}
        />
        <Stat label="Still in the window" value={funnel.pending} sub={`under ${CONVERSION_WINDOW_DAYS} days old`} />
        <Stat label="Discarded" value={funnel.discarded} sub={`${CONVERSION_WINDOW_DAYS} days gone, never paid`} />
        <Stat
          label="Anomalies"
          value={funnel.anomalies}
          sub={funnel.anomalies === 0 ? "nobody has paid late" : "paid after the window"}
        />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section
          title="How long they took"
          help={
            funnel.medianDaysToConvert === null
              ? "Nothing to average yet."
              : `Median ${funnel.medianDaysToConvert} days, mean ${funnel.meanDaysToConvert}. Anomalies excluded.`
          }
        >
          <ConversionHistogram buckets={funnel.buckets} />
        </Section>
        <Section title="Which route they took" help="A one-off top-up, or straight onto a plan.">
          {funnel.converted === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody has paid yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {funnel.byRoute.map((r) => (
                <li key={r.route} className="flex items-baseline justify-between border-b border-border pb-2 last:border-0">
                  <span className="text-muted-foreground">{r.route === "topup" ? "Bought credit" : "Went onto a plan"}</span>
                  <span className="tabular-nums">{r.members}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* ── Retention ───────────────────────────────────────────────────── */}
      <h2 className="mt-10 mb-1 text-lg font-semibold text-foreground">
        Retention by horizon
        <Ignores what="all time — the window does not apply" />
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Of the customers whose answer we know, how many were still paying at each point. Somebody who left
        after six weeks answers the three, six and twelve-month questions straight away — we know they
        reached none of them. This is measured across all of history on purpose: narrowing it to a recent
        window would drop the older cohorts that are the only ones old enough to answer the long horizons,
        and flatter the figure.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {horizons.map((row) => (
          <HorizonCard key={row.months} row={row} />
        ))}
      </div>

      {/* Only worth showing when nothing is selected: with a plan chosen the
          cards above already ARE that plan, and this would just restate them. */}
      {plan === null && byPlan.length > 1 && (
        <div className="mt-4">
          <Section title="By plan" help="The same four horizons, split by what they were paying for. Pick a plan above to filter the whole page to it.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Plan</th>
                    <th className="px-2 py-2 font-medium">Customers</th>
                    {horizons.map((h) => (
                      <th key={h.months} className="px-2 py-2 font-medium">
                        {h.months}mo
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byPlan.map((plan) => (
                    <tr key={plan.planCode} className="border-t border-border">
                      <td className="px-2 py-2">{plan.planCode === "none" ? "No plan (granted by hand)" : plan.planCode}</td>
                      <td className="px-2 py-2 tabular-nums">{plan.cycles}</td>
                      {plan.rows.map((row) => (
                        <td key={row.months} className="px-2 py-2 tabular-nums">
                          {row.retentionPct === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            `${row.retentionPct}%`
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}

      {/* ── Income stability ────────────────────────────────────────────── */}
      <h2 className="mt-10 mb-1 text-lg font-semibold text-foreground">
        Income stability
        <Ignores what="as things stand today" />
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        The longer somebody has been paying, the more reliable that money is. Six to twelve months counts as
        settled income and a year or more as the firmest; the first month is the trial phase and the least
        dependable of the lot.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Revenue by tenure, month by month" help="Watch revenue climb into the darker bands.">
          <StabilityTrend points={trend} />
        </Section>
        <Section title="Where the money sits today" help="The same figures as a table, for reading rather than eyeballing.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">Tenure</th>
                  <th className="px-2 py-2 font-medium">Stability</th>
                  <th className="px-2 py-2 font-medium">Customers</th>
                  <th className="px-2 py-2 font-medium">Monthly</th>
                  <th className="px-2 py-2 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {stability.bands.map((band, i) => (
                  <tr key={band.key} className="border-t border-border">
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="inline-block h-3 w-3 rounded-sm border border-border"
                          style={{ background: `var(--tenure-${i + 1})` }}
                        />
                        {band.label}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{band.stability}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {band.customers}
                      {band.atRisk > 0 && <span className="text-destructive"> ({band.atRisk} at risk)</span>}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{gbp(band.mrrPence)}</td>
                    <td className="px-2 py-2 tabular-nums">{band.sharePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stability.unpriced > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {stability.unpriced} plan{stability.unpriced === 1 ? " was" : "s were"} granted by hand and carry
              no price, so they count as customers but add nothing to the revenue figures.
            </p>
          )}
        </Section>
      </div>

      {/* ── The trend ───────────────────────────────────────────────────── */}
      <h2 className="mt-10 mb-3 text-lg font-semibold text-foreground">Subscribers over time</h2>
      <Section title="Starting, leaving, and the rate of it">
        <ChurnTrend points={trend} />
      </Section>

      {/* ── Why ─────────────────────────────────────────────────────────── */}
      <h2 className="mt-10 mb-1 text-lg font-semibold text-foreground">
        Why they left, and how far in
        <Ignores what={timeWindow.days === null ? "all time" : `left in the last ${timeWindow.days} days`} />
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Reasons against the point they dropped off, so a complaint that costs you customers in month two can
        be told apart from one that costs you customers in month eight.
      </p>
      <Section
        title="Reasons by drop-off point"
        help={
          crossTab.churned === 0
            ? "Nobody has left yet."
            : `${crossTab.churned} cancellation${crossTab.churned === 1 ? "" : "s"}, ${gbp(crossTab.mrrLostPence)} a month of revenue gone.`
        }
      >
        {crossTab.churned === 0 ? (
          <p className="text-sm text-muted-foreground">
            No cancellation has been recorded. Reasons are captured from the cancel flow, from the Stripe
            portal, and from a subscription that dies past due.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">Reason</th>
                  {TENURE_BANDS.map((b) => (
                    <th key={b.key} className="px-2 py-2 font-medium">
                      {b.label}
                    </th>
                  ))}
                  <th className="px-2 py-2 font-medium">Total</th>
                  <th className="px-2 py-2 font-medium">Monthly lost</th>
                </tr>
              </thead>
              <tbody>
                {crossTab.reasons.map((r) => (
                  <tr key={r.reason} className="border-t border-border">
                    <td className="px-2 py-2">{r.label}</td>
                    {TENURE_BANDS.map((b) => (
                      <td key={b.key} className="px-2 py-2 tabular-nums">
                        {r.byBand[b.key] ?? <span className="text-muted-foreground">—</span>}
                      </td>
                    ))}
                    <td className="px-2 py-2 font-medium tabular-nums">{r.count}</td>
                    <td className="px-2 py-2 tabular-nums">{gbp(r.mrrLostPence)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border text-muted-foreground">
                  <td className="px-2 py-2">All</td>
                  {crossTab.bandTotals.map((b) => (
                    <td key={b.key} className="px-2 py-2 tabular-nums">
                      {b.count}
                    </td>
                  ))}
                  <td className="px-2 py-2 tabular-nums">{crossTab.churned}</td>
                  <td className="px-2 py-2 tabular-nums">{gbp(crossTab.mrrLostPence)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {comments.length > 0 && (
        <div className="mt-4">
          <Section title="What they actually said" help="Every free-text comment, from a cancellation or a pause.">
            <ul className="space-y-3">
              {comments.map((c, i) => (
                <li key={i} className="border-b border-border pb-3 text-sm last:border-0 last:pb-0">
                  <p className="text-foreground">“{c.comment}”</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.reason}
                    {c.left ? ` · left ${fmtDate(c.at)}` : " · still a customer"}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      {atRiskCycles.length > 0 && (
        <div className="mt-4">
          <Section
            title="At risk right now"
            help="Past due or paused. Neither gone nor safe — this is the list worth a phone call."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Plan</th>
                    <th className="px-2 py-2 font-medium">Why</th>
                    <th className="px-2 py-2 font-medium">With us</th>
                    <th className="px-2 py-2 font-medium">Monthly</th>
                    <th className="px-2 py-2 font-medium">What they said</th>
                  </tr>
                </thead>
                <tbody>
                  {atRiskCycles.map((c, i) => (
                    <tr key={`${c.userId}-${i}`} className="border-t border-border">
                      <td className="px-2 py-2">{c.planCode ?? "—"}</td>
                      <td className="px-2 py-2">{c.riskKind === "past_due" ? "Payment failed" : "Paused"}</td>
                      <td className="px-2 py-2 tabular-nums">{c.tenureDays} days</td>
                      <td className="px-2 py-2 tabular-nums">{gbp(c.mrrPence ?? 0)}</td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {c.intentComment ?? churnReasonLabel(c.intentReason)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}

      {endedCycles.length > 0 && (
        <div className="mt-4">
          <Section
            title="Recent cancellations"
            help={timeWindow.days === null ? "Everyone who has left." : `Everyone who left in the last ${timeWindow.days} days.`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Left</th>
                    <th className="px-2 py-2 font-medium">Plan</th>
                    <th className="px-2 py-2 font-medium">Lasted</th>
                    <th className="px-2 py-2 font-medium">Reason</th>
                    <th className="px-2 py-2 font-medium">Where from</th>
                  </tr>
                </thead>
                <tbody>
                  {endedCycles.slice(0, 25).map((c, i) => (
                    <tr key={`${c.userId}-${i}`} className="border-t border-border">
                      <td className="px-2 py-2">{fmtDate(c.endedAt)}</td>
                      <td className="px-2 py-2">{c.planCode ?? "—"}</td>
                      <td className="px-2 py-2 tabular-nums">{c.tenureDays} days</td>
                      <td className="px-2 py-2">{churnReasonLabel(c.reason)}</td>
                      <td className="px-2 py-2 text-muted-foreground">{c.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}

      {cycles.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No subscription history recorded yet.</p>
          <p className="mt-2">
            Every start, pause, cancellation and payment failure is logged from now on, so the horizons above
            fill in by themselves. To pull in whatever Stripe already holds, run{" "}
            <code>node scripts/churn-backfill.mjs</code> (add <code>--apply</code> to write it).
          </p>
          <p className="mt-2">
            Reasons are only as good as what gets captured, and the known gap is a cancellation made straight
            from the Stripe dashboard — {Object.keys(CHURN_REASON_LABELS).length} reasons are recognised,
            including a card that failed.
          </p>
        </div>
      )}
    </div>
  );
}
