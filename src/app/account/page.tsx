import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { teamName, teamOf } from '@/lib/team';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  ACCESS_COLUMNS,
  accountStatus,
  isCancelScheduled,
  isPauseScheduled,
} from '@/lib/access';
import {
  PAUSE_MONTHS,
  addMonths,
  formatPlanDate,
  subscriptionStateFromStripe,
} from '@/lib/subscription';
import { getStripe, stripeConfigured } from '@/lib/stripe/client';
import { getPlan } from '@/lib/credit/plans';
import { getCreditSummary } from '@/lib/credit/summary';
import { formatGbp } from '@/lib/credit/pricing';
import { BRAND } from '@/lib/brand';
import { chromeStoreUrl } from '@/lib/extension/store';
import { ownsAnyFunnel } from '@/lib/funnels/ownership';
import { parseMarketGoals } from '@/lib/market/goals';
import { accountMoreLinks } from '@/lib/nav';
import { ManagePlan } from './ManagePlan';
import type { PlanView } from './plan-view';
import { AccountHeader, GoalsSection, MoreSection, NotificationsSection, SignOutForm, TeamMemberSection } from './AccountSections';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your account — Stayful Intelligence',
  robots: { index: false, follow: false },
};

// market_goals is for "What you're looking for"; it is not, and must not become, one of ACCESS_COLUMNS.
const PROFILE_COLUMNS = `${ACCESS_COLUMNS}, email, full_name, created_at, reports_total, stripe_customer_id, subscription_current_period_end, subscription_started_at, market_goals`;

