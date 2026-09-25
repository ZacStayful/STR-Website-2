import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureWelcomeGrant } from "@/lib/credit/welcome";
import { welcomeReturnPath } from "@/lib/auth/landing";
import { welcomeStatusFor, rankedAreasForWelcome } from "@/lib/onboarding/server";
import { WelcomeWizard } from "./WelcomeWizard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Welcome — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * The welcome questions: three taps and the member lands on deals that fit.
 * Every sign-in and sign-up comes through here (src/lib/auth/landing.ts),
 * and this page decides for itself whether it is due — it is never a gate,
 * so it can never trap anyone: not due (answered, skipped three times, a team
 * member, or the profile unreadable) means straight on to where they were
 * going, or the deals grid.
 */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const raw = (await searchParams).next;
  const next = welcomeReturnPath(Array.isArray(raw) ? raw[0] : raw);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/welcome");

  const status = await welcomeStatusFor(supabase, user.id);
  if (!status || !status.due) redirect(next);

  // Members' pages grant the welcome credit on first visit; this may be that
  // visit, and the postcode step spends a little of it on geocoding.
  await ensureWelcomeGrant(user.id, user.email ?? null).catch((err) => console.error("[welcome] welcome grant failed:", err));
  const areas = await rankedAreasForWelcome();

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-lg">
        <WelcomeWizard next={next} areas={areas} />
      </div>
    </main>
  );
}
