import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

// Home (Batch 22e) is members-only and where a member lands after logging in
// (HOME_PATH). It reads; nothing on it is charged.
export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/home");

  return (
    <AppShell active="home" redirectTo="/home">
      {children}
    </AppShell>
  );
}
