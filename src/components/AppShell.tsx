import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { teamCreditSnapshot } from "@/lib/team/credit";
import { ensureWelcomeGrant } from "@/lib/credit/welcome";
import { AppSwitcher } from "@/components/AppSwitcher";
import { CreditProvider, type CreditSnapshot } from "@/components/credit/CreditProvider";
import { CreditBanner } from "@/components/credit/CreditBanner";

/**
 * Server shell for every members-only surface: resolves the member and their
 * credit once, then renders the app nav (with the balance badge), the
 * low-balance banner and the provider that owns the out-of-credit modal.
 */
export async function AppShell({ active, redirectTo, children }: { active: "estimate" | "markets" | "deals" | "picks" | "reports" | "leads" | "account"; redirectTo: string; children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=${encodeURIComponent(redirectTo)}`);

  const admin = isAdminEmail(user.email);
  let credit: CreditSnapshot | null = null;
  try {
    await ensureWelcomeGrant(user.id, user.email ?? null);
    // For a team member this is the team's balance, which is what they spend.
    credit = await teamCreditSnapshot({ id: user.id, admin });
  } catch (err) {
    console.error("[AppShell] credit summary failed:", err);
  }

  return (
    <CreditProvider initial={credit}>
      <AppSwitcher active={active} admin={admin} teamMember={Boolean(credit?.member)} />
      <CreditBanner />
      {children}
    </CreditProvider>
  );
}
