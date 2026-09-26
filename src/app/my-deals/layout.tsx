import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

// My deals is members-only. Moving a deal between stages is free; opening one
// and running a full report are charged where they happen. The `reports`
// section is the one the nav lights "My deals" for (src/lib/nav.ts).
export default async function MyDealsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/my-deals");

  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).single();
  if (!profile) redirect("/upgrade?redirect=/my-deals");

  return (
    <AppShell active="reports" redirectTo="/my-deals">
      {children}
    </AppShell>
  );
}
