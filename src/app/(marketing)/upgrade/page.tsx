import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ACCESS_COLUMNS,
  FREE_RUNS,
  hasAccess,
  isLapsedSubscriber,
} from "@/lib/access";
import { isAdminEmail } from "@/lib/admin";
import { checkoutUrlFor } from "@/lib/billing";
import { Icon } from "@/lib/icons";
import { safeInternalPath } from "@/lib/safe-path";

export const metadata: Metadata = {
  title: "Upgrade — Stayful Intelligence",
  description:
    "You've used all 5 free reports on the Stayful Property Analyser. Subscribe to continue running unlimited reports.",
  robots: { index: false, follow: false },
};

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect: redirectParam } = await searchParams;
  // Where to send the user once they have access — the analyser by default,
  // or the Market Explorer when that's what they were trying to open.
  const wanted = safeInternalPath(redirectParam, "/estimate");
  const back = /^\/(upgrade|login|signup)(\/|\?|$)/.test(wanted) ? "/estimate" : wanted;
  const fromMarkets = back.startsWith("/markets");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already gates /upgrade to logged-in users. Defensive guard.
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/upgrade?redirect=${back}`)}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(`${ACCESS_COLUMNS}, full_name`)
    .eq("id", user.id)
    .single();

  // If they still have free reports left, they're already pro, or they're an
  // admin, send them straight back to the analyser — they shouldn't be on the
  // upgrade page.
  if (isAdminEmail(user.email) || (profile && hasAccess(profile))) {
    redirect(back);
  }

  const firstName =
    profile?.full_name?.toString().trim().split(/\s+/)[0] ?? null;
  const lapsed = profile ? isLapsedSubscriber(profile) : false;
  const checkoutHref = checkoutUrlFor(user.id, user.email ?? null);

  return (
    <section className="upgrade section">
      <div className="wrap-narrow">
        <div className="eyebrow">Subscription required</div>
        <h1 className="upgrade-title">
          {lapsed
            ? `${firstName ? `${firstName}, your` : "Your"} subscription has ended.`
            : `${firstName ? `${firstName}, you've` : "You've"} used all ${FREE_RUNS} free reports.`}
        </h1>
        <p className="lede">
          {lapsed
            ? `Your Stayful subscription has been cancelled, so ${fromMarkets ? "the Market Explorer and the analyser are" : "analyser access is"} paused. Re-subscribe to pick up right where you left off — unlimited reports, no free-report limit.`
            : fromMarkets
              ? `You've run your ${FREE_RUNS} free analyses, which also covers the Market Explorer. Subscribe below for unlimited reports and full Market Explorer access.`
              : `You've run your ${FREE_RUNS} free analyses. To keep running reports, you'll need a paid subscription — subscribe below for unlimited reports.`}
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
          <a className="btn btn-primary" href={checkoutHref}>
            Subscribe now <Icon name="arrow" size={14} />
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
