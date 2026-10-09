import 'server-only';

/**
 * Batch 23: what the calls need to know about a member, in one read. Batch
 * 22's call choice (profiles.si_calls, consent.ts) and Batch 8's verified
 * number (sms_contacts) are read here, never redefined.
 */
import { createAdminClient } from '../supabase/admin';
import { getContact } from '../sms/store';
import { isUkMobile } from '../sms/phone';
import { teamOf } from '../team';
import { getBalance } from '../credit/ledger';
import { isManagementOnly } from '../management/stamp-server';
import { callablePence, maxSpendRate } from './charge';

export interface MemberFacts {
  userId: string;
  isOwner: boolean;
  callsOn: boolean;
  /** Verified, not stopped, a UK mobile. */
  numberOk: boolean;
  phone: string | null;
  autoTopupOn: boolean;
  joinedAt: Date;
  firstName: string | null;
  email: string | null;
  /** The credit a call may take (face pence): the displayed balance less what open reservations hold (R2-13, charge.ts callablePence). */
  balancePence: number;
  /** Batch 22f: a management company without deal-finding (no intro or low-credit call). */
  managementOnly: boolean;
}

/** First name from full_name: the first word, unless it is a single letter (the rule the daily notices use). */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  return first.length > 1 ? first : null;
}

export async function memberFacts(userId: string): Promise<MemberFacts | null> {
  const admin = createAdminClient();
  const [{ data: p, error }, contact, team] = await Promise.all([
    admin.from('profiles').select('si_calls, auto_topup_amount_pence, created_at, full_name, email').eq('id', userId).maybeSingle(),
    getContact(admin, userId).catch(() => null),
    teamOf(userId),
  ]);
  if (error || !p) {
    if (error) console.error('[voice] member read failed (schema behind?):', error.message);
    return null;
  }
  const row = p as { si_calls?: boolean; auto_topup_amount_pence: number | null; created_at: string; full_name: string | null; email: string | null };
  const phone = contact?.phone_e164 ?? null;
  const [balance, managementOnly] = await Promise.all([getBalance(userId).catch(() => null), isManagementOnly(userId).catch(() => false)]);
  return {
    userId,
    isOwner: team.role === 'owner',
    callsOn: row.si_calls === true,
    numberOk: Boolean(contact?.verified_at && !contact.stopped_at && isUkMobile(phone)),
    phone,
    autoTopupOn: row.auto_topup_amount_pence != null && Number(row.auto_topup_amount_pence) > 0,
    joinedAt: new Date(row.created_at),
    firstName: firstNameOf(row.full_name),
    email: row.email,
    balancePence: balance ? callablePence(balance, maxSpendRate(balance.rates)) : 0,
    managementOnly,
  };
}

/** The account whose verified, not-stopped mobile this is (a recognised caller), or null. */
export async function memberByNumber(phone: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from('sms_contacts').select('user_id').eq('phone_e164', phone).not('verified_at', 'is', null).is('stopped_at', null).limit(1);
  if (error) {
    console.error('[voice] caller lookup failed:', error.message);
    return null;
  }
  return ((data ?? [])[0] as { user_id: string } | undefined)?.user_id ?? null;
}
