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
  /** Displayed balance (face pence). */
  balancePence: number;
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
  const balance = await getBalance(userId).catch(() => null);
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
    balancePence: balance ? balance.totalPence : 0,
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
