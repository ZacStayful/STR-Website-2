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

  return (
    <CreditProvider initial={credit}>
      <AppSwitcher active={active} admin={admin} teamMember={Boolean(credit?.member)} leads={leads} />
      <CreditBanner />
      {children}
    </CreditProvider>
  );
}
