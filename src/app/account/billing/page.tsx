import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { getCreditSummary } from "@/lib/credit/summary";
import { usageHistory } from "@/lib/credit/history";
import { getPlan } from "@/lib/credit/plans";
import { cardSummary } from "@/lib/stripe/customer";
import { stripeConfigured } from "@/lib/stripe/client";
import { WELCOME_WITHHELD_COPY } from "@/lib/credit/welcome";
import { BillingClient } from "./BillingClient";

export const metadata: Metadata = {
  title: "Billing & usage — Stayful Intelligence",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ topup?: string; subscribed?: string }> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/billing");

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan_code, stripe_subscription_status, stripe_default_payment_method_id, current_period_end, cancel_at_period_end, auto_topup_amount_pence, auto_topup_threshold_pence, referral_code, welcome_withheld_reason")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/upgrade");

  const admin = isAdminEmail(user.email);
  const [summary, history, plan, card] = await Promise.all([
    getCreditSummary(user.id),
    usageHistory(user.id, { limit: 40 }).catch(() => ({ items: [], nextCursor: null })),
    getPlan(profile.plan_code),
    cardSummary(profile.stripe_default_payment_method_id ?? null),
  ]);

  return (
    <BillingClient
      admin={admin}
      email={user.email ?? null}
      summary={summary}
      plan={plan ? { code: plan.code, name: plan.name, pricePence: plan.pricePence, interval: plan.interval, monthlyCreditPence: plan.monthlyCreditPence } : null}
      subscription={{ status: profile.stripe_subscription_status ?? null, periodEnd: profile.current_period_end ?? null, cancelAtPeriodEnd: Boolean(profile.cancel_at_period_end) }}
      card={card}
      stripeReady={stripeConfigured()}
      initialHistory={history}
      welcomeWithheld={profile.welcome_withheld_reason ? (WELCOME_WITHHELD_COPY[profile.welcome_withheld_reason] ?? null) : null}
      justToppedUp={params.topup === "1"}
      justSubscribed={params.subscribed === "1"}
    />
  );
}
