import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { getBillingSettings, getUnitCostTable } from "@/lib/credit/unit-costs";
import { estimateAction } from "@/lib/credit/estimate";
import { formatGbp } from "@/lib/credit/pricing";
import { isEnforcing } from "@/lib/credit/http";
import { BillingAdminClient } from "./BillingAdminClient";

export const metadata: Metadata = { title: "Billing admin — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function sevenDaysAgoIso(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString();
}

interface CallStat {
  provider: string;
  unit: string;
  calls: number;
  rawPence: number;
  chargedPence: number;
}

export default async function BillingAdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/billing");
  if (!isAdminEmail(user.email)) notFound();

  const admin = createAdminClient();
  const since = sevenDaysAgoIso();
  const [table, settings, calls, tx, codes] = await Promise.all([
    getUnitCostTable(),
    getBillingSettings(),
    admin.from("provider_calls").select("provider, unit, cost_pence, charged_pence, ok, cache_hit").gte("at", since),
    admin.from("credit_transactions").select("kind, amount_pence, base_pence, action").gte("at", since),
    admin.from("credit_codes").select("code, kind, amount_pence, max_redemptions, redeemed_count, expires_at, active, created_by, owner_user_id").order("created_at", { ascending: false }).limit(50),
  ]);

  const stats = new Map<string, CallStat>();
  for (const r of calls.data ?? []) {
    if (!r.ok || r.cache_hit) continue;
    const key = `${r.provider}:${r.unit ?? ""}`;
    const s = stats.get(key) ?? { provider: String(r.provider), unit: String(r.unit ?? ""), calls: 0, rawPence: 0, chargedPence: 0 };
    s.calls += 1;
    s.rawPence += Number(r.cost_pence) || 0;
    s.chargedPence += Number(r.charged_pence) || 0;
    stats.set(key, s);
  }
  let issued = 0;
  let consumed = 0;
  let houseBase = 0;
  for (const t of tx.data ?? []) {
    if (t.kind === "grant" || t.kind === "adjust") issued += Math.max(0, Number(t.amount_pence) || 0);
    if (t.kind === "debit") consumed += Math.abs(Number(t.amount_pence) || 0);
  }
  for (const r of calls.data ?? []) if (r.ok && !r.cache_hit && !(Number(r.charged_pence) > 0)) houseBase += Number(r.cost_pence) || 0;
  const rawTotal = (calls.data ?? []).reduce((n, r) => n + (r.ok && !r.cache_hit ? Number(r.cost_pence) || 0 : 0), 0);

  const rows = [...table.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.unit.localeCompare(b.unit)).map((u) => ({ ...u, stat: stats.get(`${u.provider}:${u.unit}`) ?? null }));
  const report = estimateAction(table, "report", { pmiSecondOpinion: process.env.PMI_SECOND_OPINION !== "false" });

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Billing admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Unit costs, spend rates, promo codes and manual adjustments. Enforcement is <strong>{isEnforcing() ? "ON" : "OFF (shadow mode)"}</strong> — set CREDIT_ENFORCE in Vercel to change it.
          </p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">← Dashboard</Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4"><div className="text-2xl font-semibold">{formatGbp(rawTotal)}</div><div className="text-xs text-muted-foreground">Provider cost, 7 days</div></div>
        <div className="rounded-xl border border-border bg-card p-4"><div className="text-2xl font-semibold">{formatGbp(consumed)}</div><div className="text-xs text-muted-foreground">Credit consumed, 7 days</div></div>
        <div className="rounded-xl border border-border bg-card p-4"><div className="text-2xl font-semibold">{formatGbp(issued)}</div><div className="text-xs text-muted-foreground">Credit issued, 7 days</div></div>
        <div className="rounded-xl border border-border bg-card p-4"><div className="text-2xl font-semibold">{formatGbp(houseBase)}</div><div className="text-xs text-muted-foreground">House spend (unbilled), 7 days</div></div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        A full report is quoted at <strong>{formatGbp(report.typicalBasePence)}</strong> typical / {formatGbp(report.maxBasePence)} worst case at the plan rate ({formatGbp(report.typicalBasePence * settings.spendRates.topup)} from top-up credit).
      </p>

      <BillingAdminClient rows={rows} settings={settings} codes={(codes.data ?? []).map((c) => ({ code: String(c.code), kind: String(c.kind), amountPence: Number(c.amount_pence), maxRedemptions: c.max_redemptions === null ? null : Number(c.max_redemptions), redeemedCount: Number(c.redeemed_count) || 0, expiresAt: (c.expires_at as string | null) ?? null, active: c.active !== false, createdBy: (c.created_by as string | null) ?? null, referral: Boolean(c.owner_user_id) }))} />
    </div>
  );
}
