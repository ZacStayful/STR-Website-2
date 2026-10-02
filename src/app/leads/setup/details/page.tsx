import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { setupBack } from "@/lib/management/setup";
import { setupContext } from "../context";
import { SetupFrame } from "../SetupFrame";
import { DetailsStep } from "./DetailsStep";

export const metadata: Metadata = { title: "Your details — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SetupDetails() {
  const ctx = await setupContext();
  if (!ctx.funnel) redirect("/leads/setup/company");
  const f = ctx.funnel;
  return (
    <SetupFrame step={2} back={setupBack(2, ctx.facts.packOffered)} title="Your details" intro={<p>Where landlords&apos; replies go, and the privacy policy your form links to.</p>}>
      <DetailsStep funnel={{ id: f.id, name: f.name, brand: f.brand }} loginEmail={ctx.email} />
    </SetupFrame>
  );
}
