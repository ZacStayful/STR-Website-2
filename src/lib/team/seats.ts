import 'server-only';

import { randomUUID } from 'node:crypto';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { debitFace, InsufficientCreditError } from '../credit/ledger';
import { afterDebit } from '../credit/after-debit';
import { sendEmail } from '../email/send';
import { seatSuspendedEmail, seatRestoredEmail, type Email } from '../email/team';
import { SEAT_PRICE_PENCE, periodEnd } from './rules';
import { personName, profileNames, teamName } from './index';

/**
 * Charging for seats: a flat £10 of the owner's displayed credit per member,
 * for each 30-day period.
 *
 * The `team_seat_charges` row for (member, period) is inserted BEFORE the
 * debit. Its unique key is what makes a retried accept, a double-clicked
 * button or two overlapping cron runs charge a period once: the loser of the
 * race fails the insert and never reaches the ledger. If the debit then
 * fails, the row is removed again so a later attempt can pay it.
 */

export type SeatCharge = 'charged' | 'already_paid' | 'insufficient' | 'error';

export async function chargeSeat(input: { ownerId: string; memberId: string; memberName: string; periodStart: Date }): Promise<SeatCharge> {
  if (!hasServiceRole()) return 'error';
  const admin = createAdminClient();
  const periodStart = input.periodStart.toISOString();

  const { data: claim, error: claimErr } = await admin
    .from('team_seat_charges')
    .insert({ member_id: input.memberId, owner_id: input.ownerId, period_start: periodStart })
    .select('id')
    .single();
  if (claimErr) {
    if (claimErr.code === '23505') return 'already_paid';
    console.error('[team] seat claim failed:', claimErr.message);
    return 'error';
  }
  const claimId = (claim as { id: number }).id;

  try {
    const tx = await debitFace(input.ownerId, SEAT_PRICE_PENCE, {
      // A fresh action id per charge, so usage history shows each seat
      // period as its own line.
      action_id: randomUUID(),
      action: 'team_seat',
      description: `Team seat — ${input.memberName}`,
      member_id: input.memberId,
      period_start: periodStart,
    });
    await admin.from('team_seat_charges').update({ transaction_id: tx }).eq('id', claimId);
  } catch (err) {
    await admin.from('team_seat_charges').delete().eq('id', claimId);
    if (err instanceof InsufficientCreditError) return 'insufficient';
    console.error('[team] seat debit failed:', (err as Error).message);
    return 'error';
  }

  // Low-balance emails and auto top-up, exactly as for any other spend.
  // Awaited: a serverless function may be frozen the moment it returns.
  await afterDebit(input.ownerId);
  return 'charged';
}

async function send(to: string | null | undefined, email: Email): Promise<void> {
  if (!to) return;
  const r = await sendEmail({ to, subject: email.subject, html: email.html, text: email.text });
  if (!r.sent) console.warn('[team] email not sent:', r.reason);
}

interface SeatRow {
  member_id: string;
  owner_id: string;
  seat_paid_until: string;
  suspended_at: string | null;
}

export interface SeatRunSummary {
  renewed: number;
  suspended: number;
  reinstated: number;
  errors: string[];
}

/**
 * Renews every seat whose period has ended. One that cannot be paid is
 * suspended, and the owner and member are both told. A long-overdue seat
 * (the cron was down) renews one period per run until it is current.
 */
