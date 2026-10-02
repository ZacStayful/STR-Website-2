import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { getFunnelTierSettings } from "@/lib/funnels/tiers-server";
import { money } from "@/lib/funnels/tiers";
import { mcReport, type McAccount, type McCharge } from "@/lib/management/report";
import { FunnelNoticePanel, TestMonthPanel } from "./Panels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Management companies — Admin", robots: { index: false, follow: false } };

/**
 * Batch 22f: management companies — page views → sign-ups → paid → live →
 * first real lead, leads a month, median minutes from sign-up to live,
 * revenue by tier, each account's journey; the funnel owners' price notice;
 * and a test month for the tiers.
 */
export default async function AdminManagement() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/management");
  if (!isAdminEmail(user.email)) notFound();

  const tiers = await getFunnelTierSettings();
  let accounts: McAccount[] = [];
  let charges: McCharge[] = [];
  let views: Array<{ views: number; tagged: number }> = [];
  let readError: string | null = null;
  if (hasServiceRole()) {
    const admin = createAdminClient();
    const [p, c, v] = await Promise.all([
      admin.from("profiles").select("id, email, created_at, signup_path_at, signup_path_via, starter_pack_bought_at").eq("signup_path", "management").order("signup_path_at", { ascending: false }).limit(1000),
      admin.from("funnel_lead_charges").select("owner_id, month, n, base_pence").order("month", { ascending: false }).limit(20000),
      admin.from("mc_page_views").select("views, tagged"),
    ]);
    readError = p.error?.message ?? c.error?.message ?? v.error?.message ?? null;
    const rows = (p.data ?? []) as Array<{ id: string; email: string | null; created_at: string; signup_path_at: string | null; signup_path_via: string | null; starter_pack_bought_at: string | null }>;
    const ids = rows.map((r) => r.id);
    const { data: f } = ids.length ? await admin.from("funnels").select("user_id, first_live_at").in("user_id", ids).not("first_live_at", "is", null) : { data: [] };
    const live = new Map<string, string>();
    for (const r of (f ?? []) as Array<{ user_id: string; first_live_at: string }>) {
      const prev = live.get(r.user_id);
      if (!prev || r.first_live_at < prev) live.set(r.user_id, r.first_live_at);
    }
    const chargeRows = (c.data ?? []) as Array<{ owner_id: string; month: string; n: number | null; base_pence: number | null }>;
    const leadsBy = new Map<string, number>();
    for (const r of chargeRows) leadsBy.set(r.owner_id, (leadsBy.get(r.owner_id) ?? 0) + 1);
    accounts = rows.map((r) => ({ id: r.id, email: r.email, createdAt: r.created_at, stampedAt: r.signup_path_at, via: r.signup_path_via, packPaid: Boolean(r.starter_pack_bought_at), firstLiveAt: live.get(r.id) ?? null, chargedLeads: leadsBy.get(r.id) ?? 0 }));
    charges = chargeRows.map((r) => ({ month: r.month, n: r.n, basePence: r.base_pence }));
    views = (v.data ?? []) as Array<{ views: number; tagged: number }>;
  }
  const r = mcReport({ views, accounts, charges, tiers: tiers.tiers });
  const steps: Array<[string, number]> = [["Page views", r.pageViews], ["Sign-ups", r.signups], ["Paid the pack", r.paid], ["Went live", r.live], ["First real lead", r.firstLead]];

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <Link href="/admin" className="text-sm text-primary hover:underline">← Admin</Link>
      <h1 className="mt-2 text-2xl font-bold text-foreground">Management companies</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Accounts stamped as a management company (profiles.signup_path), from /for-management-companies. Page views are counted anonymously ({r.taggedViews} from an ad or tagged link).
      </p>
      {readError ? <p className="mt-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">Read failed (schema.sql not run?): {readError}</p> : null}

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {steps.map(([label, n]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{n}</p>
          </div>
        ))}
      </section>
      <p className="mt-3 text-sm text-muted-foreground">
        Median sign-up to live: {r.medianMinutesToLive === null ? "—" : `${r.medianMinutesToLive} minutes`}. Ways in: {Object.entries(r.byVia).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet"}.
      </p>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Charged leads a month (all owners on tiers)</h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {r.leadsByMonth.length === 0 ? <tr><td className="text-muted-foreground">None yet.</td></tr> : r.leadsByMonth.map((m) => (
                <tr key={m.month} className="border-t border-border"><td className="py-1.5">{m.month.slice(0, 7)}</td><td className="py-1.5">{m.leads} leads</td><td className="py-1.5 text-right">{money(m.pence)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Revenue by tier (base price)</h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {r.revenueByTier.map((t) => (
                <tr key={t.from} className="border-t border-border"><td className="py-1.5">From lead {t.from}</td><td className="py-1.5">{t.leads} leads</td><td className="py-1.5 text-right">{money(t.pence)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Journeys</h2>
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Account</th><th className="py-1">Stamped</th><th className="py-1">Way in</th><th className="py-1">Pack</th><th className="py-1">Live</th><th className="py-1">Leads</th></tr></thead>
          <tbody>
            {accounts.slice(0, 200).map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="py-1.5">{a.email ?? a.id}</td>
                <td className="py-1.5">{a.stampedAt?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                <td className="py-1.5">{a.via ?? "—"}</td>
                <td className="py-1.5">{a.packPaid ? "Paid" : "—"}</td>
                <td className="py-1.5">{a.firstLiveAt ? `${Math.round((Date.parse(a.firstLiveAt) - Date.parse(a.createdAt)) / 60_000)} min` : "—"}</td>
                <td className="py-1.5">{a.chargedLeads}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <FunnelNoticePanel />
        <TestMonthPanel />
      </div>
    </main>
  );
}
