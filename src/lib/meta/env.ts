/**
 * Meta's settings, read from the environment in one place.
 *
 *   NEXT_PUBLIC_META_PIXEL_ID  the dataset (pixel) id, digits only. Without it:
 *                              no banner, no pixel, no server events.
 *   META_CAPI_ACCESS_TOKEN     the Conversions API token, server only, never
 *                              logged. Without it: no server events; the
 *                              browser still sends all five conversions.
 *   META_TEST_EVENT_CODE       while testing: every server event carries it,
 *                              so it shows in Events Manager → Test events
 *                              and not in live reporting.
 *   META_DRY_RUN=true          log what would be sent instead of sending it.
 *   VERCEL_ENV                 set by Vercel. Only production loads the pixel
 *                              or sends live server events.
 *
 * Nothing here throws: a missing or malformed variable reads as "not set".
 * Pure: no network, no database, no server-only (the env is passed in, so it
 * is tested without touching process.env).
 */

export type Deployment = 'production' | 'preview' | 'development';

type Env = Record<string, string | undefined>;

const read = (env: Env, name: string): string | null => {
  const v = env[name]?.trim();
  return v ? v : null;
};

/** production | preview | development — the same rule as the activity log (src/lib/activity/log.ts). */
export function deployment(env: Env = process.env): Deployment {
  const v = env.VERCEL_ENV;
  if (v === 'production' || v === 'preview' || v === 'development') return v;
  return env.NODE_ENV === 'production' ? 'production' : 'development';
}

/** The dataset id, or null when it is missing or not digits only. */
export function metaPixelId(env: Env = process.env): string | null {
  const v = read(env, 'NEXT_PUBLIC_META_PIXEL_ID');
  return v && /^\d{5,20}$/.test(v) ? v : null;
}

/** The Conversions API token, or null. Never log it. */
export function capiToken(env: Env = process.env): string | null {
  return read(env, 'META_CAPI_ACCESS_TOKEN');
}

/** The test event code, or null (only letters and digits are accepted). */
export function testEventCode(env: Env = process.env): string | null {
  const v = read(env, 'META_TEST_EVENT_CODE');
  return v && /^[A-Za-z0-9_-]{2,64}$/.test(v) ? v : null;
}

export function metaDryRun(env: Env = process.env): boolean {
  return env.META_DRY_RUN === 'true';
}

/** The banner shows wherever there is a dataset to ask about. */
export function bannerEnabled(env: Env = process.env): boolean {
  return metaPixelId(env) !== null;
}

/** The browser pixel loads only on production, never on a preview or a local build. */
export function pixelEnabled(env: Env = process.env): boolean {
  return metaPixelId(env) !== null && deployment(env) === 'production';
}

export type ServerSendMode =
  | { ok: true; pixelId: string; token: string; testCode: string | null }
  | { ok: false; reason: 'no_dataset' | 'no_token' | 'not_production' };

/**
 * Whether this deployment may send Conversions API events, and how. Live
 * events only from production; anywhere else only test events, and only when
 * META_TEST_EVENT_CODE is set (then every event carries it).
 */
export function serverSendMode(env: Env = process.env): ServerSendMode {
  const pixelId = metaPixelId(env);
  if (!pixelId) return { ok: false, reason: 'no_dataset' };
  const token = capiToken(env);
  if (!token) return { ok: false, reason: 'no_token' };
  const testCode = testEventCode(env);
  if (deployment(env) !== 'production' && !testCode) return { ok: false, reason: 'not_production' };
  return { ok: true, pixelId, token, testCode };
}

/** For the admin status box: yes/no only, never a value. */
export function metaStatus(env: Env = process.env) {
  const send = serverSendMode(env);
  return {
    pixelIdSet: read(env, 'NEXT_PUBLIC_META_PIXEL_ID') !== null,
    pixelIdValid: metaPixelId(env) !== null,
    tokenSet: capiToken(env) !== null,
    testMode: testEventCode(env) !== null,
    dryRun: metaDryRun(env),
    deployment: deployment(env),
    pixelLoads: pixelEnabled(env),
    serverSends: send.ok,
    serverReason: send.ok ? null : send.reason,
  };
}
