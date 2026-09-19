import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { LeadsNav } from "./LeadsNav";

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

  return (
    <AppShell active="leads" redirectTo="/leads">
      <div className="mx-auto max-w-4xl px-4 pt-8 sm:px-6">
        <LeadsNav />
      </div>
      {children}
    </AppShell>
  );
}
