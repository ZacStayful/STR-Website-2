import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/url";
import { GOALS_EDITOR_HREF } from "@/lib/nav";
import { TRACKING } from "@/lib/tracking/config";

export const metadata: Metadata = {
  title: "Privacy policy — Stayful Intelligence",
  description: "What Stayful Intelligence collects about you, why, and what you can do about it.",
  alternates: { canonical: siteUrl("/privacy") },
};

const LAST_UPDATED = "29 September 2026";

/** How long a cookie choice is remembered, in months, as the config sets it. */
const CONSENT_MONTHS = Math.round(TRACKING.consentDays / 30.4);

/**
 * The privacy policy, from the legal drafts of 27 September 2026 (section A),
 * as decided for Batch 10: Twilio named for text messages and the referral
 * cookie stated. "Information about other people" was added with saved
 * profiles (Batch 13), drafted for this page since the held-back drafts were
 * not in the repository; the profiles page links to it (#other-people).
 * "Bug reports and ideas" was added with feedback (Batch 18); the 90 days is
 * the default of feedback_screenshot_retention_days (src/lib/feedback).
 * Cookies and Meta were added with ads measurement (Batch 19), as approved for
 * it; the months and days are read from src/lib/tracking/config.ts, so the
 * page always says what the site does.
 */
export default function PrivacyPage() {
  return (
    <section className="section">
      <div className="wrap-narrow">
        <div className="eyebrow">Legal</div>
        <h1 className="upgrade-title">Privacy policy</h1>
        <p className="lede">Last updated {LAST_UPDATED}. This explains what Stayful Intelligence collects about you, why, and what you can do about it.</p>

        <h2 id="who">Who we are</h2>
        <p>
          Stayful Intelligence is run by Stayful Ltd, a company registered in England and Wales (company number 14791583), registered office 20-22 Wenlock Road, London, England, N1 7GU. We are registered with the Information Commissioner&apos;s Office (registration number ZA00016946040). We are the data controller for your information. Contact: <a href="mailto:hello@stayful.co.uk">hello@stayful.co.uk</a>.
        </p>

        <h2 id="collect">What we collect</h2>
        <ul>
          <li><strong>Account details:</strong> your name, email address and mobile number.</li>
          <li><strong>Your profile:</strong> the answers you give about yourself and what you&apos;re looking for. This includes your experience, the properties you own or run, where you want to invest, your budget, cash available, how you plan to fund a purchase, your deposit and mortgage rate, your minimum profit and how much risk you&apos;re comfortable with.</li>
          <li><strong>How you use the service:</strong> pages and deals you view, deals you keep or pass, reports you run, visits and time spent, and which emails or messages you open or click.</li>
          <li><strong>Payments:</strong> your plan, credit balance and transaction history. Card details are handled by Stripe; we never see or store your full card number.</li>
          <li><strong>Feedback</strong> you give on deals, including reasons.</li>
          <li><strong>Bug reports and ideas:</strong> when you send feedback we keep your message, any screenshots (deleted after 90 days), the page you were on, your browser, device and screen size, and the app version.</li>
          <li><strong>Technical data:</strong> IP address, browser and device type, used for security and to keep you signed in.</li>
        </ul>

        <h2 id="why">Why we use it</h2>
        <ul>
          <li>To run your account and provide the service you&apos;ve signed up for, including choosing deals for you, working out the numbers at your own deposit and mortgage rate, and sending the daily email and alerts you&apos;ve switched on. (Legal basis: contract.)</li>
          <li>To improve which deals we show you and to improve the service overall, including measuring how often members use it. (Legal basis: legitimate interests.)</li>
          <li>To take payment, keep financial records and prevent fraud and abuse of free credit. (Legal basis: contract, legal obligation and legitimate interests.)</li>
          <li>To send occasional updates about Stayful Intelligence. You can turn these off at any time from Account → Notifications or the unsubscribe link. (Legal basis: legitimate interests / consent where required.)</li>
        </ul>

        <h2 id="profile">How your profile is used</h2>
        <p>
          Your answers are used to filter and rank the deals we show you and to calculate figures such as profit at your own finance terms. This is automated, but it only decides which deals appear and in what order. It never decides whether you can use the service, what you pay, or anything with a legal or similarly significant effect on you. It is not financial advice. You can view and change every answer at any time from <Link href={GOALS_EDITOR_HREF}>your profile</Link>.
        </p>

        <h2 id="other-people">Information about other people</h2>
        <p>
          If you set up a profile for someone else, for example a client you source deals for, only add their details with their permission, and use a nickname or initials rather than their name. We use that information only to find and rank deals for that profile. You can change or delete it at any time, and it&apos;s deleted with your account.
        </p>

        <h2 id="sharing">Who we share it with</h2>
        <p>We don&apos;t sell your information. We share it only with companies that help us run the service, under contracts that protect it:</p>
        <ul>
          <li>Supabase (database hosting, EU), Vercel (website hosting)</li>
          <li>Stripe (payments)</li>
          <li>Resend (email) and Twilio (text messages)</li>
          <li>Monday.com (our customer records)</li>
          <li>Anthropic and ElevenLabs (AI written and spoken summaries, only when you use those features; property details only)</li>
          <li>Google Maps (address and map lookups)</li>
          <li>Meta Platforms Ireland Ltd (measuring our Facebook ads — only if you choose Accept on our cookie banner)</li>
        </ul>
        <p>
          Our property data providers (for example PropertyData, Airbtics and PMI) receive property addresses and details, not your personal details. Some of these companies may process data outside the UK; where they do, we rely on approved safeguards such as the UK International Data Transfer Agreement or adequacy regulations.
        </p>

        <h2 id="retention">How long we keep it</h2>
        <ul>
          <li>Account and profile details: while your account is open, and deleted within 30 days of closing it.</li>
          <li>Usage and activity records: up to 24 months.</li>
          <li>Payment and billing records: 6 years, as required for tax.</li>
        </ul>

        <h2 id="rights">Your rights</h2>
        <p>
          You can ask to see, correct, delete or export your information, object to how we use it, or ask us to restrict it. Email <a href="mailto:hello@stayful.co.uk">hello@stayful.co.uk</a> and we&apos;ll respond within one month. You can also complain to the Information Commissioner&apos;s Office at <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer">ico.org.uk</a>.
        </p>

        <h2 id="cookies">Cookies</h2>
        <p>We use essential cookies to keep you signed in, keep the service secure, remember your cookie choice (for {CONSENT_MONTHS} months) and credit referral links.</p>
        <p>
          If you choose Accept on our cookie banner, we also use Meta&apos;s pixel and share limited information with Meta Platforms Ireland Ltd so we can measure and improve our Facebook ads: the pages you visit (the page address only, never what comes after it), and when you sign up, finish your profile, run your first report, subscribe or top up, that it happened, with scrambled (hashed) copies of your email address and your account number with us, the amount for payments, and your IP address and browser type. We also remember which ad or link brought you here in a cookie for {TRACKING.attributionDays} days, so the right ad is credited if you sign up later.
        </p>
        <p>When you create an account we record which ad or link brought you (the tags on the link and the website you came from). This stays with us and is not shared.</p>
        <p>You can change your choice at any time from Cookie settings at the bottom of any page.</p>

        <h2 id="changes">Changes</h2>
        <p>We&apos;ll tell you by email before any significant change to this policy. See also our <Link href="/terms">terms of service</Link>.</p>
      </div>
    </section>
  );
}
