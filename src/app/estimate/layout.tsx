import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/access";

// Server component that wraps /estimate. Fetches the current user's profile,
// runs hasAccess() against plan + trial_ends_at, and bounces trial-expired
// users to /upgrade. Anyone not logged in is already redirected to /login
// by the middleware (proxy.ts → PROTECTED_PREFIXES).
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
    .select("plan, trial_ends_at")
    .eq("id", user.id)
    .single();

  if (!profile || !hasAccess(profile)) {
    redirect("/upgrade");
  }

  return <>{children}</>;
}
