import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadTrackedDeals } from "@/lib/listing/tracked-server";
import { RESTORE_DAYS } from "@/lib/profiles/reset";
import { dealSummary } from "../_lib/rows";
import { restoreClearedDealAction } from "./actions";

export const metadata: Metadata = {
  title: "Cleared deals — Stayful Intelligence",
  robots: { index: false, follow: false },
};

const MESSAGES: Record<string, string> = {
  restored: "Back in My deals, at the stage it had.",
  not_restored: "That deal can’t be brought back any more.",
};

/**
 * Batch 22d: the deals a member cleared with "Start again", for 30 days.
 * Read through My deals' own loader, so the address rule and the early-access
 * window are exactly My deals'. Bringing one back puts it where it was.
 */
export default async function ClearedDealsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/my-deals/cleared");
  const load = await loadTrackedDeals(user.id, { scope: "team", adminUser: isAdminEmail(user.email), hidden: "only" });
  const deals = load.view.map((v) => dealSummary(v, load));
  const message = msg ? MESSAGES[msg] ?? null : null;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:py-8">
        <header>
          <Link href="/my-deals" className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline">
            ← My deals
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-foreground">Cleared deals</h1>
          <p className="mt-1 text-sm text-muted-foreground">Deals you cleared when you started a profile again. You can bring each one back for {RESTORE_DAYS} days, at the stage it had. Clearing wasn’t a Pass.</p>
        </header>
        {message && <p role="status" className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-foreground">{message}</p>}
        {deals.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing to bring back.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {deals.map((d) => (
              <li key={d.key} className="flex min-h-14 items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{d.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {d.stage}
                    {d.price ? ` · ${d.price}` : ""}
                  </span>
                </span>
                <form action={restoreClearedDealAction}>
                  <input type="hidden" name="key" value={d.key} />
                  <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">
                    Bring back
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
