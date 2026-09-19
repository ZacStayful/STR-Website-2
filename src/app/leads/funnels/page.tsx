import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listFunnels } from "@/lib/funnels";
import { siteUrl } from "@/lib/url";
import { CreateFunnelForm } from "./CreateFunnelForm";

export const metadata: Metadata = {
  title: "Funnels — Stayful Intelligence",
  robots: { index: false, follow: false },
};

export default async function FunnelsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const funnels = await listFunnels(user.id);

  // One count query for all funnels, grouped in memory — a per-funnel query
  // would be one round trip each.
  const { data: leadRows } = await supabase.from("leads").select("funnel_id").eq("user_id", user.id);
  const counts = new Map<string, number>();
  for (const r of leadRows ?? []) {
    const id = (r as { funnel_id: string | null }).funnel_id;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Funnels</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Each funnel is a link you put behind your own enquiry form. Whoever fills it in gets a report under
              your branding, and the lead lands in <Link href="/leads" className="underline underline-offset-2">Leads</Link>.
            </p>
          </div>
          <Link href="/leads" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
            ← Leads
          </Link>
        </div>

        <section className="mb-6 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">New funnel</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Name it after where the enquiries come from, so you can tell them apart later.
          </p>
          <CreateFunnelForm />
        </section>

        {funnels.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm font-medium text-foreground">No funnels yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Create one above to get your link.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {funnels.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {f.name}
                    {!f.active ? <span className="ml-2 text-xs font-normal text-muted-foreground">(paused)</span> : null}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {siteUrl(`/f/${f.publicToken}`)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {counts.get(f.id) ?? 0} lead{(counts.get(f.id) ?? 0) === 1 ? "" : "s"}
                    {" · "}
                    {f.reportDepth === "enhanced" ? "Enhanced report" : "Standard report"}
                    {" · "}
                    up to {f.dailyCap}/day
                  </p>
                </div>
                <Link
                  href={`/leads/funnels/${f.id}`}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  Settings
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
