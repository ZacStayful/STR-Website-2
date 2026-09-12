import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { safeInternalPath } from "@/lib/safe-path";
import { getCreditSummary } from "@/lib/credit/summary";
import { formatGbp } from "@/lib/credit/pricing";
import { ACCESS_COLUMNS, accountStatus, planName } from "@/lib/access";
import { formatPlanDate } from "@/lib/subscription";
import { resumeFromUpgradeAction } from "@/app/account/actions";
import { Pricing } from "@/components/marketing-v3/Pricing";
import { TopupCard } from "@/components/credit/TopupCard";

export const metadata: Metadata = {
  title: "Choose a plan — Stayful Intelligence",
  description: "Subscribe for monthly credit at the best rate, or top up as you go.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The plan chooser for signed-in members: current balance, the four tiers
 * (Stripe Checkout / portal), and a one-click top-up as the secondary option.
 */
export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect: redirectParam } = await searchParams;
  const wanted = safeInternalPath(redirectParam, "/estimate");
  const back = /^\/(upgrade|login|signup)(\/|\?|$)/.test(wanted) ? "/estimate" : wanted;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/upgrade?redirect=${back}`)}`);
  }

  const { data: profile } = await supabase.from("profiles").select(`${ACCESS_COLUMNS}, full_name, cancel_at_period_end, current_period_end, subscription_paused_until`).eq("id", user.id).single();
  // A paused member already has a subscription: choosing a plan below opens the
  // portal rather than a second Checkout, but the quickest way back is to
  // restart the one they have.
  const paused = profile ? accountStatus(profile) === "paused" : false;
  const pausedUntil = paused ? formatPlanDate((profile as { subscription_paused_until?: string | null } | null)?.subscription_paused_until ?? null) : null;
  const admin = isAdminEmail(user.email);
  const summary = await getCreditSummary(user.id).catch(() => null);
  const firstName = profile?.full_name?.toString().trim().split(/\s+/)[0] ?? null;
  const out = summary?.outOfCredit ?? false;

  return (
    <>
      <section className="upgrade section">
        <div className="wrap-narrow">
          <div className="eyebrow">{profile?.plan_code ? "Your plan" : "Choose a plan"}</div>
          <h1 className="upgrade-title">
            {profile
              ? out
                ? `${firstName ? `${firstName}, you're` : "You're"} out of credit.`
                : profile.plan_code
                  ? `${firstName ? `${firstName}, you're` : "You're"} on ${planName(profile.plan_code)}.`
                  : `${firstName ? `${firstName}, pick` : "Pick"} a plan or top up.`
              : "Your account isn't set up yet."}
          </h1>
          <p className="lede">
            {!profile
              ? "We couldn't find your profile. Sign out and back in, or email hello@stayful.co.uk and we'll fix it."
              : admin
                ? "Admin accounts run everything free; this page is what members see."
                : summary
                  ? `You have ${formatGbp(summary.totalPence)} of credit${summary.cycle?.planName ? ` (${formatGbp(summary.buckets.planPence)} of this month's ${summary.cycle.planName} credit left)` : ""}. Subscribing gives you monthly credit at the standard rate; top-up credit never expires but is spent at ${summary.rates.topup}× the plan rate.`
                  : "Subscribing gives you monthly credit at the standard rate; top-up credit never expires but is spent at 1.5× the plan rate."}
          </p>
          {paused && (
            <div className="upgrade-ctas" style={{ marginTop: 16 }}>
              <form action={resumeFromUpgradeAction}>
                <button className="btn btn-primary" type="submit">
                  Restart my plan now
                </button>
              </form>
              <p className="upgrade-foot" style={{ marginTop: 8 }}>
                Your plan is paused{pausedUntil ? ` until ${pausedUntil}` : ""}: no plan credit arrives and you are not charged, but any credit you have still works. <Link href="/account">Manage your plan</Link>.
              </p>
            </div>
          )}
          {profile?.plan_code && !paused && (
            <p className="upgrade-foot">
              {profile.cancel_at_period_end ? `Your subscription ends on ${profile.current_period_end ? new Date(profile.current_period_end).toLocaleDateString("en-GB") : "the period end"}.` : "Choosing another plan opens the billing portal where the change is prorated."}{" "}
              <Link href="/account/billing">Manage billing</Link>
            </p>
          )}
        </div>
      </section>

      <Pricing signedIn currentPlanCode={profile?.plan_code ?? null} compact />

      {profile && !admin && summary && (
        <section className="section">
          <div className="wrap-narrow">
            <TopupCard presets={summary.topupPresetsPence} hasSavedCard={summary.hasSavedCard} topupRate={summary.rates.topup} heading="Or top up now" />
            <p className="upgrade-foot" style={{ marginTop: 16 }}>
              <Link href={back}>← Back</Link>
            </p>
          </div>
        </section>
      )}
    </>
  );
}
