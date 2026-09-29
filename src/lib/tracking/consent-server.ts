import 'server-only';

/**
 * Cookie consent on the server: the proof of every choice (consent_records),
 * each member's latest choice (member_consent, the newer one always wins, in
 * SQL), and the essential cookie on the device.
 *
 *   recordChoice        a choice made on the banner, in Cookie settings or at
 *                       sign-up: its proof, and the member's saved choice
 *   attachDevice        at sign-up, sign-in and page loads: a choice made on
 *                       this device while signed out (or by this member)
 *                       becomes the member's when it is newer; never another
 *                       person's choice on a shared device
 *   memberConsentFor    the member's saved choice (for 6 months, then they are
 *                       asked again), and their last-seen browser details
 *                       (kept only while it is Accept)
 *   refreshBrowserDetails  at most hourly, for consenting members only
 *
 * The cookie helpers only work in a route handler or a server action (the
 * only places Next.js lets a cookie be written).
 *
 * Nothing here throws, and nothing counts towards weekly active: a signed-in
 * member's choice is logged as the record-only kind cookie_choice.
 */
import { cookies } from 'next/headers';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { logActivity } from '../activity/log';
import { deployment } from '../meta/env';
import { registrableDomain } from '../meta/fbc';
import type { ClientDetails } from '../meta/capi';
import { TRACKING } from './config';
import { consentMaxAgeSeconds, deviceChoiceAdoptable, memberChoiceCurrent, parseConsent, serializeConsent, type Choice, type ConsentSource, type DeviceConsent, type MemberConsent } from './consent';

// One warning a minute per message, so a missing table (schema not run) does
// not fill the logs.
const warnedAt = new Map<string, number>();
function warn(message: string): void {
  const now = Date.now();
  if (now - (warnedAt.get(message) ?? 0) < 60_000) return;
  warnedAt.set(message, now);
  console.warn('[consent]', message);
}

/** This device's choice, from its cookie. */
export async function deviceConsent(): Promise<DeviceConsent | null> {
  try {
    return parseConsent((await cookies()).get(TRACKING.consentCookie)?.value);
  } catch {
    return null;
  }
}

export function consentCookieOptions() {
  return { maxAge: consentMaxAgeSeconds(), path: '/', sameSite: 'lax' as const, secure: deployment() !== 'development', httpOnly: false };
}

