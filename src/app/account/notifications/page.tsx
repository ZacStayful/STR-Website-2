import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { ALWAYS_SENT_NOTE, EMAIL_NOTIFICATION_TYPES, notificationState } from '@/lib/notifications/registry';
import { readNotifications } from '@/lib/notifications/server';
import { isSmsConfigured, isSmsDryRun } from '@/lib/sms/config';
import { ukMobile } from '@/lib/sms/phone';
import { DEFAULT_MONTHLY_CAP, getContact, smsMonthlyCap } from '@/lib/sms/store';
import { setNotificationAction } from './actions';
import { SmsSection } from './SmsSection';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Notifications — Stayful Intelligence',
  robots: { index: false, follow: false },
};

const ON = 'rounded-full bg-[#5d8156] px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-[#4c6b46]';
const OFF = 'rounded-full border border-[#e4e7dc] bg-white px-4 py-1.5 text-sm font-semibold text-[#7a8274] transition hover:bg-[#f1f3ec]';

/**
 * The one place a member changes which emails and texts they get. One row per type in
 * the registry (src/lib/notifications/registry.ts); each row is a form that
 * flips its switch. Reachable by team members too, whose plan and billing
 * pages redirect to the team page.
 */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/account/notifications');

  const state = (await readNotifications(user.id)) ?? notificationState(null);

  // Texts (Batch 8): the member's number and its state, read server-side.
  const admin = hasServiceRole() ? createAdminClient() : null;
  const [contact, monthlyCap, profile] = admin
    ? await Promise.all([
        getContact(admin, user.id),
        smsMonthlyCap(admin),
        admin.from('profiles').select('mobile').eq('id', user.id).maybeSingle().then((r) => r.data as { mobile: string | null } | null),
      ])
    : [null, DEFAULT_MONTHLY_CAP, null];

  return (
    <main className="min-h-screen bg-[#f7f8f4] text-[#2e3d2b]">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#5d8156]">
          <Link href="/account" className="hover:underline">Your account</Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold">Notifications</h1>
        <p className="mt-2 text-sm text-[#7a8274]">Which emails Stayful Intelligence sends to {user.email}. {ALWAYS_SENT_NOTE}</p>

        {msg === 'saved' && <p className="mt-6 rounded-lg bg-[#eef3ea] px-3 py-2 text-sm text-[#3f5c3a]">Saved.</p>}
        {msg === 'error' && <p className="mt-6 rounded-lg bg-[#fbeceb] px-3 py-2 text-sm text-[#b3261e]">That change did not save. Please try again.</p>}

        <section className="mt-6 rounded-2xl border border-[#e4e7dc] bg-white p-5">
          <ul className="divide-y divide-[#e4e7dc]">
            {EMAIL_NOTIFICATION_TYPES.map((t) => {
              const on = state[t.key];
              return (
                <li key={t.key} className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div>
                    <p className="font-semibold">{t.label}</p>
                    <p className="mt-0.5 text-sm text-[#7a8274]">{t.description}</p>
                  </div>
                  <form action={setNotificationAction} className="shrink-0">
                    <input type="hidden" name="key" value={t.key} />
                    <input type="hidden" name="on" value={on ? '0' : '1'} />
                    <button type="submit" role="switch" aria-checked={on} aria-label={`${t.label}: turn ${on ? 'off' : 'on'}`} className={on ? ON : OFF}>
                      {on ? 'On' : 'Off'}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>

        <SmsSection
          contact={contact}
          state={state}
          available={Boolean(admin) && (isSmsConfigured() || isSmsDryRun())}
          askedAtSignup={user.user_metadata?.sms_opt_in === true}
          suggestedPhone={ukMobile(profile?.mobile ?? null)}
          monthlyCap={monthlyCap}
        />

        <p className="mt-4 text-xs text-[#7a8274]">
          Press a switch to change it. {ALWAYS_SENT_NOTE} Your picks are at <Link href="/picks" className="underline">Daily picks</Link>; your filter is in the <Link href="/markets?goals=1" className="underline">Market Explorer</Link>.
        </p>
      </div>
    </main>
  );
}
