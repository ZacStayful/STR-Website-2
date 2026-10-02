import type { Metadata } from "next";
import { setupBack } from "@/lib/management/setup";
import { setupContext } from "../context";
import { SetupFrame } from "../SetupFrame";
import { CompanyStep } from "./CompanyStep";

export const metadata: Metadata = { title: "Your company — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SetupCompany() {
  const ctx = await setupContext();
  const f = ctx.funnel;
  return (
    <SetupFrame step={1} back={setupBack(1, ctx.facts.packOffered)} title="Your company" intro={<p>Your landlords see your name, logo and colour on the form and on their report. Nothing says Stayful.</p>}>
      <CompanyStep
        funnel={f ? { id: f.id, name: f.name, brand: f.brand } : null}
      />
    </SetupFrame>
  );
}
