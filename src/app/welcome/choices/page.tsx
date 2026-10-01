import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { readNotifications } from "@/lib/notifications/server";
import { notificationState } from "@/lib/notifications/registry";
import { dailyPriceLineFor } from "@/lib/notifications/daily-line-server";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { isSmsConfigured, isSmsDryRun } from "@/lib/sms/config";
import { ukMobile } from "@/lib/sms/phone";
import { hasVerifiedMobile, siCallsOn } from "@/lib/intelligence/consent";
import { isRevealMember } from "@/lib/intelligence/reveal-server";
import { revealNext } from "@/lib/intelligence/reveal";
import { CALL_BOX_LABEL, callBoxNote } from "@/lib/intelligence/choices";
import { CallBox } from "./CallBox";
import { finishChoicesAction, setDailyEmailAction } from "./actions";

export const metadata: Metadata = {
  title: "How should I keep you posted? — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/**
 * Batch 22, Part C: after the reveal, a new member's notification choices.
 * The daily email is on (as for every new member), with the panel's own price
 * line and a Turn off; the call box is unticked and needs a verified mobile.
 */
export default async function ChoicesPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; email?: string | string[] }> }) {
  const params = await searchParams;
  const next = revealNext(Array.isArray(params.next) ? params.next[0] : params.next);
  const emailMsg = Array.isArray(params.email) ? params.email[0] : params.email;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/welcome/choices");
  if (!(await isRevealMember(user.id, user.created_at))) redirect(next);

  const [state, priceLine, settings, mobile, callsOn, profile] = await Promise.all([
    readNotifications(user.id).then((s) => s ?? notificationState(null)),
    dailyPriceLineFor(user.id, isAdminEmail(user.email)),
    getBillingSettings(),
    hasVerifiedMobile(user.id),
    siCallsOn(user.id),
    hasServiceRole() ? createAdminClient().from("profiles").select("mobile").eq("id", user.id).maybeSingle().then((r) => r.data as { mobile: string | null } | null) : Promise.resolve(null),
  ]);
  const emailOn = state.daily_picks;
  const phone = mobile.phone ?? ukMobile(profile?.mobile ?? null);

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold text-foreground">How should I keep you posted?</h1>

        <section className="mt-5 space-y-2 rounded-xl border border-border bg-background p-4">
          <p className="font-semibold text-foreground">{emailOn ? "✓ I’ll email your 5 best matches every morning" : "Daily email off"}</p>
          <p className="text-sm text-muted-foreground">{priceLine}</p>
          {emailMsg === "off" && <p className="text-sm" role="status">Daily email off. Turn it back on here or in Account → Notifications.</p>}
          {emailMsg === "error" && <p className="text-sm text-destructive" role="alert">That change did not save. Please try again.</p>}
          <form action={setDailyEmailAction}>
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="on" value={emailOn ? "0" : "1"} />
            <button type="submit" className="text-sm font-medium underline underline-offset-4">
              {emailOn ? "Turn off" : "Turn on"}
            </button>
          </form>
        </section>

        {/* The call box sits outside the Continue form (its code check has forms of its own); its checkbox joins the form by id. */}
        <section className="mt-5 rounded-xl border border-border bg-background p-4">
          <CallBox form="choices-form" label={CALL_BOX_LABEL} note={callBoxNote(settings.intelligence)} verified={mobile.verified} phone={phone} available={isSmsConfigured() || isSmsDryRun()} on={callsOn} />
        </section>
        <form id="choices-form" action={finishChoicesAction} className="mt-5">
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="min-h-12 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
