import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

// The deals marketplace is members-only. Browsing the grid never costs
// credit; opening a deal sheet is charged by the deal's profit band.
export default async function DealsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/deals");

  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).single();
  if (!profile) redirect("/upgrade?redirect=/deals");

  return (
    <AppShell active="deals" redirectTo="/deals">
      {children}
    </AppShell>
  );
}
