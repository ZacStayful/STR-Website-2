import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { spendSummary } from "@/lib/broker/store";
import { pmiAccount, pmiConfigured } from "@/lib/broker/providers/pmi";

export const metadata: Metadata = {
  title: "Admin — Stayful Intelligence",
  robots: { index: false, follow: false },
};

// Always fresh, never cached — admin-only, session-scoped data.
export const dynamic = "force-dynamic";

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  plan: string | null;
  plan_code: string | null;
  reports_run: number | null;
  created_at: string | null;
  last_seen_at: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

async function getMarketHealth(): Promise<{ areas: number; samples: number } | null> {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return null;
  const base = (process.env.MARKET_STATS_API_URL ?? "https://stayful-str-estimate-software.vercel.app").replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/api/market-stats`, {
      headers: { "x-internal-secret": secret },
      next: { revalidate: 300 },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const areas = Array.isArray(d.areas) ? d.areas : [];
    return {
      areas: areas.length,
      samples: areas.reduce((s: number, a: { total_sample_count?: number }) => s + (a.total_sample_count ?? 0), 0),
    };
  } catch {
    return null;
  }
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-3xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?redirect=/admin");
  // Non-admins get a 404 — don't reveal that the admin area exists.
  if (!isAdminEmail(user.email)) notFound();

  // Aggregate over profiles via the service-role client (bypasses RLS).
  let rows: ProfileRow[] = [];
  let loadError = false;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("id, email, full_name, plan, plan_code, reports_run, created_at, last_seen_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw error;
    rows = (data ?? []) as ProfileRow[];
  } catch (err) {
    console.error("[admin] profiles query failed:", err);
    loadError = true;
  }

  const total = rows.length;
  const pro = rows.filter((r) => r.plan_code || r.plan === "pro").length;
  const free = total - pro;
  const totalReports = rows.reduce((s, r) => s + (r.reports_run ?? 0), 0);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const signups7d = rows.filter((r) => r.created_at && new Date(r.created_at).getTime() >= weekAgo).length;
  const recent = rows.slice(0, 15);

  const market = await getMarketHealth();
  const [spend, pmi] = await Promise.all([
    spendSummary(7).catch(() => []),
    pmiConfigured() ? pmiAccount().catch(() => null) : Promise.resolve(null),
  ]);
  const todayKey = new Date().toISOString().slice(0, 10);
  const spendToday = spend.filter((r) => r.day === todayKey);
  const todayPence = spendToday.reduce((n, r) => n + r.pence, 0);

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Admin dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {user.email}. This page is only visible to admins.
          </p>
        </div>
        <span className="flex gap-4">
          <Link href="/admin/billing" className="text-sm font-medium text-primary hover:underline">
            Billing admin
          </Link>
          <Link href="/estimate" className="text-sm font-medium text-primary hover:underline">
            → Analyser
          </Link>
        </span>
      </div>

      {loadError && (
        <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Couldn’t load profile data (check SUPABASE_SERVICE_ROLE_KEY). Aggregates below may be empty.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total users" value={total} />
        <Stat label="Pro" value={pro} sub={`${free} free`} />
        <Stat label="Reports run" value={totalReports} />
        <Stat label="New (7 days)" value={signups7d} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Market Explorer areas"
          value={market ? market.areas : "—"}
          sub={market ? `${market.samples} samples` : "endpoint unavailable"}
        />
      </div>

      <h2 className="mt-10 mb-3 text-lg font-semibold text-foreground">Data spend (last 7 days)</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Every paid provider call goes through the data broker and is recorded here. Today: £{(todayPence / 100).toFixed(2)}
        {pmi ? ` · PMI credits remaining ${pmi.credits_remaining ?? "?"} of ${pmi.credits_monthly ?? "?"} (${pmi.plan ?? "plan"})` : pmiConfigured() ? " · PMI account unreachable" : " · PMI not configured"}
        . Run the <Link href="/api/internal/provider-spike?dry=1" className="text-primary hover:underline">provider spike</Link> (add <code>&amp;dry=0</code> to spend) to check parsers and coverage.
      </p>
      {spend.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No provider calls recorded yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Day</th>
                <th className="px-4 py-2 font-medium">Provider</th>
                <th className="px-4 py-2 font-medium">Calls</th>
                <th className="px-4 py-2 font-medium">Cache hits</th>
                <th className="px-4 py-2 font-medium">Spend</th>
              </tr>
            </thead>
            <tbody>
              {spend.map((r) => (
                <tr key={`${r.day}-${r.provider}`} className="border-t border-border">
                  <td className="px-4 py-2">{r.day}</td>
                  <td className="px-4 py-2">{r.provider}</td>
                  <td className="px-4 py-2">{r.calls}</td>
                  <td className="px-4 py-2">{r.cacheHits}</td>
                  <td className="px-4 py-2">£{(r.pence / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-10 mb-3 text-lg font-semibold text-foreground">Recent signups</h2>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Plan</th>
              <th className="p-3 font-medium">Reports</th>
              <th className="p-3 font-medium">Joined</th>
              <th className="p-3 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 ? (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={6}>No users yet.</td>
              </tr>
            ) : (
              recent.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3 text-foreground">{r.email ?? "—"}</td>
                  <td className="p-3 text-muted-foreground">{r.full_name ?? "—"}</td>
                  <td className="p-3">
                    <span className={r.plan_code ? "font-medium text-primary" : "text-muted-foreground"}>
                      {r.plan_code ?? "pay as you go"}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">{r.reports_run ?? 0}</td>
                  <td className="p-3 text-muted-foreground">{fmtDate(r.created_at)}</td>
                  <td className="p-3 text-muted-foreground">{fmtDate(r.last_seen_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
