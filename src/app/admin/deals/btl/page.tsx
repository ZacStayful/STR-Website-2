import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { btlAdminView } from "@/lib/btl/admin-server";
import { FUNNEL_TYPES, keepRate, othersThan, sharePct, type Funnel } from "@/lib/btl/admin";
import { BTL_PRIORITY_LABELS, type BtlPriority } from "@/lib/btl/rules";
import { CASH_BAND_LABELS } from "@/lib/btl/sheet";
import type { CashBand } from "@/lib/btl/deal";
import { DEAL_TYPE_LABELS } from "@/lib/profile/deal-types";
import { weekLabel } from "@/lib/activity/week";

export const metadata: Metadata = { title: "Buy-to-let admin — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const pence = (p: number) => `£${(p / 100).toFixed(2)}`;
const dash = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("en-GB"));
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-3xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

const bandLabel = (k: string) => (k in CASH_BAND_LABELS ? CASH_BAND_LABELS[k as CashBand] : k === "unanswered" ? "not answered" : k);
const priorityLabel = (k: string) => (k in BTL_PRIORITY_LABELS ? BTL_PRIORITY_LABELS[k as BtlPriority] : k === "unanswered" ? "not answered" : k);
const counts = (o: Record<string, number>, label: (k: string) => string) =>
  Object.entries(o)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${label(k)} ${n}`)
    .join(" · ") || "—";

function FunnelRow({ label, f, strong = false }: { label: string; f: Funnel; strong?: boolean }) {
  return (
    <tr className={`border-t border-border ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
      <td className="py-1.5">{label}</td>
      <td>{f.shown.toLocaleString("en-GB")}</td>
      <td>{f.opened.toLocaleString("en-GB")}</td>
      <td>{pct(sharePct(f.opened, f.shown))}</td>
      <td>{f.keeps.toLocaleString("en-GB")}</td>
      <td>{f.passes.toLocaleString("en-GB")}</td>
      <td>{pct(keepRate(f))}</td>
    </tr>
  );
}

/**
 * What buy-to-let is doing (Batch 28, Part J): who chose it, what they were
 * shown, opened and kept this week against the other types, the £2 reports,
 * how often a day looked beyond the member's areas, the shortlist's spend
 * today against its cap, and the live buy-to-let deals. Member figures leave
 * out admin, staff and "Exclude from metrics" accounts. No member or deal is
 * named.
 */
