import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { teamOf } from "@/lib/team";
import { getCreditSummary } from "@/lib/credit/summary";
import { formatGbp } from "@/lib/credit/pricing";
import { decisionOffer } from "@/lib/credit/low-credit-server";
import { cardSummary, loadBillingProfile } from "@/lib/stripe/customer";
import { starterPackStateFor } from "@/lib/starter-pack/server";
import { StarterPackOffer } from "@/components/starter-pack/StarterPackOffer";
import { ChooseClient } from "./ChooseClient";

export const metadata: Metadata = {
  title: "Keep going — Stayful Intelligence",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Batch 20, Part B: where the low-credit email's two buttons land. Nothing
 * is charged by opening it (mail scanners open links): Starter or the £10
 * top-up is charged only by the button here, which says what it costs and
 * the card it goes on. A member who can still buy the starter pack is
 * offered that instead; one already on a plan is told so.
 */
export default async function ChoosePage({ searchParams }: { searchParams: Promise<{ pick?: string | string[] }> }) {
  const params = await searchParams;
  const pick = (Array.isArray(params.pick) ? params.pick[0] : params.pick) === "topup" ? "topup" : "starter";
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`/account/billing/choose?pick=${pick}`)}`);
  // A team member's plan and billing are the owner's to manage.
  if ((await teamOf(user.id)).role === "member") redirect("/account/team");

  const [summary, pack, offer, profile] = await Promise.all([getCreditSummary(user.id), starterPackStateFor(user.id), decisionOffer(), loadBillingProfile(user.id)]);
  const card = await cardSummary(profile?.stripe_default_payment_method_id ?? null);
  const back = (
    <p className="text-sm">
      <Link href="/account/billing" className="text-primary hover:underline">
        ← Billing &amp; usage
      </Link>
    </p>
  );

  return (
    <div className="mx-auto max-w-xl px-5 py-8">
      {back}
      <h1 className="mt-2 text-2xl font-semibold text-foreground">Keep your daily deals coming</h1>
      <p className="mt-1 text-sm text-muted-foreground">You have {formatGbp(Math.max(0, summary.totalPence))} of credit left. When it runs out, your daily deals and reports pause.</p>
      <div className="mt-6">
        {!summary.noPlan ? (
          <section className="rounded-xl border border-border bg-card p-5 text-sm">
            <p className="font-medium text-foreground">You&rsquo;re on a plan, so there&rsquo;s nothing to choose here.</p>
            <p className="mt-1 text-muted-foreground">Your plan credit renews each month. You can still top up from Billing.</p>
            <Link href="/account/billing" className="mt-3 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">
              Go to Billing
            </Link>
          </section>
        ) : pack.offer.eligible ? (
          <section className="rounded-xl border border-primary/30 bg-primary/5 p-5">
            <StarterPackOffer copy={pack.copy} returnTo="/account/billing/choose" variant="card" />
          </section>
        ) : (
          <ChooseClient pick={pick} starter={offer.starter} topupPence={offer.topupPence} card={card ? { brand: card.brand, last4: card.last4 } : null} />
        )}
      </div>
    </div>
  );
}
