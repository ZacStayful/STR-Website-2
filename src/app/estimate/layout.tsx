import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAccess, isPro, runsRemaining } from "@/lib/access";
import { TrialBanner } from "@/components/TrialBanner";
import { checkoutUrlFor } from "@/lib/billing";
import { ensureEnquiry } from "@/lib/apis/monday";

// Server component that wraps /estimate. Fetches the current user's profile,
// runs hasAccess() against plan + reports_run (5 free reports, then pro),
// bounces users who've used all their free reports to /upgrade, and
// (fire-and-forget) updates the Monday CRM with last_seen_at. Anyone not
// logged in is already redirected to /login by the middleware
// (proxy.ts → PROTECTED_PREFIXES).
export default async function EstimateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware should have already redirected when there is no user, but
  // be defensive — never render the analyser to an anonymous request.
  if (!user) {
    redirect("/login?redirect=/estimate");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "plan, reports_run, monday_item_id, stripe_subscription_id, email, full_name, mobile, created_at",
    )
    .eq("id", user.id)
    .single();

  if (!profile || !hasAccess(profile)) {
    redirect("/upgrade");
  }

  // Mirror return-visit timestamp to the profile (fire-and-forget so it
  // never blocks the analyser from rendering).
  const now = new Date().toISOString();
  void (async () => {
    try {
      await supabase.from("profiles").update({ last_seen_at: now }).eq("id", user.id);
    } catch (err) {
      console.error("[estimate/layout] last_seen hook failed:", err);
    }
  })();

  // Resilient Monday CRM backfill. The primary trial→Monday push happens once
  // in /auth/callback; if Monday was unconfigured or unreachable at that
  // instant the row is never created and never retried. Every trial user must
  // visit /estimate to use the product, so retry here (fire-and-forget) until
  // the profile is linked. ensureEnquiry dedupes by email, so this can't create
  // a second row, and it short-circuits cheaply when Monday isn't configured.
  if (!profile.monday_item_id) {
    void (async () => {
      try {
        const mondayId = await ensureEnquiry({
          name: profile.full_name ?? "",
          email: profile.email ?? user.email ?? "",
          mobile: profile.mobile ?? "",
          trialStartedAt: profile.created_at ?? undefined,
        });
        if (mondayId) {
          await supabase
            .from("profiles")
            .update({ monday_item_id: mondayId })
            .eq("id", user.id);
        }
      } catch (err) {
        console.error("[estimate/layout] Monday backfill failed:", err);
      }
    })();
  }

  // Trial countdown banner for free users (Pro users have unlimited access).
  const showTrialBanner = !isPro(profile);
  const remaining = runsRemaining(profile);
  const checkoutHref = checkoutUrlFor(user.id, user.email ?? null);

  return (
    <>
      {showTrialBanner && (
        <TrialBanner remaining={remaining} checkoutHref={checkoutHref} />
      )}
      {children}
    </>
  );
}
