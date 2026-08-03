import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normaliseMobile, mobileVariants } from "@/lib/phone";

/**
 * Free reports used by this *person*, summed across every account that shares
 * their mobile number.
 *
 * The free allowance is per person, not per email address: signing up again
 * with a fresh address used to hand out a whole new set of free reports. The
 * mobile is already required and stored at signup, so it's the natural key.
 *
 * Needs the service-role client — RLS restricts a signed-in user to their own
 * profile row, so a user-scoped client cannot see the sibling accounts.
 *
 * Fails open (returns this profile's own count) if the lookup errors: a
 * transient database problem should never lock a legitimate user out of a
 * product they can access.
 */
export async function pooledReportsRun(
  profile: { reports_run: number | null; mobile: string | null },
): Promise<number> {
  const own = profile.reports_run ?? 0;

  const key = normaliseMobile(profile.mobile);
  if (!key) return own;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("mobile, reports_run")
      .in("mobile", mobileVariants(key));

    if (error) {
      console.error("[usage] pooled lookup failed:", error.message);
      return own;
    }

    // mobileVariants() is a superset of the spellings that map to this key, so
    // re-check each row rather than trusting the `in (...)` match.
    const total = (data ?? [])
      .filter((row) => normaliseMobile(row.mobile) === key)
      .reduce((sum, row) => sum + (row.reports_run ?? 0), 0);

    // Never report less than the caller's own usage, even if their row somehow
    // didn't come back in the lookup.
    return Math.max(own, total);
  } catch (err) {
    console.error("[usage] pooled lookup threw:", err);
    return own;
  }
}
