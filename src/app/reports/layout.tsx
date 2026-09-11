import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ACCESS_COLUMNS,
  freeReportsRemaining,
  hasAccess,
  trialBannerVariant,
} from "@/lib/access";
import { formatPlanDate } from "@/lib/subscription";
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
    .select(ACCESS_COLUMNS)
    .eq("id", user.id)
    .single();
  const admin = isAdminEmail(user.email);
  if (!profile || (!admin && !hasAccess(profile))) redirect("/upgrade?redirect=/reports");

  const bannerVariant = trialBannerVariant(profile, admin);
  return (
    <>
      <AppSwitcher active="reports" admin={admin} />
      {bannerVariant && (
        <TrialBanner
          variant={bannerVariant}
          remaining={freeReportsRemaining(profile)}
          pausedUntil={formatPlanDate(profile.subscription_paused_until)}
          checkoutHref={checkoutUrlFor(user.id, user.email ?? null)}
        />
      )}
      {children}
    </>
  );
}
