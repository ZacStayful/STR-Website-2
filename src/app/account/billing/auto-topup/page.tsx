import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { teamOf } from "@/lib/team";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { formatPence } from "@/lib/credit/deal-pricing";
import { AutoTopupOneTap } from "./AutoTopupOneTap";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Auto top-up — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * Batch 23, Part C: where Stayful Intelligence's auto top-up link lands
 * (/si/topup → here). One tap: "Turn on auto top-up: £25 when you drop below
 * £5" (reveal_auto_topup_amount_pence / _threshold_pence, a topup_presets_pence
 * preset). With a saved card it switches on through /api/billing/auto-topup;
 * without one, a £25 top-up Checkout saves the card and switches it on in the
 * same flow (the Stripe webhook). The change is recorded as
 * auto_topup_settings.
 */
export default async function AutoTopupPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/billing/auto-topup");
  if ((await teamOf(user.id)).role === "member") redirect("/account/team");
  const [{ data: profile }, settings] = await Promise.all([
    supabase.from("profiles").select("stripe_default_payment_method_id, auto_topup_amount_pence, auto_topup_threshold_pence").eq("id", user.id).single(),
    getBillingSettings(),
  ]);
  const amount = settings.intelligence.revealAutoTopupAmountPence;
  const threshold = settings.intelligence.revealAutoTopupThresholdPence;
  const on = profile?.auto_topup_amount_pence != null;
  const presetOk = settings.topupPresetsPence.includes(amount);

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <p className="text-sm text-[#6b7280]">
        <Link href="/account/billing" className="hover:underline">
          Billing &amp; usage
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-[#1f2a1d]">Auto top-up</h1>
      <div className="mt-6 rounded-2xl border border-[#e4e7dc] bg-white p-5">
        {on ? (
          <p role="status" className="text-[15px] text-[#1f2a1d]">
            Auto top-up is on: {formatPence(Number(profile?.auto_topup_amount_pence))} whenever you drop below {formatPence(Number(profile?.auto_topup_threshold_pence ?? threshold))}. You can change it or switch it off in{" "}
            <Link href="/account/billing#topup" className="font-medium text-[#2E3D2B] underline">
              Billing
            </Link>
            .
          </p>
        ) : params.done === "1" ? (
          <p role="status" className="text-[15px] text-[#1f2a1d]">
            Thanks — your top-up has gone through. Auto top-up switches on as soon as the payment is confirmed; refresh this page in a moment to check.
          </p>
        ) : !presetOk ? (
          <p className="text-[15px] text-[#1f2a1d]">
            Auto top-up can be set up in{" "}
            <Link href="/account/billing#topup" className="font-medium text-[#2E3D2B] underline">
              Billing
            </Link>
            .
          </p>
        ) : (
          <AutoTopupOneTap amountPence={amount} thresholdPence={threshold} savedCard={Boolean(profile?.stripe_default_payment_method_id)} />
        )}
      </div>
    </main>
  );
}
