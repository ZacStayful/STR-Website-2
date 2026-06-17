import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAccess, trialDaysRemaining } from "@/lib/access";
import { Icon } from "@/lib/icons";

export const metadata: Metadata = {
  title: "Upgrade — Stayful Intelligence",
  description:
    "Your 14-day free trial of the Stayful Property Analyser has ended. Subscribe to continue running unlimited reports.",
  robots: { index: false, follow: false },
};

const CALENDLY_URL = "https://calendly.com/zac-stayful/call";

export default async function UpgradePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already gates /upgrade to logged-in users. Defensive guard.
  if (!user) {
    redirect("/login?redirect=/upgrade");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, trial_ends_at, full_name")
    .eq("id", user.id)
    .single();

  // If the trial is still active or they're already pro, send them straight
  // back to the analyser — they shouldn't be on the upgrade page.
  if (profile && hasAccess(profile)) {
    redirect("/estimate");
  }

  const firstName =
    profile?.full_name?.toString().trim().split(/\s+/)[0] ?? null;
  const daysLeft = profile ? trialDaysRemaining(profile) : 0;

  return (
    <section className="upgrade section">
      <div className="wrap-narrow">
        <div className="eyebrow">Subscription required</div>
        <h1 className="upgrade-title">
          {firstName ? `${firstName}, your` : "Your"} 14-day trial has ended.
        </h1>
        <p className="lede">
          {daysLeft === 0
            ? "You've used your full free-trial window."
            : `You have ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left on your trial.`}{" "}
          To keep running reports, you&apos;ll need a paid subscription. We&apos;re finalising
          self-serve billing now — until that ships, book a 15-minute call and we&apos;ll set
          you up the same day.
        </p>

        <div className="upgrade-pricing">
          <article className="upgrade-tier">
            <div className="upgrade-tier-head">Monthly</div>
            <div className="upgrade-tier-price">£39.99<span>/mo</span></div>
            <div className="upgrade-tier-meta">Unlimited analyses · cancel any time</div>
          </article>
          <article className="upgrade-tier upgrade-tier-featured">
            <div className="upgrade-tier-tag">Save 25%</div>
            <div className="upgrade-tier-head">Annual</div>
            <div className="upgrade-tier-price">£360<span>/yr</span></div>
            <div className="upgrade-tier-meta">12 months unlimited · paid annually</div>
          </article>
        </div>

        <div className="upgrade-ctas">
          <a
            className="btn btn-primary"
            href={CALENDLY_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Book a 15-min call to subscribe <Icon name="arrow" size={14} />
          </a>
          <a className="btn btn-ghost" href="mailto:zac@stayful.co.uk">
            Or email us
          </a>
        </div>

        <p className="upgrade-foot">
          Self-serve Stripe checkout is coming soon. In the meantime, every
          subscription is set up by hand the same day you book.{" "}
          <Link href="/pricing">See full pricing</Link>.
        </p>
      </div>
    </section>
  );
}
