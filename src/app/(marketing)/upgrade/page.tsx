import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { safeInternalPath } from "@/lib/safe-path";
import { getCreditSummary } from "@/lib/credit/summary";
import { formatGbp } from "@/lib/credit/pricing";
import { planName } from "@/lib/access";
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

  const { data: profile } = await supabase.from("profiles").select("plan_code, full_name, cancel_at_period_end, current_period_end").eq("id", user.id).single();
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
          {profile?.plan_code && (
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
