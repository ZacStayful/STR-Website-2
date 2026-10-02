import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { setupBack } from "@/lib/management/setup";
import { listConnections, connectionBlockers } from "@/lib/crm/connections";
import { MondayPanel } from "../../integrations/MondayPanel";
import { WebhookPanel } from "../../integrations/WebhookPanel";
import { setupContext } from "../context";
import { SetupFrame } from "../SetupFrame";
import { DeliveryStep } from "./DeliveryStep";

export const metadata: Metadata = { title: "Where leads go — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SetupDelivery() {
  const ctx = await setupContext();
  if (!ctx.funnel) redirect("/leads/setup/company");
  const connections = await listConnections(ctx.userId);
  const monday = connections.find((c) => c.provider === "monday") ?? null;
  const webhook = connections.find((c) => c.provider === "webhook") ?? null;
  const withBlockers = <T extends typeof monday>(c: T) => (c === null ? null : { ...c, blockers: connectionBlockers(c) });
  return (
    <SetupFrame step={3} back={setupBack(3, ctx.facts.packOffered)} title="Where leads go" intro={<p>Every lead is in Leads here. You can also have each one emailed to you, or sent to Monday or your CRM.</p>}>
      <DeliveryStep funnelId={ctx.funnel.id} notifyNewLead={ctx.notifyNewLead} email={ctx.email}>
        <details className="rounded-xl border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Also send leads to Monday or another CRM (optional)</summary>
          <div className="mt-4 space-y-5">
            <MondayPanel connection={withBlockers(monday)} />
            <WebhookPanel connection={withBlockers(webhook)} />
          </div>
        </details>
      </DeliveryStep>
    </SetupFrame>
  );
}
