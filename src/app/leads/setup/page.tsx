import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { logConversion } from "@/lib/meta/conversions";
import { recordActivity } from "@/lib/activity/log";
import { isManagementAccount, stampManagement } from "@/lib/management/stamp-server";
import { setupResume } from "@/lib/management/setup";
import { money, priceForLead } from "@/lib/funnels/tiers";
import { packGrants } from "@/lib/starter-pack/rules";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { leadsFromPack } from "@/lib/funnels/tiers";
import { setupContext } from "./context";
import { SetupFrame } from "./SetupFrame";
import { PackStep } from "./PackStep";

export const metadata: Metadata = {
  title: "Set up your lead form — Stayful Intelligence",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * Batch 22f: the guided setup's step 0 (the starter pack), and where it
 * carries on from: anyone arriving is sent on to the first step not yet done.
 */
export default async function SetupStart({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const query = await searchParams;
  const ctx = await setupContext();

  // The way in (/for-management-companies/start) stamps before the Leads shell runs; this catches
  // anyone who opened the setup's address directly (they reach it only once past the quiz's gate).
  if (!(await isManagementAccount(ctx.userId))) await stampManagement(ctx.userId, "start");
  // The pack is paid (one click, or back from Checkout): said once to Meta, and step 0 is done.
  if (ctx.pack.offer.eligible === false && ctx.pack.offer.reason === "bought") {
    await logConversion({ name: "mc_pack_paid", userId: ctx.userId });
    await recordActivity(ctx.userId, "funnel_setup_step", { dedupeKey: "funnel_setup_step:0", extras: { step: 0, pack: "bought" } });
  }
  // Back from Stripe (?pack=1), or any other address: carry on from the first step not done, on a clean address.
  const showPack = ctx.facts.packOffered && (!ctx.facts.hasFunnel || query.back === "1");
  if (!showPack || query.pack === "1") redirect(setupResume({ ...ctx.facts, packOffered: showPack && query.pack !== "1" }));

  const settings = await getBillingSettings();
  const standard = priceForLead(1, false, ctx.tiers);
  const leads = leadsFromPack(packGrants(settings.lifecycle), settings.spendRates, standard);
  const copy = {
    ...ctx.pack.copy,
    headline: `Start with ${ctx.pack.copy.credit} of credit for ${ctx.pack.copy.price}`,
    body: `${ctx.pack.copy.price} gets you ${ctx.pack.copy.credit} of credit: about ${leads} standard leads at ${money(standard)} each. It never expires, and leads get cheaper as your month goes on.`,
  };

  return (
    <SetupFrame step={0} back={null} title="Your branded lead form, live in a few minutes" intro={<p>Three short steps: your company, your details, and where your leads go. First, some credit to pay for the reports your landlords will get.</p>}>
      <PackStep copy={copy} />
    </SetupFrame>
  );
}
