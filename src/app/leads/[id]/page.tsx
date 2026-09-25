import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import EstimatePage from "@/app/estimate/page";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { leadScopeOrPaused } from "@/lib/leads/scope";
import { parseStage } from "@/lib/leads/stage";
import { archiveDueAt, retentionDate } from "@/lib/leads/retention";
import { parseBrand, brandCssVars } from "@/lib/funnels/brand";
import type { FunnelMode } from "@/lib/funnels/mode";
import type { AnalysisResult } from "@/lib/types";
import type { LeadVerdict } from "@/lib/leads/rules";
import { siteUrl } from "@/lib/url";
import { PushLeadButton } from "../PushLeadButton";
import { LeadDetailActions, MarkLeadOpened } from "./LeadDetailActions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lead — Stayful Intelligence",
  robots: { index: false, follow: false },
};

interface FunnelJoin {
  name: string | null;
  public_token: string;
  brand: unknown;
  report_depth: string;
}

interface LeadRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  postcode: string | null;
  bedrooms: number | null;
  result: AnalysisResult | null;
  qualified: boolean | null;
  qualification: LeadVerdict | null;
  status: string;
  stage: string | null;
  report_token: string | null;
  created_at: string;
  last_activity_at: string | null;
  archived_at: string | null;
  purge_after: string | null;
  funnel_id: string | null;
  funnels: FunnelJoin | FunnelJoin[] | null;
}

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
});

/**
 * One lead: who enquired, when, and the full report they were sent.
 *
 * The report is drawn from the analysis stored when the prospect completed
 * the funnel. Nothing is re-run and no credit is spent — this is the same
 * page the prospect has at /r/<token>, under the funnel's branding, so the
 * customer sees exactly what their prospect saw.
 *
 * Read through the service role scoped by `leadScope`, not through RLS, so
 * that team access can widen who the owner is without a new policy.
 */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !hasServiceRole()) notFound();
  const scope = await leadScopeOrPaused(user);
  if (scope === "paused") notFound();

  const { data } = await createAdminClient()
    .from("leads")
    .select(
      "id, name, email, phone, address, postcode, bedrooms, result, qualified, qualification, status, stage, report_token, created_at, " +
        "last_activity_at, archived_at, purge_after, funnel_id, funnels ( name, public_token, brand, report_depth )",
    )
    .eq("user_id", scope.ownerId)
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const lead = data as unknown as LeadRow;
  // A to-one embed comes back as an object at runtime but is typed as an
  // array; accept both. Null when the funnel has since been deleted.
  const funnel = Array.isArray(lead.funnels) ? lead.funnels[0] ?? null : lead.funnels;
  const brand = parseBrand(funnel?.brand);
  const hasReport = Boolean(lead.result?.property && lead.result?.financials);
  const reportUrl = lead.report_token ? `${siteUrl().replace(/\/$/, "")}/r/${lead.report_token}` : null;

  const mode: FunnelMode = {
    token: funnel?.public_token ?? "",
    brand,
    reportDepth: funnel?.report_depth === "enhanced" ? "enhanced" : "standard",
    preview: false,
    // The report's own Download PDF goes through the lead, not the funnel:
    // it keeps working after the funnel is paused or deleted.
    reportToken: lead.report_token ?? undefined,
  };

  const checks = lead.qualification?.checks ?? [];

  return (
    <main className="min-h-screen bg-background">
      <MarkLeadOpened leadId={lead.id} />
      <div className="mx-auto max-w-4xl px-4 pb-6 sm:px-6">
        <Link href="/leads" className="text-xs text-muted-foreground hover:text-foreground">← All leads</Link>

        {lead.archived_at ? (
          <div className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
            This lead is archived.{" "}
            {lead.purge_after
              ? <>It will be deleted permanently on {retentionDate(lead.purge_after)} unless you restore it.</>
              : <>We&apos;ll email you the date it will be deleted. Restore it to keep it.</>}
          </div>
        ) : null}

        <section className="mt-3 rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground">{lead.name || lead.email || "Unnamed enquiry"}</h1>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {lead.email ? (<><dt className="text-muted-foreground">Email</dt><dd><a href={`mailto:${lead.email}`} className="underline underline-offset-2">{lead.email}</a></dd></>) : null}
                {lead.phone ? (<><dt className="text-muted-foreground">Phone</dt><dd><a href={`tel:${lead.phone}`} className="underline underline-offset-2">{lead.phone}</a></dd></>) : null}
                <dt className="text-muted-foreground">Property</dt>
                <dd>{[lead.address, lead.postcode].filter(Boolean).join(", ") || "No address recorded"}{lead.bedrooms !== null ? ` · ${lead.bedrooms} bed` : ""}</dd>
                <dt className="text-muted-foreground">Enquired</dt>
                <dd>{WHEN.format(new Date(lead.created_at))}</dd>
                <dt className="text-muted-foreground">Funnel</dt>
                <dd>{funnel?.name ?? (lead.funnel_id ? "—" : "Funnel deleted")}</dd>
              </dl>
            </div>
            <LeadDetailActions
              key={lead.archived_at ? "archived" : "live"}
              leadId={lead.id}
              stage={parseStage(lead.stage) ?? "new"}
              archived={Boolean(lead.archived_at)}
              hasReport={hasReport}
              reportUrl={hasReport ? reportUrl : null}
            />
          </div>

          {lead.qualified === false || checks.length > 0 ? (
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-sm font-medium text-foreground">
                {lead.qualified === false ? "Did not meet your rules" : lead.qualified ? "Met your rules" : "Not assessed yet"}
                {lead.qualification?.summary ? <span className="font-normal text-muted-foreground"> — {lead.qualification.summary}</span> : null}
              </p>
              {checks.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {checks.map((c, i) => (
                    <li key={i}>
                      <span className={c.status === "fail" ? "text-destructive" : c.status === "unknown" ? "text-warning" : "text-success"}>
                        {c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "?"}
                      </span>{" "}
                      {c.label}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
            <span>
              {lead.archived_at
                ? null
                : lead.last_activity_at
                  ? <>Archived automatically on {retentionDate(archiveDueAt(lead.last_activity_at))} if it isn&apos;t used again. Opening it now resets that.</>
                  : null}
            </span>
            {hasReport && lead.status !== "queued" && !lead.archived_at ? (
              <PushLeadButton leadId={lead.id} pushed={lead.status === "pushed"} />
            ) : null}
          </div>
        </section>
      </div>

      {hasReport ? (
        <div style={brandCssVars(brand) as React.CSSProperties}>
          <EstimatePage funnel={mode} initialResult={lead.result!} />
        </div>
      ) : (
        <div className="mx-auto max-w-4xl px-4 pb-10 sm:px-6">
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm font-medium text-foreground">Report not run yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This enquiry arrived while your balance was too low to run the report. It runs automatically once your
              balance covers it.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
