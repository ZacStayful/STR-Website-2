import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { activationBlockers } from "@/lib/funnels/brand";
import { buttonSnippet, embedSnippet } from "@/lib/funnels/snippets";
import { bothRates, priceForLead } from "@/lib/funnels/tiers";
import { siteUrl } from "@/lib/url";
import { setupBack } from "@/lib/management/setup";
import { setupContext } from "../context";
import { SetupFrame } from "../SetupFrame";
import { LiveStep } from "./LiveStep";

export const metadata: Metadata = { title: "Your link — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SetupLive() {
  const ctx = await setupContext();
  if (!ctx.funnel) redirect("/leads/setup/company");
  const f = ctx.funnel;
  const url = siteUrl(`/f/${f.publicToken}`);
  const blockers = activationBlockers(f.brand);
  return (
    <SetupFrame
      step="live"
      back={setupBack("live", ctx.facts.packOffered)}
      title={f.active ? "Your link is ready" : "Ready to go live"}
      intro={<p>Each landlord who fills it in gets a branded report and lands in Leads. First lead each month: {bothRates(priceForLead(1, f.reportDepth === "enhanced", ctx.tiers), ctx.topupRate)}, and cheaper as the month goes on.</p>}
    >
      <LiveStep
        funnelId={f.id}
        active={f.active}
        blockers={blockers}
        url={url}
        previewUrl={`${url}?preview=report`}
        button={buttonSnippet(url, f.brand.primary)}
        embed={embedSnippet(url, f.brand.companyName)}
      />
      <p className="mt-8 text-xs text-muted-foreground">
        Change anything later in <Link href={`/leads/funnels/${f.id}`} className="underline underline-offset-2">your form&apos;s settings</Link>: rules for which leads qualify, the report depth, daily limits.
      </p>
    </SetupFrame>
  );
}
