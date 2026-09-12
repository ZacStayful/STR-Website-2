import { Icon } from "@/lib/icons";
import { getPlans, type BillingPlan } from "@/lib/credit/plans";
import { getBillingSettings, getUnitCostTable } from "@/lib/credit/unit-costs";
import { estimateAction } from "@/lib/credit/estimate";
import { formatGbp } from "@/lib/credit/pricing";
import { perkLines } from "@/lib/credit/perks";
import { SubscribeButton } from "@/components/credit/SubscribeButton";

/**
 * The plan grid, shared by the marketing pages and /upgrade. Plans, credit
 * amounts and perks come from `billing_plans`; the "≈ N reports" line uses the
 * live unit-cost table so the page can never drift from what we charge.
 */
export async function Pricing({ signupHref = "/signup", signedIn = false, currentPlanCode = null, compact = false }: { signupHref?: string; signedIn?: boolean; currentPlanCode?: string | null; compact?: boolean }) {
  const [plans, settings, table] = await Promise.all([getPlans(), getBillingSettings(), getUnitCostTable()]);
  const report = estimateAction(table, "report", { pmiSecondOpinion: process.env.PMI_SECOND_OPINION !== "false" }).typicalBasePence;
  const reportsFor = (pence: number) => (report > 0 ? Math.floor((pence / report) * 10) / 10 : 0);
  const fmtReports = (n: number) => `${n.toFixed(1).replace(/\.0$/, "")} report${n === 1 ? "" : "s"}`;
  const monthly = plans.filter((p) => p.active && p.interval === "month").sort((a, b) => a.sort - b.sort);
  const annual = plans.find((p) => p.active && p.interval === "year") ?? null;
  const topupReport = Math.round(report * settings.spendRates.topup);

  const card = (p: BillingPlan, hl: boolean, tag?: string) => {
    const perMonth = p.interval === "year" ? Math.round(p.pricePence / 12) : p.pricePence;
    const bonus = p.monthlyCreditPence - perMonth;
    return (
      <div key={p.code} className={"plan" + (hl ? " hl" : "")}>
        {tag && <div className="plan-tag">{tag}</div>}
        <div className="plan-name">{p.name}</div>
        <div className="plan-price-row">
          <span className="plan-price">{formatGbp(p.pricePence).replace(".00", "")}</span>
          <span className="plan-price-sub">/{p.interval === "year" ? "year" : "month"}</span>
        </div>
        <div className="plan-sub">
          {formatGbp(p.monthlyCreditPence).replace(".00", "")} of credit every month{bonus > 0 ? ` (${Math.round((bonus / perMonth) * 100)}% bonus)` : ""} · ≈ {fmtReports(reportsFor(p.monthlyCreditPence))}
        </div>
        <ul className="plan-features">
          <li><Icon name="check" size={13} color="var(--sage-500)" /> {formatGbp(p.monthlyCreditPence).replace(".00", "")} credit a month, spent at the standard rate</li>
          <li><Icon name="check" size={13} color="var(--sage-500)" /> Full 10-section reports, Market Explorer, listing checks</li>
          <li><Icon name="check" size={13} color="var(--sage-500)" /> Deal pipeline, PDF export, saved reports</li>
          {perkLines(p.perks).map((l) => (
            <li key={l}><Icon name="check" size={13} color="var(--sage-500)" /> {l}</li>
          ))}
          <li><Icon name="check" size={13} color="var(--sage-500)" /> Cancel any time · unused plan credit resets monthly</li>
        </ul>
        <SubscribeButton planCode={p.code} label={signedIn ? `Choose ${p.name}` : "Start free"} className={"btn " + (hl ? "btn-primary" : "btn-ghost")} signedIn={signedIn} signupHref={signupHref} current={currentPlanCode === p.code} />
      </div>
    );
  };

  return (
    <section className="pricing section" id="pricing">
      <div className="wrap-narrow">
        {!compact && (
          <div className="pricing-head">
            <div className="eyebrow">Pricing</div>
            <h2>
              {formatGbp(settings.welcomeGrantPence).replace(".00", "")} of credit free.
              <br />
              Then pay for what you use.
            </h2>
            <p className="lede">
              Every account starts with {formatGbp(settings.welcomeGrantPence).replace(".00", "")} of credit — about {fmtReports(reportsFor(settings.welcomeGrantPence))} — and no card. A full report uses about {formatGbp(report)} of plan credit. Subscribe for monthly credit, or top up as you go.
            </p>
          </div>
        )}
        <div className="pricing-grid">
          {!signedIn && (
            <div className="plan">
              <div className="plan-name">Free to start</div>
              <div className="plan-price-row">
                <span className="plan-price">{formatGbp(settings.welcomeGrantPence).replace(".00", "")}</span>
                <span className="plan-price-sub">credit, no card</span>
              </div>
              <div className="plan-sub">≈ {fmtReports(reportsFor(settings.welcomeGrantPence))} · then top up or subscribe</div>
              <ul className="plan-features">
                <li><Icon name="check" size={13} color="var(--sage-500)" /> Full 10-section report</li>
                <li><Icon name="check" size={13} color="var(--sage-500)" /> Market Explorer: UK area rankings</li>
                <li><Icon name="check" size={13} color="var(--sage-500)" /> Paste any Rightmove, OnTheMarket or Airbnb link</li>
                <li><Icon name="check" size={13} color="var(--sage-500)" /> Live comparables, forecast &amp; risk</li>
                <li><Icon name="check" size={13} color="var(--sage-500)" /> Top-ups from {formatGbp(settings.topupPresetsPence[0] ?? 1000).replace(".00", "")}</li>
              </ul>
              <a href={signupHref} className="btn btn-ghost" style={{ width: "100%", justifyContent: "center" }}>
                Start free <Icon name="arrow" size={14} />
              </a>
            </div>
          )}
          {monthly.map((p, i) => card(p, p.code === "pro", p.code === "pro" ? "Most popular" : i === monthly.length - 1 ? "Best value" : undefined))}
          {annual && card(annual, false, "Save 25%")}
        </div>
        <div className="pricing-foot muted">
          All prices ex VAT · Cancel any time, no contract · Plan credit resets each month; top-up credit never expires but is spent at {settings.spendRates.topup}× the plan rate (a report costs about {formatGbp(topupReport)} of top-up credit vs {formatGbp(report)} of plan credit).
        </div>
      </div>
    </section>
  );
}
