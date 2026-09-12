import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/url";

export const metadata: Metadata = {
  title: "Terms of service — Stayful Intelligence",
  description: "The terms that apply to Stayful Intelligence accounts, subscriptions and credit.",
  alternates: { canonical: siteUrl("/terms") },
};

const LAST_UPDATED = "12 September 2026";

export default function TermsPage() {
  return (
    <section className="section">
      <div className="wrap-narrow">
        <div className="eyebrow">Legal</div>
        <h1 className="upgrade-title">Terms of service</h1>
        <p className="lede">Last updated {LAST_UPDATED}. These terms apply to every Stayful Intelligence account. By creating an account, subscribing or buying credit you agree to them.</p>

        <h2 id="service">1. The service</h2>
        <p>Stayful Intelligence provides property income estimates, market data and related tools for UK short-term lets. Estimates are modelled from third-party data and are not a guarantee of income. Nothing on the service is financial, legal or investment advice.</p>

        <h2 id="credit">2. Credit</h2>
        <ul>
          <li><strong>How credit works.</strong> Paid features (property reports, listing checks, AI narration, address and market lookups) use credit. Each action shows an estimate before it runs and the exact amount used afterwards on your billing page.</li>
          <li><strong>Welcome credit</strong> is a one-off promotional grant for new accounts. It is not transferable, has no cash value and may be withheld or reversed where an account is created to abuse the offer (for example with temporary email addresses or a mobile number already used on another account).</li>
          <li><strong>Plan credit</strong> is added at the start of each billing period of a subscription and expires, unused, at the end of that period. It does not roll over.</li>
          <li><strong>Top-up credit</strong> is bought as a one-off payment, never expires while your account is open, and is spent at a higher rate than plan credit (currently 1.5× — shown on every top-up screen).</li>
          <li><strong>Promo and referral credit</strong> is spent at the top-up rate and may carry an expiry date shown when it is granted.</li>
          <li><strong>Refunds.</strong> Credit that has been spent is non-refundable. Unspent top-up credit bought as a consumer can be refunded within 14 days of purchase under the Consumer Contracts Regulations; contact <a href="mailto:hello@stayful.co.uk">hello@stayful.co.uk</a>. If a top-up payment is refunded or disputed, the corresponding credit is removed from your account.</li>
          <li><strong>Prices.</strong> The cost of each action is derived from our data providers&apos; prices and may change; the current prices are always shown before you run an action. All prices are ex VAT unless stated.</li>
        </ul>

        <h2 id="subscriptions">3. Subscriptions</h2>
        <p>Subscriptions renew automatically each month or year until cancelled. You can cancel any time from your billing page; access and plan credit continue until the end of the period already paid for. Upgrades take effect immediately and are prorated; downgrades take effect at the next renewal.</p>

        <h2 id="acceptable-use">4. Acceptable use</h2>
        <p>One account per person. Don&apos;t share accounts, scrape or resell the data, or use automated tools against the service beyond the browser extension we provide. We may suspend accounts that breach these terms or that we reasonably believe are being used to abuse promotional credit.</p>

        <h2 id="contact">5. Contact</h2>
        <p>Stayful Ltd, <a href="mailto:hello@stayful.co.uk">hello@stayful.co.uk</a>. See also our <Link href="/pricing">pricing</Link>.</p>
      </div>
    </section>
  );
}
