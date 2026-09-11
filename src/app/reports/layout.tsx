import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAccess, isPro, runsRemaining } from "@/lib/access";
import { isAdminEmail } from "@/lib/admin";
import { TrialBanner } from "@/components/TrialBanner";
import { AppSwitcher } from "@/components/AppSwitcher";
import { checkoutUrlFor } from "@/lib/billing";

export const dynamic = "force-dynamic";

// Report history is members-only, gated exactly like the analyser. Reopening
// a saved report never runs an analysis, so it never counts against runs.
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/reports");

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, reports_run, stripe_subscription_id")
    .eq("id", user.id)
    .single();
  const admin = isAdminEmail(user.email);
  if (!profile || (!admin && !hasAccess(profile))) redirect("/upgrade?redirect=/reports");

  const showTrialBanner = !admin && !isPro(profile);
  return (
    <>
      <AppSwitcher active="reports" admin={admin} />
      {showTrialBanner && <TrialBanner remaining={runsRemaining(profile)} checkoutHref={checkoutUrlFor(user.id, user.email ?? null)} />}
      {children}
    </>
  );
}