/**
 * Account (Batch 11): the plan, billing, notifications and what the member is
 * looking for, then the quieter "More" doors and signing out. A team member's
 * plan and billing are the owner's, so theirs shows the team instead.
 */

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string }>;
}) {
  // Set when a resume attempted from the /upgrade paywall failed, so the
  // member is told why they are still here rather than being bounced silently.
  const { resume } = await searchParams;
  const resumeFailed = resume === 'failed';

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The layout already redirected; this is belt and braces.
  if (!user) redirect('/login?redirect=/account');
  const team = await teamOf(user.id);
  const storeUrl = chromeStoreUrl();

  // A team member's plan and billing are the owner's to manage: their Account
  // is the rest of it (and, unlike /account/team, has Sign out). Nothing
  // below this, Stripe included, runs for them.
  if (team.role === 'member') {
    const [{ data: memberRow }, name, teamOwnsFunnel] = await Promise.all([
      supabase.from('profiles').select('full_name, created_at, market_goals').eq('id', user.id).maybeSingle(),
      teamName(team.ownerId),
      ownsAnyFunnel(team.ownerId),
    ]);
    const member = (memberRow ?? {}) as { full_name?: string | null; created_at?: string | null; market_goals?: unknown };
    return (
      <main className="min-h-screen bg-[#f7f8f4] text-[#2e3d2b]">
        <div className="mx-auto max-w-2xl px-5 py-10">
          <AccountHeader name={member.full_name?.trim() || null} email={user.email} memberSince={formatPlanDate(member.created_at ?? null)} />
          <TeamMemberSection teamName={name} suspended={team.suspended} />
          <NotificationsSection />
          <GoalsSection goals={parseMarketGoals(member.market_goals ?? null)} />
          <MoreSection keys={accountMoreLinks({ teamMember: true, teamOwnsFunnel })} storeUrl={storeUrl} />
          <SignOutForm />
        </div>
      </main>
    );
  }

  const [{ data: row }, teamOwnsFunnel] = await Promise.all([
    supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).single(),
    ownsAnyFunnel(team.ownerId),
  ]);

  const profile = (row ?? {}) as Record<string, string | number | null>;
  const subscriptionId = (profile.stripe_subscription_id as string | null) ?? null;

  let periodEnd = (profile.subscription_current_period_end as string | null) ?? null;

  // Lazy backfill for a subscriber who predates these columns — anyone whose
  // subscription has never been through a webhook since this shipped. One
  // read, rendered immediately, written back after the response. It heals the
  // row the first time they open this page, so no migration script or cron is
  // needed. If Stripe is unreachable we simply render without the dates.
  if (subscriptionId && !periodEnd && stripeConfigured()) {
    try {
      const sub = await getStripe().subscriptions.retrieve(subscriptionId);
      const state = subscriptionStateFromStripe(sub);
      periodEnd = state.currentPeriodEnd;
      if (!profile.subscription_cancel_at) profile.subscription_cancel_at = state.cancelAt;
      if (!profile.subscription_paused_until) {
        profile.subscription_paused_from = state.pausedFrom;
        profile.subscription_paused_until = state.pausedUntil;
      }
      after(async () => {
        try {
          await createAdminClient()
            .from('profiles')
            .update({
              subscription_current_period_end: state.currentPeriodEnd,
              subscription_cancel_at: state.cancelAt,
              subscription_paused_from: state.pausedFrom,
              subscription_paused_until: state.pausedUntil,
              stripe_subscription_status: state.status,
            })
            .eq('id', user.id);
        } catch (err) {
          console.error('[account] backfill write failed:', err);
        }
      });
    } catch (err) {
      console.error('[account] could not read the subscription from Stripe:', err);
    }
  }

  const status = accountStatus(profile);
  const cancelScheduled = isCancelScheduled(profile);
  const pauseScheduled = isPauseScheduled(profile);

  // What the plan card says about the tier: price and the credit it brings.
  const plan = await getPlan((profile.plan_code as string | null) ?? null).catch(() => null);
  const planLabel = plan
    ? `Stayful ${plan.name} — ${formatGbp(plan.pricePence).replace('.00', '')} a ${plan.interval === 'year' ? 'year' : 'month'}, ${formatGbp(plan.monthlyCreditPence).replace('.00', '')} of credit every month`
    : null;
  const credit = await getCreditSummary(user.id).catch(() => null);

  // A subscription arranged by hand has no Stripe record we can drive, so it
  // gets a route to a human instead of buttons that would throw.
  const managedByUs =
    status === 'paid' && (!subscriptionId || profile.plan_source === 'manual');

  // Pause dates are computed here and passed down as finished strings. The
  // dialog is a client component, and formatting dates in the browser is how
  // you get a hydration mismatch.
  const pauseFrom = periodEnd ? new Date(periodEnd) : null;
  const pauseChoices = pauseFrom
    ? PAUSE_MONTHS.map((months) => ({
        months,
        until: formatPlanDate(addMonths(pauseFrom, months).toISOString()) ?? '',
      }))
    : [];

  const view: PlanView = {
    status,
    managedByUs,
    cancelScheduled,
    pauseScheduled,
    renewsOn: formatPlanDate(periodEnd),
    endsOn: formatPlanDate((profile.subscription_cancel_at as string | null) ?? periodEnd),
    pausesOn: formatPlanDate(profile.subscription_paused_from as string | null),
    pausedUntil: formatPlanDate(profile.subscription_paused_until as string | null),
    pauseFrom: formatPlanDate(periodEnd),
    pauseChoices,
    planLabel,
    checkoutHref: '/upgrade',
    contactHref: `mailto:${BRAND.contactEmail}?subject=${encodeURIComponent('Change my Stayful plan')}`,
  };

  const fullName = (profile.full_name as string | null)?.trim() || null;
  const memberSince = formatPlanDate(profile.created_at as string | null);
  const reportsTotal = Number(profile.reports_total ?? 0);
  const goals = parseMarketGoals((row as { market_goals?: unknown } | null)?.market_goals ?? null);

  return (
    <main className="min-h-screen bg-[#f7f8f4] text-[#2e3d2b]">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <AccountHeader name={fullName} email={user.email} memberSince={memberSince} />

        {resumeFailed && (
          <p className="mt-6 rounded-lg bg-[#fbeceb] px-3 py-2 text-sm text-[#b3261e]">
            We couldn&apos;t restart your plan just then. Try again below, or email{' '}
            <a href={`mailto:${BRAND.contactEmail}`} className="underline">{BRAND.contactEmail}</a>{' '}
            and we&apos;ll sort it out.
          </p>
        )}

        <ManagePlan view={view} topupRate={credit?.rates.topup} />

        <section className="mt-6 rounded-2xl border border-[#e4e7dc] bg-white p-5">
          <h2 className="text-base font-semibold">Credit and usage</h2>
          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-[#7a8274]">Credit balance</dt>
              <dd className="mt-0.5 text-lg font-semibold">
                {credit ? formatGbp(credit.totalPence) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[#7a8274]">Reports run</dt>
              <dd className="mt-0.5 text-lg font-semibold">{reportsTotal}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-[#7a8274]">
            Quick looks, Full analyses, daily deals and reports are charged to your credit.{' '}
            <Link href="/account/usage" className="underline">See where it goes</Link>, or{' '}
            <Link href="/account/billing" className="underline">top up, see every charge and manage billing</Link>.
            Reopening a saved report never costs anything.
          </p>
        </section>

        <NotificationsSection />
        <GoalsSection goals={goals} />
        <MoreSection keys={accountMoreLinks({ teamMember: false, teamOwnsFunnel })} storeUrl={storeUrl} />
        <SignOutForm />

        <p className="mt-8 text-xs text-[#7a8274]">
          Questions about billing? Email{' '}
          <a href={`mailto:${BRAND.contactEmail}`} className="underline">{BRAND.contactEmail}</a>.
        </p>
      </div>
    </main>
  );
}
