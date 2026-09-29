import 'server-only';

import { randomBytes } from 'node:crypto';
import { createAdminClient } from '../supabase/admin';
import { BUCKET, SIGNED_URL_SECONDS } from './config';
import { screenshotExtension, type ScreenshotType } from './rules';

/**
 * The private bucket for screenshots (Batch 18; created by the Batch 18
 * section of supabase/schema.sql). Only the service role reads or writes it:
 * there is no public URL and no storage policy. An admin sees an image
 * through a signed link that stops working after SIGNED_URL_SECONDS; a
 * member never gets one, their own included.
 */

/**
 * Where an image is stored: under its report, with a random name. No member
 * id, name or anything the member typed, so a path gives nothing away.
 */
export function screenshotPath(reportId: string, index: number, type: ScreenshotType): string {
  return `${reportId}/${index}-${randomBytes(8).toString('hex')}.${screenshotExtension(type)}`;
}

function bucketMissing(message: string): boolean {
  return /bucket not found|does not exist/i.test(message);
}

export async function uploadScreenshot(path: string, bytes: Uint8Array, type: ScreenshotType): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await createAdminClient().storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false, cacheControl: String(SIGNED_URL_SECONDS) });
    if (!error) return { ok: true };
    const message = error.message ?? 'upload failed';
    if (bucketMissing(message)) console.error(`[feedback] the ${BUCKET} bucket is missing: run the Batch 18 section of supabase/schema.sql`);
    else console.error('[feedback] screenshot upload failed:', message);
    return { ok: false, error: message };
  } catch (err) {
    console.error('[feedback] screenshot upload failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'upload failed' };
  }
}

/** Links that work for SIGNED_URL_SECONDS, by path. Admin pages only. A path that cannot be signed is left out. */
export async function signedScreenshotUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  try {
    const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    if (error) {
      console.error('[feedback] could not sign screenshot links:', error.message);
      return out;
    }
    for (const row of data ?? []) {
      if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
    }
  } catch (err) {
    console.error('[feedback] could not sign screenshot links:', err);
  }
  return out;
}

/**
 * Removes images from the bucket. `ok` means every path is gone now (an
 * object that was already missing counts as gone); on an error nothing is
 * assumed removed, so the caller keeps its rows and tries again later.
 */
export async function removeScreenshots(paths: string[]): Promise<{ ok: boolean; error: string | null }> {
  if (paths.length === 0) return { ok: true, error: null };
  try {
    const { error } = await createAdminClient().storage.from(BUCKET).remove(paths);
    return error ? { ok: false, error: error.message } : { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'remove failed' };
  }
}
