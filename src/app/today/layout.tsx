import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

// The first screen a member sees each day. Members-only, like the grid it
// draws from: browsing and Keep / Pass are free, opening a deal is charged.
export default async function TodayLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/today");

  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).single();
  if (!profile) redirect("/upgrade?redirect=/today");

  return (
    <AppShell active="today" redirectTo="/today">
      {children}
    </AppShell>
  );
}
