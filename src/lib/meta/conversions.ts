import 'server-only';

/**
 * Conversions on the server (Batch 19): recording each of the five once,
 * sending it to Meta's Conversions API, and the browser's share (the pixel
 * fires the same event with the same id, so Meta keeps one).
 *
 *   recordConversion   awaited: for code already running after the response
 *                      (the analyser stream, the Full analysis run, the
 *                      Stripe webhook), where a late after() may never run
 *   logConversion      from a request (sign-in, the quiz, the one-click
 *                      top-up): reads the member's browser details now and
 *                      records after the response
 *   releaseHeld        an Accept: conversions recorded in the last hour
 *                      without consent are sent after all
 *   metaExclusion      admin, staff, switched off (Batch 9's "Exclude") or a
 *                      team seat: never any Meta event for them
 *   pendingForBrowser  the member's conversions the browser may still fire:
 *                      recorded (or released) with consent, from production,
 *                      under a day old, not fired yet
 *   claimForBrowser    one of them, claimed atomically: two tabs, a reload or
 *                      a double tap never fire it twice
 *
 * Once only: each conversion has one key (meta_conversions.dedupe_key) and is
 * inserted before anything is sent; only the caller whose insert went in may
 * send, and the send itself is claimed (pending -> sending). So a Stripe
 * redelivery, the webhook and the one-click route, both top-up events, a
 * double tap or a retry never send twice.
 *
 * Nothing here throws: a failure is a warning, never a failed request,
 * sign-up or webhook.
 */
import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { headers } from 'next/headers';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { adminEmails } from '../admin';
import { emailKey } from '../supabase/email-key';
import { exclusionFor } from '../activity/metrics';
import { isTeamBound } from '../team';
import { siteUrl } from '../url';
import { TRACKING } from '../tracking/config';
import { memberConsentFor } from '../tracking/consent-server';
import { parseBrowserConversion, type BrowserConversion } from '../tracking/me';
import { clientDetails } from '../tracking/request';
import { buildCapiEvent, sendCapi, type ClientDetails } from './capi';
import { deployment, metaDryRun, serverSendMode } from './env';
import { dedupeKeyFor, eventSourceUrl, isMetaEvent, isPostLaunch, purchaseFromTopup, subscribeFromInvoice, type InvoiceFacts, type MetaEventName, type TopupFacts } from './events';
import { buildFbc } from './fbc';
import { hashEmail, hashExternalId } from './hash';

export interface ConversionInput {
  name: MetaEventName;
  userId: string;
  /** Subscribe: the Stripe invoice id; Purchase: the PaymentIntent id. The others get a fresh id. */
  eventId?: string | null;
  /** Purchase: its once-only key. */
  paymentIntentId?: string | null;
  /** Subscribe: the paid invoice (only the first paid one of a subscription started after tracking began counts). */
  invoice?: InvoiceFacts;
  /** Purchase: the top-up (never an automatic one). */
  topup?: TopupFacts;
  /** The member's own browser, when it happens in their request (never Stripe's). */
  details?: ClientDetails | null;
}

export type MetaExclusion = 'admin' | 'staff' | 'manual' | 'team' | 'unknown';

function warn(message: string): void {
  console.warn('[meta]', message);
}

/**
 * Why this account never sends Meta anything, or null when it may. When the
 * check itself fails, the answer is 'unknown': nothing is sent.
 */
export async function metaExclusion(userId: string, email: string | null): Promise<MetaExclusion | null> {
  const quick = exclusionFor(email, undefined, new Set(adminEmails().map(emailKey)));
  if (quick) return quick;
  if (!hasServiceRole()) return 'unknown';
  try {
    const { data, error } = await createAdminClient().from('activity_excluded_accounts').select('user_id').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return 'manual';
    return (await isTeamBound(userId, email)) ? 'team' : null;
  } catch (err) {
    warn(`exclusion not checked: ${err instanceof Error ? err.message : String(err)}`);
    return 'unknown';
  }
}

const BROWSER_COLUMNS = 'dedupe_key, event_id, event_name, value_pence';

type BrowserRow = { dedupe_key: string; event_id: string; event_name: string; value_pence: number | null };

function toBrowser(r: BrowserRow): BrowserConversion | null {
  return parseBrowserConversion({ key: r.dedupe_key, name: r.event_name, eventId: r.event_id, valuePence: r.value_pence });
}

/** A day back: older conversions are no longer fired from the browser (Meta only matches the two copies within 48 hours). */
function browserSince(now: Date): string {
  return new Date(now.getTime() - TRACKING.browserWindowHours * 3_600_000).toISOString();
}

