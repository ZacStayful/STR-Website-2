import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listConnections, connectionBlockers } from "@/lib/crm/connections";
import { MondayPanel } from "./MondayPanel";
import { WebhookPanel } from "./WebhookPanel";

export const metadata: Metadata = {
  title: "Integrations — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * Where a customer's leads are delivered.
 *
 * The page reads a sanitised shape — whether a credential is stored, never
 * the credential — because `crm_connections` holds API tokens and signing
 * secrets, and nothing that reaches a browser can be treated as private.
 */
export default async function IntegrationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const connections = await listConnections(user.id);
  const monday = connections.find((c) => c.provider === "monday") ?? null;
  const webhook = connections.find((c) => c.provider === "webhook") ?? null;

  const withBlockers = <T extends typeof monday>(c: T) =>
    c === null ? null : { ...c, blockers: connectionBlockers(c) };

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 pb-10 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Integrations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Where your leads go once a report has run. Connect one and every qualified lead is delivered
            automatically — the ones that miss your rules follow the policy you set on each{" "}
            <Link href="/leads/funnels" className="underline underline-offset-2">funnel</Link>.
          </p>
        </div>

        <div className="space-y-5">
          <MondayPanel connection={withBlockers(monday)} />
          <WebhookPanel connection={withBlockers(webhook)} />
        </div>

        <div className="mt-8 rounded-xl border border-dashed border-border p-5">
          <h2 className="text-sm font-semibold text-foreground">Not here yet</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            HubSpot, Pipedrive and GoHighLevel are coming. Until then the webhook reaches all of them through
            n8n, Zapier or Make in a few minutes —{" "}
            <Link href="/leads/integrations/guide" className="underline underline-offset-2">here is how</Link>.
          </p>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Deliveries retry on their own if your CRM is briefly unreachable, and a lead is never lost while that
          happens — it stays in <Link href="/leads" className="underline underline-offset-2">Leads</Link> either way.
        </p>
      </div>
    </main>
  );
}
