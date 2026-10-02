import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { profileSummaryFor } from "@/lib/profile/server";
import { eyeLevelFor } from "@/lib/home/eye-server";
import { loadHomeFigures } from "@/lib/home/server";
import { londonParts } from "@/lib/sms/uk-time";
import { HomeView } from "./_components/HomeView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Home",
  robots: { index: false, follow: false },
};

function greeting(now: Date, name: string | null): string {
  const { hour } = londonParts(now);
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}.` : `${part}.`;
}

/**
 * Batch 22e: Home. Where a member lands after logging in: the eye, a line of
 * greeting, Today's 5 first, then what Stayful Intelligence has done for them
 * (src/lib/home holds every figure, read from the tables that hold it). It
 * reads only: nothing here is charged. A tile that cannot be read shows "—".
 */
export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/home");

  const now = new Date();
  const [summary, figures, nameRow] = await Promise.all([
    profileSummaryFor(user.id),
    loadHomeFigures({ userId: user.id, joinedAt: user.created_at ?? now.toISOString() }, now),
    hasServiceRole() ? createAdminClient().from("profiles").select("full_name").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const level = await eyeLevelFor(summary);
  const fullName = (nameRow.data as { full_name?: string | null } | null)?.full_name?.trim() ?? "";
  const firstName = fullName ? fullName.split(/\s+/)[0] : null;

  return <HomeView greeting={greeting(now, firstName)} level={level} figures={figures} />;
}