/** Write the essential consent cookie (route handler or server action only). */
export async function setDeviceConsent(c: DeviceConsent): Promise<void> {
  try {
    (await cookies()).set(TRACKING.consentCookie, serializeConsent(c), consentCookieOptions());
  } catch (err) {
    warn(`cookie not written: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * On Reject: the httpOnly attribution cookie and our _fbc go. _fbp and any
 * _fbc the pixel set are also cleared in the browser (it can see them all).
 */
export async function clearTrackingCookies(host: string | null): Promise<void> {
  try {
    const jar = await cookies();
    jar.delete(TRACKING.attributionCookie);
    jar.delete(TRACKING.fbcCookie);
    const domain = host ? registrableDomain(host.split(':')[0]) : null;
    if (domain) jar.set(TRACKING.fbcCookie, '', { maxAge: 0, path: '/', domain });
  } catch (err) {
    warn(`cookies not cleared: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type Row = { id: string; choice: Choice; source: ConsentSource; created_at: string; user_id: string | null };

async function latestForDevice(visitorId: string): Promise<Row | null> {
  const { data, error } = await createAdminClient()
    .from('consent_records')
    .select('id, choice, source, created_at, user_id')
    .eq('visitor_id', visitorId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as Row | undefined) ?? null;
}

async function setMember(userId: string, c: { choice: Choice; at: Date; source: ConsentSource; version: string; recordId: string | null }): Promise<MemberConsent | null> {
  const { data, error } = await createAdminClient().rpc('member_consent_set', {
    p: { user: userId, choice: c.choice, chosen_at: c.at.toISOString(), source: c.source, version: c.version, record_id: c.recordId },
  });
  if (error) throw new Error(error.message);
  const r = data as { choice: Choice | null; chosen_at: string | null } | null;
  return r?.choice && r.chosen_at ? { choice: r.choice, chosenAt: new Date(r.chosen_at) } : null;
}

/**
 * A choice: its proof, and (signed in) the member's saved choice, which a
 * newer choice already saved elsewhere outranks. The same choice from the
 * same device within a minute is one record, not two.
 */
export async function recordChoice(input: { visitorId: string; userId: string | null; choice: Choice; source: ConsentSource; at: Date }): Promise<{ recordId: string | null; member: MemberConsent | null }> {
  if (!hasServiceRole()) return { recordId: null, member: null };
  try {
    const admin = createAdminClient();
    let recordId: string | null = null;
    const last = await latestForDevice(input.visitorId);
    if (
      last &&
      last.choice === input.choice &&
      last.source === input.source &&
      (last.user_id ?? null) === input.userId &&
      input.at.getTime() - new Date(last.created_at).getTime() < TRACKING.repeatChoiceSeconds * 1000
    ) {
      recordId = last.id;
    } else {
      const { data, error } = await admin
        .from('consent_records')
        .insert({ visitor_id: input.visitorId, user_id: input.userId, choice: input.choice, source: input.source, version: TRACKING.consentVersion, created_at: input.at.toISOString() })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      recordId = (data as { id: string }).id;
    }
    let member: MemberConsent | null = null;
    if (input.userId) {
      member = await setMember(input.userId, { choice: input.choice, at: input.at, source: input.source, version: TRACKING.consentVersion, recordId });
      logActivity(input.userId, 'cookie_choice', { extras: { choice: input.choice, source: input.source } });
    }
    return { recordId, member };
  } catch (err) {
    warn(`choice not recorded: ${err instanceof Error ? err.message : String(err)}`);
    return { recordId: null, member: null };
  }
}

/**
 * A choice made on this device becomes the member's: only one made here while
 * signed out (the landing page before signing up) or by this same member, and
 * only when it is newer than their own saved choice (deviceChoiceAdoptable).
 * Its time is the server's record of it, never the device's clock. Returns the
 * member's choice afterwards, and whether this device's choice was adopted.
 */
export async function attachDevice(userId: string, device: DeviceConsent | null): Promise<(MemberConsent & { adopted: boolean }) | null> {
  if (!hasServiceRole()) return null;
  try {
    const current = await memberChoiceOnly(userId);
    const kept = current ? { ...current, adopted: false } : null;
    if (!device) return kept;
    const last = await latestForDevice(device.visitorId);
    const record = last ? { userId: last.user_id, at: new Date(last.created_at) } : null;
    if (!last || !record || !deviceChoiceAdoptable(record, userId, current)) return kept;
    // The choice's proof becomes the member's too.
    if (last.user_id === null) await createAdminClient().from('consent_records').update({ user_id: userId }).eq('id', last.id).is('user_id', null);
    const saved = await setMember(userId, { choice: last.choice, at: record.at, source: last.source, version: device.version, recordId: last.id });
    return saved ? { ...saved, adopted: saved.choice === last.choice } : kept;
  } catch (err) {
    warn(`device choice not attached: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface MemberConsentRow extends MemberConsent {
  context: ClientDetails & { at: Date | null };
}

async function memberChoiceOnly(userId: string): Promise<MemberConsent | null> {
  const row = await memberConsentFor(userId);
  return row ? { choice: row.choice, chosenAt: row.chosenAt } : null;
}

/** The member's saved choice and last-seen browser details, or null (none, or older than 6 months). */
export async function memberConsentFor(userId: string, now: Date = new Date()): Promise<MemberConsentRow | null> {
  if (!hasServiceRole()) return null;
  try {
    const { data, error } = await createAdminClient()
      .from('member_consent')
      .select('choice, chosen_at, ctx_ip, ctx_ua, ctx_fbp, ctx_fbc, ctx_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const r = data as { choice: Choice; chosen_at: string; ctx_ip: string | null; ctx_ua: string | null; ctx_fbp: string | null; ctx_fbc: string | null; ctx_at: string | null };
    if (!memberChoiceCurrent(new Date(r.chosen_at), now)) return null;
    return {
      choice: r.choice,
      chosenAt: new Date(r.chosen_at),
      context: { ip: r.ctx_ip, userAgent: r.ctx_ua, fbp: r.ctx_fbp, fbc: r.ctx_fbc, at: r.ctx_at ? new Date(r.ctx_at) : null },
    };
  } catch (err) {
    warn(`member choice not read: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Keep a consenting member's last-seen browser details, for a conversion that
 * happens with no browser in the request (a Stripe payment). At most once an
 * hour, and only while their saved choice is Accept (a Reject clears them).
 */
export async function refreshBrowserDetails(userId: string, details: ClientDetails, now: Date = new Date()): Promise<void> {
  if (!hasServiceRole() || !details.userAgent) return;
  try {
    const stale = new Date(now.getTime() - TRACKING.contextRefreshMinutes * 60_000).toISOString();
    const { error } = await createAdminClient()
      .from('member_consent')
      .update({ ctx_ip: details.ip ?? null, ctx_ua: details.userAgent, ctx_fbp: details.fbp ?? null, ctx_fbc: details.fbc ?? null, ctx_at: now.toISOString() })
      .eq('user_id', userId)
      .eq('choice', 'accept')
      .or(`ctx_at.is.null,ctx_at.lt.${stale}`);
    if (error) throw new Error(error.message);
  } catch (err) {
    warn(`browser details not kept: ${err instanceof Error ? err.message : String(err)}`);
  }
}
