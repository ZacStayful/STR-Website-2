import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/access";
import { pingLastSeen } from "@/lib/monday/trial";

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
    .select("plan, reports_run, monday_item_id")
    .eq("id", user.id)
    .single();

  if (!profile || !hasAccess(profile)) {
    redirect("/upgrade");
  }

  // Mirror return-visit timestamp to the profile + the Monday CRM. Both
  // are fire-and-forget so a slow Monday call can't block the analyser
  // from rendering.
  const now = new Date().toISOString();
  const profileWithMondayId = profile;
  void (async () => {
    try {
      await supabase.from("profiles").update({ last_seen_at: now }).eq("id", user.id);
      if (profileWithMondayId.monday_item_id) {
        await pingLastSeen(profileWithMondayId.monday_item_id, now);
      }
    } catch (err) {
      console.error("[estimate/layout] last_seen hook failed:", err);
    }
  })();

  return <>{children}</>;
}
