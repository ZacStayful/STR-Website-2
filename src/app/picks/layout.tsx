import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

// Daily picks are members-only. Viewing a pick never costs credit; saving one
// to the pipeline runs the same listing check as pasting its link.
export default async function PicksLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/picks");

  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).single();
  if (!profile) redirect("/upgrade?redirect=/picks");

  return (
    <AppShell active="picks" redirectTo="/picks">
      {children}
    </AppShell>
  );
}
