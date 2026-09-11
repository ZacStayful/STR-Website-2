import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { AppSwitcher } from '@/components/AppSwitcher';

export const dynamic = 'force-dynamic';

/**
 * Auth only — deliberately NOT gated on hasAccess().
 *
 * A paused, lapsed or cancelling member is exactly who needs this page, and
 * every one of them fails the access check. Gating it would put the resume and
 * undo buttons behind the paywall they are trying to get out of. Anonymous
 * visitors are already sent to /login by proxy.ts (PROTECTED_PREFIXES), and
 * robots.ts keeps the path out of search.
 *
 * No TrialBanner either: the plan card below says everything the banner would,
 * with more detail and the buttons to act on it.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/account');

  return (
    <>
      <AppSwitcher active="account" admin={isAdminEmail(user.email)} />
      {children}
    </>
  );
}
