import { redirect } from "next/navigation";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { teamOf } from "@/lib/team";
import { teamCreditSnapshot } from "@/lib/team/credit";
import { ownsAnyFunnel } from "@/lib/funnels/ownership";
import type { Section } from "@/lib/nav";
import { ensureWelcomeGrant } from "@/lib/credit/welcome";
import { syncChecklist } from "@/lib/today/checklist-server";
import { AppSwitcher } from "@/components/AppSwitcher";
import { CreditProvider, type CreditSnapshot } from "@/components/credit/CreditProvider";
import { CreditBanner } from "@/components/credit/CreditBanner";
import { VisitHeartbeat } from "@/components/activity/VisitHeartbeat";
import { requireProfileStart } from "@/lib/profile/server";
import { profilesFor } from "@/lib/profiles/server";
import { isRunning, labelsShown } from "@/lib/profiles/rules";
import type { PillProfiles } from "@/components/ProfilePill";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { MembersFooter } from "@/components/feedback/MembersFooter";

/**
 * Server shell for every members-only surface: resolves the member, their
 * credit and whether they keep a Leads door once, then renders the app nav
 * (with the balance badge), the low-balance banner and the provider that
 * owns the out-of-credit modal.
 */
export async function AppShell({ active, redirectTo, children }: { active: Section; redirectTo: string; children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=${encodeURIComponent(redirectTo)}`);

  const admin = isAdminEmail(user.email);

  // "Last active" for the admin's high-intent list. Every members-only page
  // renders through here, so this is the one place that sees every visit;
  // written after the response, at most once an hour per member, with the
  // member's own client (the column is granted to `authenticated`).
  const now = new Date();
  const nowIso = now.toISOString();
  const hourAgoIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  after(async () => {
    try {
      await supabase.from("profiles").update({ last_seen_at: nowIso }).eq("id", user.id).or(`last_seen_at.is.null,last_seen_at.lt.${hourAgoIso}`);
    } catch (err) {
      console.error("[AppShell] last_seen hook failed:", err);
    }
  });
  // First-week checklist: a step done on any page (an open, a report, a
  // share) is credited as the member moves on, not only when they next open
  // Today, which brings it up to date itself. Returns at once for anyone past
  // their first week, and never throws.
  if (active !== "today") after(() => syncChecklist(user.id));

  let credit: CreditSnapshot | null = null;
  try {
    await ensureWelcomeGrant(user.id, user.email ?? null);
  } catch (err) {
    console.error("[AppShell] welcome grant failed:", err);
  }
  // The profile quiz's gate (Batch 12): the three mandatory questions before
  // anything else. A member who has not answered them is sent to /welcome
  // with this page as the way back; team members are never gated. The same
  // read feeds the Profile pill. It throws a redirect, so it sits outside
  // the try below.
  const profile = await requireProfileStart(user.id, redirectTo);
  try {
    // For a team member this is the team's balance, which is what they spend.
    credit = await teamCreditSnapshot({ id: user.id, admin });
  } catch (err) {
    console.error("[AppShell] credit summary failed:", err);
  }
  // Leads stays in the nav only while the member's team owns a funnel, so
  // existing funnel customers (and the people they invited) are not cut off.
  let leads = false;
  try {
    leads = await ownsAnyFunnel((await teamOf(user.id)).ownerId);
  } catch (err) {
    console.error("[AppShell] funnel check failed:", err);
  }

  // Saved profiles (Batch 13): the pill names the active profile once there
  // are two, and opens the switcher. Nothing for a team member, whose pill is
  // not drawn, or before the Batch 13 schema has been run.
  let saved: PillProfiles | null = null;
  if (profile && !profile.teamMember) {
    try {
      const view = await profilesFor(user.id);
      if (view.readable && view.live.length > 0) {
        saved = {
          activeName: labelsShown(view.all) ? view.active?.name ?? null : null,
          items: view.live.map((p) => ({ id: p.id, name: p.name, active: p.isActive, paused: !isRunning(p) })),
          returnTo: redirectTo,
        };
      }
    } catch (err) {
      console.error("[AppShell] profiles read failed:", err);
    }
  }

  return (
    <CreditProvider initial={credit}>
      <AppSwitcher active={active} admin={admin} leads={leads} saved={saved} profile={profile && !profile.teamMember ? { percent: profile.progress.percent, complete: profile.progress.complete } : null} />
      <CreditBanner />
      <VisitHeartbeat />
      {children}
      {/* Batch 18: the way to tell us about a bug or an idea, on every members-only page. */}
      <MembersFooter />
      <FeedbackDialog />
    </CreditProvider>
  );
}
