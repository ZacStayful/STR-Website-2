import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { LeadsNav } from "./LeadsNav";
import { leadScopeOrPaused } from "@/lib/leads/scope";
import { teamName } from "@/lib/team";

export const dynamic = "force-dynamic";

// Inbound leads from a member's white-label funnels. Reading them never runs
// an analysis, so this section never costs credit — the spend happened when
// the prospect completed the funnel.
//
// Deliberately NOT the same surface as /reports: that is the properties a
// member chose to research themselves. Mixing the two would confuse what the
// member is looking at and what they paid for.
export default async function LeadsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/leads");

  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).single();
  if (!profile) redirect("/upgrade?redirect=/leads");

  const scope = await leadScopeOrPaused(user);
  if (scope === "paused") {
    return (
      <AppShell active="leads" redirectTo="/leads">
        <main className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
          <h1 className="text-xl font-bold text-foreground">Your team access is paused</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your seat couldn&apos;t be renewed because the team&apos;s balance is too low. It comes back automatically as
            soon as the account owner tops up.
          </p>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell active="leads" redirectTo="/leads">
      <div className="mx-auto max-w-4xl px-4 pt-8 sm:px-6">
        {scope.role === "member" ? (
          <p className="mb-2 text-xs text-muted-foreground">You&apos;re working in {await teamName(scope.ownerId)}.</p>
        ) : null}
        <LeadsNav role={scope.role} />
      </div>
      {children}
    </AppShell>
  );
}
