import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

// Report history is members-only. Reopening a saved report never runs an
// analysis, so it never costs credit.
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/reports");

  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).single();
  if (!profile) redirect("/upgrade?redirect=/reports");

  return (
    <AppShell active="reports" redirectTo="/reports">
      {children}
    </AppShell>
  );
}
