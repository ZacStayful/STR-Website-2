import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { getBillingSettings, invalidateCreditCaches } from "@/lib/credit/unit-costs";
import { isoToLondonLocal } from "@/lib/lifecycle/admin-form";
import { packAdminStatus } from "@/lib/starter-pack/admin-server";
import { funnelStatus } from "@/lib/crm/monday-funnel/status-server";
import { MobilePanel, MondayPanel, SettingsForm } from "./Panels";

export const metadata: Metadata = { title: "Starter pack, inactivity and Monday — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Batch 20's admin page: the starter pack, the £5 low-credit decision and
 * the inactivity rules (every number in billing_settings), and the one-off
 * backfills with a dry run first.
 */
export default async function LifecyclePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/lifecycle");
  if (!isAdminEmail(user.email)) notFound();

  invalidateCreditCaches();
  const s = (await getBillingSettings()).lifecycle;
  const [pack, funnel] = await Promise.all([packAdminStatus(s), funnelStatus()]);
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <p className="text-sm">
        <Link href="/admin" className="text-primary hover:underline">
          ← Admin
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-foreground">Starter pack, inactivity and Monday</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Batch 20. The £10 starter pack for new members, the £5 low-credit decision for members with no plan, the inactivity rules (Re-engage and paused daily picks) and the Monday sales-funnel board.
      </p>

      <h2 className="mt-10 mb-3 text-lg font-semibold text-foreground">Starter pack</h2>
      <div className="rounded-xl border border-border bg-card p-5 text-sm">
        <p className="font-medium text-foreground">
          {pack.state === "off" ? "Off: new members get the welcome credit." : pack.state === "scheduled" ? `Starts for accounts created from ${when(s.starterPackFrom!)} (UK time).` : `Live for accounts created from ${when(s.starterPackFrom!)} (UK time).`}
        </p>
        <dl className="mt-3 grid max-w-xl grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
          <dt>Stripe</dt>
          <dd className="text-foreground">{pack.stripe ? "Configured" : "Not configured"}</dd>
          <dt>STRIPE_PRICE_STARTER_PACK</dt>
          <dd className="text-foreground">{pack.priceSet ? "Set" : "Not set"}</dd>
          <dt>Credit enforcement</dt>
          <dd className="text-foreground">{pack.enforcing ? "On" : "Off (shadow mode)"}</dd>
          <dt>Last Stripe event received</dt>
          <dd className="text-foreground">{pack.lastStripeEvent ? `${pack.lastStripeEvent.type}, ${when(pack.lastStripeEvent.receivedAt)}${pack.lastStripeEvent.error ? ` (failed: ${pack.lastStripeEvent.error})` : ""}` : "None ever"}</dd>
          <dt>Packs bought</dt>
          <dd className="text-foreground">{pack.counts ? `${pack.counts.granted} granted · ${pack.counts.reserved} being settled · ${pack.counts.blocked} refused (one per person, not charged) · ${pack.counts.failed} failed` : "Unreadable (schema not run?)"}</dd>
        </dl>
        {pack.warnings.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
            {pack.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      <h2 className="mt-10 mb-3 text-lg font-semibold text-foreground">Settings</h2>
      <SettingsForm
        values={{
          starterPackFromLocal: isoToLondonLocal(s.starterPackFrom),
          inactivityFromLocal: isoToLondonLocal(s.inactivityFrom),
          starterPackPricePence: s.starterPackPricePence,
          starterPackCreditPence: s.starterPackCreditPence,
          starterPackSnoozeDays: s.starterPackSnoozeDays,
          lowCreditPence: s.lowCreditPence,
          inactiveReengageDays: s.inactiveReengageDays,
          picksPauseInactiveDays: s.picksPauseInactiveDays,
        }}
      />

      <h2 id="mobile" className="mt-10 mb-1 text-lg font-semibold text-foreground">
        Mobile numbers
      </h2>
      <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
        Records every account&rsquo;s mobile number as claimed, as the welcome check does for new accounts. Where accounts share a number the oldest keeps it and the others are listed; no credit is taken back. Also at <code>/api/internal/mobile-backfill</code> (GET is a dry run).
      </p>
      <MobilePanel />

      <h2 id="monday" className="mt-10 mb-1 text-lg font-semibold text-foreground">
        Monday sales funnel and inactivity
      </h2>
      <div className="mb-3 max-w-3xl space-y-1 text-sm text-muted-foreground">
        <p>
          Every member&rsquo;s row on &ldquo;Stayful Intelligence enquiries&rdquo;: its group and the site&rsquo;s columns. Events (a payment, a plan change, low credit, coming back) are queued and written within ten minutes; the nightly, from 06:00 UK, first moves quiet members into Re-engage and pauses their daily picks, then corrects every row. Also at <code>/api/internal/monday-funnel</code> (<code>?dry=1</code>) and <code>/api/internal/monday-backfill</code> (GET is a dry run).
        </p>
        <p>
          Monday writes: <strong className="text-foreground">{funnel.enabled ? "on" : "off (MONDAY_FUNNEL_ENABLED is not \"true\")"}</strong>; API key {funnel.token ? "set" : "not set"}. Queue: {funnel.queued ?? "unreadable"}
          {funnel.queued ? ` (oldest ${when(funnel.oldestQueued!)}${funnel.failing ? `, ${funnel.failing} retrying` : ""})` : ""}. In Re-engage: {funnel.reengage ?? "unreadable"}; daily picks paused: {funnel.picksPaused ?? "unreadable"}.
        </p>
        {funnel.runs && funnel.runs.length > 0 ? (
          <p>
            Nightly runs:{" "}
            {funnel.runs.map((r) => `${r.day}: ${r.finished_at ? `finished ${when(r.finished_at)}` : r.started_at ? "started, not finished" : "not started"}${r.inactivity_at ? ", inactivity done" : ""}`).join(" · ")}
          </p>
        ) : null}
        <p>Switch the n8n trigger on only after the backfill has run: it moves many rows at once.</p>
      </div>
      <MondayPanel enabled={funnel.enabled && funnel.token} />
    </div>
  );
}
