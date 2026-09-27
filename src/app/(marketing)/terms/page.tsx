import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/url";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { dailyDealsMonthly, formatPence, newPricingActive } from "@/lib/credit/deal-pricing";
import { ladderRangeText } from "@/lib/marketplace/ladder";

export const metadata: Metadata = {
  title: "Terms of service — Stayful Intelligence",
  description: "The terms that apply to Stayful Intelligence accounts, subscriptions and credit.",
  alternates: { canonical: siteUrl("/terms") },
};

export const dynamic = "force-dynamic";

const LAST_UPDATED = "27 September 2026";

/**
 * Sections 1, 2 and 4 follow the legal drafts of 27 September 2026 (Batch
 * 10). The prices in section 2 are read from billing_settings, so the terms
 * always state what the buttons charge.
 */
export default async function TermsPage() {
  const settings = await getBillingSettings();
  const p = settings.dealPricing;
  const topup = settings.spendRates.topup;
  const date = p.newPricingFrom ? new Date(p.newPricingFrom) : null;
  const dateWords = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;
  const started = newPricingActive(p);
  // Daily deals and 1:1 plan credit start on the new pricing date; until one is set, the date comes by email.
  const fromDate = started ? "" : dateWords ? ` From ${dateWords}:` : " From a date we will email you at least 14 days before:";

  return (
    <section className="section">
      <div className="wrap-narrow">
        <div className="eyebrow">Legal</div>
        <h1 className="upgrade-title">Terms of service</h1>
        <p className="lede">Last updated {LAST_UPDATED}. These terms apply to every Stayful Intelligence account. By creating an account, subscribing or buying credit you agree to them.</p>

        <h2 id="service">1. The service</h2>
        <p>
          Stayful Intelligence finds and screens UK property listings for short-term let potential and provides income estimates, market data and related tools. Figures on deal cards and deal sheets are area estimates, often shown as a range. A full analysis gives a figure for the specific property but is still an estimate based on third-party data. Nothing on the service is a survey, valuation, guarantee of income, or financial, legal, tax or investment advice. Check any property independently and take professional advice before committing money.
        </p>

        <h2 id="credit">2. Credit</h2>
        <ul>
          <li><strong>How credit works.</strong> Paid features (Quick looks and Full analyses of deals, daily deals, reports on an address you enter, the optional PMI second opinion, listing checks, AI narration, address and market lookups) use credit. Each shows its price, or an estimate, before it runs and the exact amount used afterwards on your billing page.</li>
          <li>
            <strong>Deal prices.</strong> For deals in your feed, a Quick look costs {ladderRangeText(settings.dealOpenLadder)} depending on the deal, a Full analysis costs {formatPence(p.fullAnalysisPence)} and the optional PMI second opinion costs {formatPence(p.pmiAddonPence)} more. If you take a Quick look first, upgrading to a Full analysis costs the difference. These prices are shown before you pay and may change; any change is shown on the button before you pay.
          </li>
          <li><strong>Saved analyses.</strong> A Full analysis may use a recent analysis of the same property, shown with the date it was run. Analyses older than {p.analysisReuseDays} days are run again.</li>
          <li><strong>Address reports.</strong> Reports on an address you enter yourself are priced per property, with an estimate shown before they run.</li>
          <li>
            <strong>Daily deals.</strong>
            {fromDate} Your Today&apos;s 5 email costs {formatPence(p.todays5DailyPence)} a day on a plan ({dailyDealsMonthly(p.todays5DailyPence)}), charged only on days we send it. You can switch it off any time in Account → Notifications.
          </li>
          <li><strong>Welcome credit</strong> is a one-off promotional grant for new accounts. It is not transferable, has no cash value and may be withheld or reversed where an account is created to abuse the offer (for example with temporary email addresses or a mobile number already used on another account).</li>
          <li>
            <strong>Plan credit</strong> is added at the start of each billing period of a subscription and expires, unused, at the end of that period. It does not roll over.
            {fromDate ? `${fromDate} each plan's monthly credit equals what you pay for it, £1 of credit for every £1, from your first renewal on or after that date (an annual plan: its first annual renewal on or after it).` : " Each plan's monthly credit equals what you pay for it: £1 of credit for every £1."}
          </li>
          <li><strong>Top-up credit</strong> is bought as a one-off payment, never expires while your account is open, and is spent at a higher rate than plan credit (currently {topup}× — shown on every top-up screen).</li>
          <li><strong>Promo and referral credit</strong> is spent at the top-up rate and may carry an expiry date shown when it is granted.</li>
          <li><strong>Refunds.</strong> Credit that has been spent is non-refundable. Unspent top-up credit bought as a consumer can be refunded within 14 days of purchase under the Consumer Contracts Regulations; contact <a href="mailto:hello@stayful.co.uk">hello@stayful.co.uk</a>. If a top-up payment is refunded or disputed, the corresponding credit is removed from your account.</li>
          <li><strong>Prices.</strong> Reports on an address you enter are priced from our data providers&apos; costs. Deal prices and daily deals are set by us. Prices are in plan credit (top-up credit is spent at {topup}×), are shown before you pay (daily deals in Account → Notifications), and may change. All prices are ex VAT unless stated.</li>
        </ul>

        <h2 id="subscriptions">3. Subscriptions</h2>
        <p>Subscriptions renew automatically each month or year until cancelled. You can cancel any time from your billing page; access and plan credit continue until the end of the period already paid for. Upgrades take effect immediately and are prorated; downgrades take effect at the next renewal.</p>

        <h2 id="acceptable-use">4. Acceptable use</h2>
        <p>
          One account per person. Don&apos;t share your account, scrape the service, use automated tools against it beyond the browser extension we provide, or resell, republish or bulk-copy the data or deal lists. You may share individual deals with your own clients, colleagues or advisers using the share feature. We may suspend accounts that breach these terms or that we reasonably believe are being used to abuse promotional credit.
        </p>

        <h2 id="contact">5. Contact</h2>
        <p>
          Stayful Ltd, <a href="mailto:hello@stayful.co.uk">hello@stayful.co.uk</a>. See also our <Link href="/pricing">pricing</Link> and our <Link href="/privacy">privacy policy</Link>.
        </p>
      </div>
    </section>
  );
}
