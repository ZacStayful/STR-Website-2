import Link from "next/link";
import { Icon } from "@/lib/icons";
import { getPlans, type BillingPlan } from "@/lib/credit/plans";
import { getBillingSettings, getUnitCostTable } from "@/lib/credit/unit-costs";
import { estimateAction } from "@/lib/credit/estimate";
import { formatGbp } from "@/lib/credit/pricing";
import { dailyDealsMonthly, formatPence, fullAnalysesIncluded, newPricingActive, planCreditFor } from "@/lib/credit/deal-pricing";
import { ladderRangeText } from "@/lib/marketplace/ladder";
import { perkLines, pickLine, FREE_PERKS } from "@/lib/credit/perks";
import { SubscribeButton } from "@/components/credit/SubscribeButton";

/**
 * The plan grid, shared by the marketing pages and /upgrade (Batch 10: told
 * in daily deals and Full analyses). Plans and perks come from
 * `billing_plans`; every price and the plan credit come from
 * `billing_settings` (deal prices, daily deals, plan_credit_pence from
 * new_pricing_from), so the page can never drift from what we charge. The
 * "about N Full analyses" is what is left of a month's plan credit after 30
 * days of daily deals, at the Full analysis price.
 */
export async function Pricing({ signupHref = "/signup", signedIn = false, currentPlanCode = null, compact = false }: { signupHref?: string; signedIn?: boolean; currentPlanCode?: string | null; compact?: boolean }) {
  const [plans, settings, table] = await Promise.all([getPlans(), getBillingSettings(), getUnitCostTable()]);
  const pricing = settings.dealPricing;
  const now = new Date();
  const report = estimateAction(table, "report").typicalBasePence;
  const full = pricing.fullAnalysisPence;
  const daily = pricing.todays5DailyPence;
  const topupRate = settings.spendRates.topup;
  const monthly = plans.filter((p) => p.active && p.interval === "month").sort((a, b) => a.sort - b.sort);
  const annual = plans.find((p) => p.active && p.interval === "year") ?? null;
  // Plan credit now, and from the new pricing date when that is still to come.
  const from = pricing.newPricingFrom && !newPricingActive(pricing, now) ? new Date(pricing.newPricingFrom) : null;
  const fromWords = from && Number.isFinite(from.getTime()) ? from.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) : null;
  const analyses = (credit: number) => fullAnalysesIncluded(credit, pricing);
  const welcomeAnalyses = full > 0 ? Math.floor(settings.welcomeGrantPence / full) : 0;
  const gbp = (p: number) => formatGbp(p).replace(".00", "");

  const card = (p: BillingPlan, hl: boolean, tag?: string) => {
    const perMonth = p.interval === "year" ? Math.round(p.pricePence / 12) : p.pricePence;
    const credit = planCreditFor(p, now, pricing);
    const later = from ? planCreditFor(p, from, pricing) : credit;
    const n = analyses(credit);
    return (
      <div key={p.code} className={"plan" + (hl ? " hl" : "")}>
        {tag && <div className="plan-tag">{tag}</div>}
        <div className="plan-name">{p.name}</div>
        <div className="plan-price-row">
          <span className="plan-price">{gbp(p.pricePence)}</span>
          <span className="plan-price-sub">/{p.interval === "year" ? "year" : "month"}</span>
        </div>
        <div className="plan-sub">
          Daily deals every morning + about {n} Full analys{n === 1 ? "is" : "es"} a month
        </div>
        <ul className="plan-features">
          <li>
            <Icon name="check" size={13} color="var(--sage-500)" /> {gbp(credit)} of credit a month{credit > perMonth ? ` (${Math.round(((credit - perMonth) / perMonth) * 100)}% bonus)` : ""}
            {later !== credit && fromWords ? `, ${gbp(later)} from your first renewal on or after ${fromWords}` : ""}
          </li>
          <li><Icon name="check" size={13} color="var(--sage-500)" /> Full analyses of any deal (optional PMI second opinion), reports on any address, Market Explorer</li>
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
              {gbp(settings.welcomeGrantPence)} of credit free.
              <br />
              Then pay for what you use.
            </h2>
            <p className="lede">
              Every account starts with {gbp(settings.welcomeGrantPence)} of credit, about {welcomeAnalyses} Full analyses, and no card. Subscribe for monthly credit, or top up as you go.
            </p>
            <ul className="lede" style={{ listStyle: "none", paddingLeft: 0, marginTop: 12 }}>
              <li><strong>Daily deals:</strong> {formatPence(daily)} a day, {dailyDealsMonthly(daily)}, charged only on days we send them{fromWords ? ` (from ${fromWords}; each pick is priced on its own until then)` : ""}.</li>
              <li><strong>Quick look</strong> at a deal (address, photos, listing): {ladderRangeText(settings.dealOpenLadder)} depending on the deal.</li>
              <li><strong>Full analysis</strong> of a deal: {formatPence(full)}; after a Quick look, the difference. <strong>PMI second opinion:</strong> +{formatPence(pricing.pmiAddonPence)}.</li>
              <li><strong>A report on an address you enter:</strong> about {formatPence(report)}, priced per property with an estimate before it runs.</li>
            </ul>
          </div>
        )}
        <div className="pricing-grid">
          {!signedIn && (
            <div className="plan">
              <div className="plan-name">Free to start</div>
              <div className="plan-price-row">
                <span className="plan-price">{gbp(settings.welcomeGrantPence)}</span>
                <span className="plan-price-sub">credit, no card</span>
              </div>
              <div className="plan-sub">About {welcomeAnalyses} Full analyses · then top up or subscribe</div>
              <ul className="plan-features">
                <li><Icon name="check" size={13} color="var(--sage-500)" /> Full analysis of any deal</li>
                <li><Icon name="check" size={13} color="var(--sage-500)" /> Market Explorer: UK area rankings</li>
                <li><Icon name="check" size={13} color="var(--sage-500)" /> Paste any Rightmove, OnTheMarket or Airbnb link</li>
                <li><Icon name="check" size={13} color="var(--sage-500)" /> Live comparables, forecast &amp; risk</li>
                <li><Icon name="check" size={13} color="var(--sage-500)" /> {pickLine(FREE_PERKS.sourcingCadence)}</li>
                <li><Icon name="check" size={13} color="var(--sage-500)" /> Top-ups from {gbp(settings.topupPresetsPence[0] ?? 1000)}</li>
              </ul>
              <Link href={signupHref} className="btn btn-ghost" style={{ width: "100%", justifyContent: "center" }}>
                Start free <Icon name="arrow" size={14} />
              </Link>
            </div>
          )}
          {monthly.map((p, i) => card(p, p.code === "pro", p.code === "pro" ? "Most popular" : i === monthly.length - 1 ? "Best value" : undefined))}
          {annual && card(annual, false, "Save 25%")}
        </div>
        <div className="pricing-foot muted">
          Prices are in plan credit, ex VAT · Cancel any time, no contract · Plan credit resets each month; top-up credit never expires but is spent at {topupRate}× the plan rate (a Full analysis is {formatPence(full * topupRate)} of top-up credit, {formatPence(full)} on a plan).
        </div>
      </div>
    </section>
  );
}