export async function renewDueSeats(opts: { dry?: boolean; now?: Date } = {}): Promise<SeatRunSummary> {
  const summary: SeatRunSummary = { renewed: 0, suspended: 0, reinstated: 0, errors: [] };
  if (!hasServiceRole()) return summary;
  const admin = createAdminClient();
  const now = opts.now ?? new Date();

  const { data, error } = await admin
    .from('team_members')
    .select('member_id, owner_id, seat_paid_until, suspended_at')
    .is('suspended_at', null)
    .lte('seat_paid_until', now.toISOString())
    .order('seat_paid_until', { ascending: true })
    .limit(200);
  if (error) {
    summary.errors.push(`renew read: ${error.message}`);
    return summary;
  }
  const rows = (data ?? []) as SeatRow[];
  if (opts.dry) {
    summary.renewed = rows.length;
    return summary;
  }

  const names = await profileNames([...new Set(rows.flatMap((r) => [r.member_id, r.owner_id]))]);
  for (const r of rows) {
    const memberName = personName(names.get(r.member_id));
    const periodStart = new Date(r.seat_paid_until);
    const outcome = await chargeSeat({ ownerId: r.owner_id, memberId: r.member_id, memberName, periodStart });
    if (outcome === 'charged' || outcome === 'already_paid') {
      await admin
        .from('team_members')
        .update({ seat_paid_until: periodEnd(periodStart).toISOString() })
        .eq('member_id', r.member_id)
        .eq('seat_paid_until', r.seat_paid_until);
      summary.renewed += 1;
    } else if (outcome === 'insufficient') {
      await admin.from('team_members').update({ suspended_at: now.toISOString() }).eq('member_id', r.member_id).is('suspended_at', null);
      summary.suspended += 1;
      const team = await teamName(r.owner_id);
      await send(names.get(r.owner_id)?.email, seatSuspendedEmail({ to: 'owner', memberName, teamName: team }));
      await send(names.get(r.member_id)?.email, seatSuspendedEmail({ to: 'member', memberName, teamName: team }));
    } else {
      summary.errors.push(`renew ${r.member_id}: ${outcome}`);
    }
  }
  return summary;
}

/**
 * Brings suspended seats back once the owner's balance covers them, starting
 * a fresh 30-day period from now. Called straight after a top-up lands, and
 * hourly as a fallback for credit that arrives any other way.
 */
export async function reinstateSeats(opts: { ownerId?: string; dry?: boolean; now?: Date } = {}): Promise<SeatRunSummary> {
  const summary: SeatRunSummary = { renewed: 0, suspended: 0, reinstated: 0, errors: [] };
  if (!hasServiceRole()) return summary;
  const admin = createAdminClient();
  const now = opts.now ?? new Date();

  let q = admin
    .from('team_members')
    .select('member_id, owner_id, seat_paid_until, suspended_at')
    .not('suspended_at', 'is', null)
    .order('suspended_at', { ascending: true })
    .limit(200);
  if (opts.ownerId) q = q.eq('owner_id', opts.ownerId);
  const { data, error } = await q;
  if (error) {
    summary.errors.push(`reinstate read: ${error.message}`);
    return summary;
  }
  const rows = (data ?? []) as SeatRow[];
  if (opts.dry) {
    summary.reinstated = rows.length;
    return summary;
  }

  const names = await profileNames([...new Set(rows.flatMap((r) => [r.member_id, r.owner_id]))]);
  // Once one of an owner's seats cannot be paid, the rest cannot either.
  const broke = new Set<string>();
  for (const r of rows) {
    if (broke.has(r.owner_id)) continue;
    const memberName = personName(names.get(r.member_id));
    const outcome = await chargeSeat({ ownerId: r.owner_id, memberId: r.member_id, memberName, periodStart: now });
    if (outcome === 'insufficient') {
      broke.add(r.owner_id);
      continue;
    }
    if (outcome !== 'charged' && outcome !== 'already_paid') {
      summary.errors.push(`reinstate ${r.member_id}: ${outcome}`);
      continue;
    }
    await admin
      .from('team_members')
      .update({ suspended_at: null, seat_paid_until: periodEnd(now).toISOString() })
      .eq('member_id', r.member_id);
    summary.reinstated += 1;
    const team = await teamName(r.owner_id);
    await send(names.get(r.owner_id)?.email, seatRestoredEmail({ to: 'owner', memberName, teamName: team }));
    await send(names.get(r.member_id)?.email, seatRestoredEmail({ to: 'member', memberName, teamName: team }));
  }
  return summary;
}
