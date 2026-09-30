import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { getBillingSettings, invalidateCreditCaches } from "@/lib/credit/unit-costs";
import { isoToLondonLocal } from "@/lib/lifecycle/admin-form";
import { MobilePanel, SettingsForm } from "./Panels";

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
    </div>
  );
}
