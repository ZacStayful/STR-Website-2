import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { intelligenceStats, type RevealFacts, type SearchFacts } from "@/lib/intelligence/admin";
import { memberSearchEnabled } from "@/lib/sourcing-demand/member-search";

export const metadata: Metadata = { title: "Stayful Intelligence — admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const DAYS = 90;
const sinceIso = () => new Date(Date.now() - DAYS * 86_400_000).toISOString();
const money = (pence: number | null) => (pence === null ? "—" : `£${(pence / 100).toFixed(2)}`);
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
const secs = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`);

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/**
 * Batch 22: how the signup reveal is doing. Reveals and member searches from
 * the last 90 days (figures in src/lib/intelligence/admin.ts). No member is
 * named on this page.
 */
export default async function IntelligenceAdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/intelligence");
  if (!isAdminEmail(user.email)) notFound();

  const since = sinceIso();
  let ready = hasServiceRole();
  let reveals: RevealFacts[] = [];
  let searches: SearchFacts[] = [];
  let welcomeReports = 0;
  if (ready) {
    const admin = createAdminClient();
    const [r, s, w] = await Promise.all([
      admin.from("signup_reveals").select("viewed_at, first_keep_ms, strong, no_match, layer").gte("created_at", since).limit(10000),
      admin.from("member_searches").select("purpose, status, raw_pence, charged_base_pence, found, confirmed").gte("created_at", since).limit(10000),
      admin.from("analysis_purchases").select("id", { count: "exact", head: true }).in("offer", ["welcome", "welcome_deep"]).neq("status", "failed").gte("created_at", since),
    ]);
    if (r.error || s.error) ready = false;
    reveals = (r.data ?? []) as RevealFacts[];
    searches = ((s.data ?? []) as SearchFacts[]).map((x) => ({ ...x, raw_pence: Number(x.raw_pence) || 0, charged_base_pence: Number(x.charged_base_pence) || 0 }));
    welcomeReports = w.count ?? 0;
  }
  const st = intelligenceStats(reveals, searches);

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Stayful Intelligence</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            The signup reveal and member searches, last {DAYS} days. Member searches are {memberSearchEnabled() ? "ON" : "OFF (set MEMBER_SEARCH_ENABLED=true)"}; the reveal, its ranking and the what-ifs run either way.
          </p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">← Dashboard</Link>
      </div>

      {!ready && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Not set up yet: run the “Batch 22: signup reveal” section of supabase/schema.sql.
        </p>
      )}

      <h2 className="mb-3 text-base font-semibold text-foreground">The reveal</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Reveals" value={st.reveals} sub={`${st.viewed} viewed`} />
        <Stat label="Time to first Keep" value={secs(st.medianFirstKeepMs)} sub={`median · ${pct(st.under10s)} under 10 s`} />
        <Stat label="Strong match" value={pct(st.strongShare)} sub="of viewed reveals" />
        <Stat label="No match" value={pct(st.noMatchShare)} sub="of viewed reveals (by area on Demand vs supply)" />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Where #1 came from: {Object.keys(st.byLayer).length === 0 ? "—" : Object.entries(st.byLayer).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ")}. Reports run at the welcome price: {welcomeReports}.
      </p>

      <h2 className="mb-3 mt-8 text-base font-semibold text-foreground">Member searches</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Signup searches" value={st.signupSearches.runs} sub={`${st.signupSearches.finds} new deals found`} />
        <Stat label="Signup search cost" value={money(st.signupSearches.rawPence)} sub={`${money(st.signupSearches.perSignupPence)} per reveal (house spend)`} />
        <Stat label="Deep searches" value={st.deepSearches.runs} sub={`${st.deepSearches.finds} new deals found`} />
        <Stat label="Deep search cost / revenue" value={`${money(st.deepSearches.rawPence)} / ${money(st.deepSearches.revenuePence)}`} sub="raw cost / charged (plan price)" />
      </div>
    </div>
  );
}
