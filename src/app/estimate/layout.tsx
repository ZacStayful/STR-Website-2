import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ACCESS_COLUMNS,
  accountStatus,
  freeReportsRemaining,
  hasAccess,
} from "@/lib/access";
import { isAdminEmail } from "@/lib/admin";
import { TrialBanner } from "@/components/TrialBanner";
import { checkoutUrlFor } from "@/lib/billing";
import { ensureEnquiry } from "@/lib/apis/monday";

// Server component that wraps /estimate. Fetches the current user's profile,
// runs hasAccess() against the derived account status (subscriber → unlimited;
// otherwise 5 free reports), bounces users without access to /upgrade, and
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
      `${ACCESS_COLUMNS}, monday_item_id, email, full_name, mobile, created_at`,
    )
    .eq("id", user.id)
    .single();

  // Admins (matched by verified auth email) have unlimited access — they never
  // hit the free-report limit or the paywall.
  const admin = isAdminEmail(user.email);

  if (!profile || (!admin && !hasAccess(profile))) {
    redirect("/upgrade");
  }

  // Mirror return-visit timestamp to the profile. Run via after() so it
  // completes after the response is sent without being killed by the
  // serverless runtime (and without blocking the analyser from rendering).
  const now = new Date().toISOString();
  after(async () => {
    try {
      await supabase.from("profiles").update({ last_seen_at: now }).eq("id", user.id);
    } catch (err) {
      console.error("[estimate/layout] last_seen hook failed:", err);
    }
  });

  // Resilient Monday CRM backfill. The primary trial→Monday push happens once
  // in /auth/callback; if Monday was unconfigured or unreachable at that
  // instant the row is never created and never retried. Every trial user must
  // visit /estimate to use the product, so retry here until the profile is
  // linked. ensureEnquiry dedupes by email, so this can't create a second row,
  // and it short-circuits cheaply when Monday isn't configured. after() keeps
  // it off the render path while guaranteeing it runs to completion.
  if (!profile.monday_item_id) {
    after(async () => {
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
    });
  }

  // Banner is for non-subscribers only. Subscribers (paying customers and
  // Stripe-trial customers) and admins have unlimited access, so they must
  // never see free-report copy. `status` is derived from plan AND the Stripe
  // subscription status, so a customer whose `plan` write failed still counts
  // as a subscriber and stays out of the trial UI.
  const status = accountStatus(profile);
  const bannerVariant =
    admin || status === "paid" || status === "subscription_trial"
      ? null
      : status === "lapsed"
        ? ("lapsed" as const)
        : ("free_trial" as const);
  const remaining = freeReportsRemaining(profile);
  const checkoutHref = checkoutUrlFor(user.id, user.email ?? null);

  return (
    <>
      {admin && (
        <div
          style={{
            display: "flex",
            gap: 16,
            justifyContent: "center",
            alignItems: "center",
            padding: "6px 12px",
            fontSize: 13,
            background: "#2E3D2B",
            color: "#fff",
          }}
        >
          <span>Admin</span>
          <Link href="/admin" style={{ color: "#B9D5C6", fontWeight: 600 }}>
            Dashboard
          </Link>
          <Link href="/markets" style={{ color: "#B9D5C6", fontWeight: 600 }}>
            Market Explorer
          </Link>
        </div>
      )}
      {bannerVariant && (
        <TrialBanner
          variant={bannerVariant}
          remaining={remaining}
          checkoutHref={checkoutHref}
        />
      )}
      {children}
    </>
  );
}