export default async function BtlAdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/deals/btl");
  if (!isAdminEmail(user.email)) notFound();

  const v = await btlAdminView(createAdminClient());
  const btl = v.funnel?.btl ?? null;
  const others = v.funnel ? othersThan(v.funnel, "btl") : null;
  const spendKnown = v.spend.pence >= 0;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Buy-to-let deals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The week of {weekLabel(v.weekStart)} (UK, from Monday) unless it says otherwise. A deal that is both a short-let and a buy-to-let deal counts once, as the type its member was shown it as. {v.excluded} account{v.excluded === 1 ? "" : "s"} left out (admin, staff, excluded from metrics). The screen&apos;s settings, cap and run buttons are on the deals page.
          </p>
        </div>
        <Link href="/admin/deals" className="text-sm font-medium text-primary hover:underline">← Deals marketplace</Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Members with Buy to let" value={dash(v.members?.members)} sub={v.members ? `${v.members.profiles} profile${v.members.profiles === 1 ? "" : "s"} · ${v.members.without} members without it yet` : undefined} />
        <Stat label="Buy-to-let deals shown" value={dash(btl?.shown)} sub={btl ? `${btl.opened} opened · ${btl.keeps} kept` : undefined} />
        <Stat label="Keep rate: Buy to let" value={btl ? pct(keepRate(btl)) : "—"} sub={others ? `every other type: ${pct(keepRate(others))}` : undefined} />
        <Stat label="Looked beyond their areas" value={v.widen ? pct(sharePct(v.widen.widened, v.widen.lists)) : "—"} sub={v.widen ? `${v.widen.widened} of ${v.widen.lists} Today lists with buy-to-let deals` : undefined} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="BTL reports this week" value={dash(v.reports?.week)} sub={v.reports ? `${pence(v.reports.weekPence)} revenue` : undefined} />
        <Stat label="BTL reports, last 30 days" value={dash(v.reports?.month)} sub={v.reports ? `${pence(v.reports.monthPence)} revenue · ${v.reports.welcomeMonth} at the welcome price · ${v.reports.failedMonth} failed (charged nothing)` : undefined} />
        <Stat label="Shortlist spend today" value={spendKnown ? `${pence(v.spend.pence)} of ${pence(v.spend.capPence)}` : "unreadable"} sub={v.spend.valuations >= 0 ? `${v.spend.valuations} of ${v.spend.capValuations} rent valuations · UK day` : "the screen buys nothing while this is unreadable"} />
        <Stat label="Live buy-to-let deals" value={dash(v.live?.total)} sub={v.live ? `${v.live.alsoShortLet} also short-let deals · ${v.live.valued} with a rent valuation` : undefined} />
      </div>

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Shown, opened and kept, by type</h2>
        {v.funnel ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-1">Type</th><th>Shown on Today</th><th>Opened</th><th>Opened ÷ shown</th><th>Kept</th><th>Passed</th><th>Keep rate</th></tr>
              </thead>
              <tbody>
                {FUNNEL_TYPES.map((t) => (
                  <FunnelRow key={t} label={DEAL_TYPE_LABELS[t]} f={v.funnel![t]} strong={t === "btl"} />
                ))}
                {others && <FunnelRow label="Every type but Buy to let" f={others} />}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">Shown: the deals on each profile&apos;s Today this week (those replaced during a day included). Opened and kept by the profile they were opened or kept under. Keep rate: keeps ÷ (keeps + passes); Keeps Stayful Intelligence made are left out.</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">—</p>
        )}
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <h2 className="text-base font-semibold text-foreground">Who chose it</h2>
          <p className="mt-2 text-muted-foreground">By priority: {v.members ? counts(v.members.byPriority, priorityLabel) : "—"}</p>
          <p className="mt-1 text-muted-foreground">By cash band: {v.members ? counts(v.members.byBand, bandLabel) : "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">Per profile with Buy to let ticked. &quot;All of them&quot; profiles from before buy-to-let are not counted until their member taps.</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <h2 className="text-base font-semibold text-foreground">Looking further</h2>
          <p className="mt-2 text-muted-foreground">{v.widen ? `Up to some miles out ${v.widen.byScope.miles} · across the region ${v.widen.byScope.region} · across the UK ${v.widen.byScope.national}` : "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">The furthest step any shown buy-to-let deal came from, per Today list. A high rate says members&apos; own areas are thin for their cash band.</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <h2 className="text-base font-semibold text-foreground">Live buy-to-let deals</h2>
          <p className="mt-2 text-muted-foreground">By cash band: {v.live ? counts(v.live.byBand, bandLabel) : "—"}</p>
          <p className="mt-1 text-muted-foreground">By rent confidence: {v.live ? counts(v.live.byConfidence, (k) => k) : "—"}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <h2 className="text-base font-semibold text-foreground">Members&apos; actions this week</h2>
          <ul className="mt-2 text-muted-foreground">
            <li>Deal types changed: {dash(v.activity?.dealTypeEdits)}</li>
            <li>Buy-to-let priority or cash band answered: {dash(v.activity?.btlAnswers)}</li>
            <li>BTL reports run: {dash(v.activity?.reportsRun)}</li>
            <li>Explorer &quot;Buy to let&quot; view opened: {dash(v.activity?.explorerToggles)} (recorded only; not weekly-active)</li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Launch email line: {v.launch.from ? `from ${new Date(v.launch.from).toLocaleString("en-GB", { timeZone: "Europe/London" })}` : "not switched on (billing_settings.btl_launch_from)"} · sent to {dash(v.launch.sent)} member{v.launch.sent === 1 ? "" : "s"} so far.
          </p>
        </div>
      </section>
    </div>
  );
}