export async function pendingForBrowser(userId: string, now: Date = new Date()): Promise<BrowserConversion[]> {
  if (!hasServiceRole()) return [];
  try {
    const since = browserSince(now);
    const { data, error } = await createAdminClient()
      .from('meta_conversions')
      .select(BROWSER_COLUMNS)
      .eq('user_id', userId)
      .eq('env', 'production')
      .eq('consented', true)
      .is('browser_claimed_at', null)
      .or(`created_at.gt.${since},released_at.gt.${since}`)
      .order('created_at', { ascending: true })
      .limit(10);
    if (error) throw new Error(error.message);
    return ((data ?? []) as BrowserRow[]).map(toBrowser).filter((c): c is BrowserConversion => c !== null);
  } catch (err) {
    warn(`pending conversions not read: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Claim one conversion for the browser: only the first claim gets it back
 * (the update only matches while nobody has claimed it).
 */
export async function claimForBrowser(userId: string, key: string, now: Date = new Date()): Promise<BrowserConversion | null> {
  if (!hasServiceRole() || !key || key.length > 200) return null;
  try {
    const { data, error } = await createAdminClient()
      .from('meta_conversions')
      .update({ browser_claimed_at: now.toISOString() })
      .eq('dedupe_key', key)
      .eq('user_id', userId)
      .eq('env', 'production')
      .eq('consented', true)
      .is('browser_claimed_at', null)
      .or(`created_at.gt.${browserSince(now)},released_at.gt.${browserSince(now)}`)
      .select(BROWSER_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toBrowser(data as BrowserRow) : null;
  } catch (err) {
    warn(`conversion not claimed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Recording and sending ──

// When tracking began (billing_settings.meta_tracking_since, set once by the
// schema section). It never changes, so one read per server instance.
let trackingSinceCache: Date | null = null;

async function trackingSince(): Promise<Date | null> {
  if (trackingSinceCache) return trackingSinceCache;
  const { data, error } = await createAdminClient().from('billing_settings').select('value').eq('key', 'meta_tracking_since').maybeSingle();
  if (error) throw new Error(error.message);
  const raw = (data as { value?: unknown } | null)?.value;
  const at = typeof raw === 'string' ? new Date(raw) : null;
  if (at && Number.isFinite(at.getTime())) trackingSinceCache = at;
  return trackingSinceCache;
}

type ConversionRow = { dedupe_key: string; event_id: string; event_name: string; user_id: string; value_pence: number | null; created_at: string };

async function setStatus(key: string, from: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await createAdminClient().from('meta_conversions').update(patch).eq('dedupe_key', key).eq('server_status', from);
  if (error) throw new Error(error.message);
}

/**
 * Send one recorded, consented conversion to the Conversions API, if this
 * deployment may. Claimed first, so it is only ever sent once.
 */
async function sendServer(key: string, details: ClientDetails | null): Promise<void> {
  const mode = serverSendMode();
  if (!mode.ok) {
    await setStatus(key, 'pending', { server_status: 'skipped', server_note: mode.reason });
    return;
  }
  const admin = createAdminClient();
  const { data: claimed, error: claimErr } = await admin
    .from('meta_conversions')
    .update({ server_status: 'sending' })
    .eq('dedupe_key', key)
    .eq('server_status', 'pending')
    .eq('env', deployment())
    .select('dedupe_key, event_id, event_name, user_id, value_pence, created_at')
    .maybeSingle();
  if (claimErr) throw new Error(claimErr.message);
  const row = claimed as ConversionRow | null;
  if (!row || !isMetaEvent(row.event_name)) return;

  const [{ data: profile }, consent, { data: attribution }] = await Promise.all([
    admin.from('profiles').select('email').eq('id', row.user_id).maybeSingle(),
    memberConsentFor(row.user_id),
    admin.from('member_attribution').select('fbclid, fbclid_at').eq('user_id', row.user_id).maybeSingle(),
  ]);
  if (consent?.choice !== 'accept') {
    await setStatus(key, 'sending', { server_status: 'skipped', server_note: 'no_consent' });
    return;
  }
  // The member's own request when there is one, else their last-seen browser.
  const stored = consent.context;
  const client: ClientDetails = details?.userAgent ? details : stored;
  const click = attribution as { fbclid: string | null; fbclid_at: string | null } | null;
  const fbc = client.fbc ?? stored.fbc ?? (click?.fbclid ? buildFbc(click.fbclid, new Date(click.fbclid_at ?? row.created_at).getTime()) : null);
  const built = buildCapiEvent({
    event: row.event_name,
    eventId: row.event_id,
    eventTime: new Date(row.created_at),
    sourceUrl: eventSourceUrl(row.event_name, siteUrl()),
    emailHash: hashEmail((profile as { email?: string | null } | null)?.email ?? null),
    externalIdHash: hashExternalId(row.user_id),
    client: { ip: client.ip ?? null, userAgent: client.userAgent ?? null, fbp: client.fbp ?? stored.fbp ?? null, fbc },
    valuePence: row.value_pence,
  });
  if (!built.ok) {
    await setStatus(key, 'sending', { server_status: 'skipped', server_note: built.reason });
    return;
  }
  const result = await sendCapi({ pixelId: mode.pixelId, token: mode.token, testCode: mode.testCode, events: [built.event], dryRun: metaDryRun(), timeoutMs: TRACKING.capiTimeoutMs });
  await setStatus(key, 'sending', {
    server_status: result.ok ? 'sent' : 'failed',
    server_note: result.note,
    server_http: result.status,
    server_sent_at: result.ok ? new Date().toISOString() : null,
    test_event: mode.testCode !== null,
  });
}

/**
 * Record a conversion once and, with consent, send it. Awaited; never throws.
 * Without consent it is held: an Accept within the hour sends it after all.
 */
export async function recordConversion(input: ConversionInput): Promise<void> {
  try {
    if (!hasServiceRole() || !isMetaEvent(input.name) || !input.userId) return;
    const key = dedupeKeyFor(input.name, { userId: input.userId, paymentIntentId: input.paymentIntentId ?? null });
    if (!key) return;
    const since = await trackingSince();
    if (!since) return; // the Batch 19 schema section has not been run
    const admin = createAdminClient();
    const { data: existing } = await admin.from('meta_conversions').select('dedupe_key').eq('dedupe_key', key).maybeSingle();
    if (existing) return; // already recorded: the usual case for every report after the first

    const { data: p } = await admin.from('profiles').select('email, created_at, lead_source').eq('id', input.userId).maybeSingle();
    const profile = p as { email: string | null; created_at: string | null; lead_source: unknown } | null;
    if (!profile) return;

    let valuePence: number | null = null;
    if (input.name === 'Subscribe') {
      const v = input.invoice ? subscribeFromInvoice(input.invoice, since) : null;
      if (!v) return;
      valuePence = v.valuePence;
    } else if (input.name === 'Purchase') {
      const v = input.topup ? purchaseFromTopup(input.topup) : null;
      if (!v) return;
      valuePence = v.valuePence;
    } else if (!isPostLaunch(profile.created_at, since)) {
      return; // sign-up journey events only count for accounts made after tracking began
    }
    // Lead-form accounts: their sign-up is reported by the lead workflow (n8n).
    if (input.name === 'CompleteRegistration' && profile.lead_source) return;
    if (await metaExclusion(input.userId, profile.email ?? null)) return;

    const consented = (await memberConsentFor(input.userId))?.choice === 'accept';
    const { data: inserted, error } = await admin
      .from('meta_conversions')
      .upsert(
        {
          dedupe_key: key,
          event_id: input.eventId || randomUUID(),
          event_name: input.name,
          user_id: input.userId,
          env: deployment(),
          value_pence: valuePence,
          currency: valuePence === null ? null : 'GBP',
          consented,
          server_status: consented ? 'pending' : 'held',
        },
        { onConflict: 'dedupe_key', ignoreDuplicates: true },
      )
      .select('dedupe_key');
    if (error) throw new Error(error.message);
    if (!inserted || inserted.length === 0) return; // someone else recorded it first, and sends it
    if (consented) await sendServer(key, input.details ?? null);
  } catch (err) {
    warn(`${input.name} not recorded: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * From a request (a server action or route handler): the member's browser
 * details are read now, the rest runs after the response.
 */
export async function logConversion(input: ConversionInput): Promise<void> {
  let details = input.details ?? null;
  if (!details) {
    try {
      details = clientDetails(await headers());
    } catch {
      details = null;
    }
  }
  after(() => recordConversion({ ...input, details }));
}

/**
 * An Accept (the banner, Cookie settings or the sign-up checkbox): the
 * member's conversions recorded in the last hour without consent are sent
 * after all. Older ones never are.
 */
export async function releaseHeld(userId: string, details: ClientDetails | null, now: Date = new Date()): Promise<void> {
  if (!hasServiceRole()) return;
  try {
    const since = new Date(now.getTime() - TRACKING.releaseMinutes * 60_000).toISOString();
    const { data, error } = await createAdminClient()
      .from('meta_conversions')
      .update({ consented: true, released_at: now.toISOString(), server_status: 'pending' })
      .eq('user_id', userId)
      .eq('server_status', 'held')
      .gt('created_at', since)
      .select('dedupe_key');
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ dedupe_key: string }>) await sendServer(r.dedupe_key, details);
  } catch (err) {
    warn(`held conversions not released: ${err instanceof Error ? err.message : String(err)}`);
  }
}
