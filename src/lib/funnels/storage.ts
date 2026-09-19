import 'server-only';

import { randomBytes } from 'node:crypto';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { sniffImage, extensionFor, uploadRejectionReason } from './image.ts';
import { BRAND_BUCKET, logoStoragePath, ourStoragePath } from './asset-path.ts';

/**
 * Storing a customer's logo.
 *
 * Supabase Storage is used nowhere else in this codebase, so two things are
 * deliberate here.
 *
 * The bucket is a DASHBOARD step, which means the failure it produces
 * arrives at upload time rather than at deploy time — long after anyone is
 * looking for it. So "bucket not found" is detected specifically and turned
 * into a message that names the workaround, because the paste-a-URL field is
 * still sitting right there and still works.
 *
 * And the previous file is deleted on replace. Nothing else in this product
 * ever visits this bucket, so without that every re-upload leaves an orphan
 * that nobody will ever clean up.
 */

export interface UploadResult {
  ok: boolean;
  url?: string;
  error?: string;
}

const BUCKET_MISSING =
  'Logo storage is not set up on this deployment yet. Paste an https link to your logo instead, or ask us to finish the setup.';

/**
 * Supabase reports a missing bucket as a message rather than a typed code,
 * so this matches on the text. A false negative only costs a vaguer error,
 * which is why it is worth doing at all rather than not.
 */
function isBucketMissing(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('bucket not found') || m.includes('does not exist');
}

/**
 * Validates and stores a logo, returning its public URL.
 *
 * The checks run in this order on purpose: size before format, so someone
 * uploading a 40 MB PNG is told about the size rather than being sent away
 * to re-export a file that was already the right type.
 */
export async function uploadLogo(input: {
  userId: string;
  funnelId: string;
  bytes: Uint8Array;
}): Promise<UploadResult> {
  if (!hasServiceRole()) return { ok: false, error: BUCKET_MISSING };

  const refusal = uploadRejectionReason(input.bytes);
  if (refusal) return { ok: false, error: refusal };

  // Non-null after uploadRejectionReason passed, but read again rather than
  // assumed: the extension we store under has to follow the real format.
  const mime = sniffImage(input.bytes);
  if (!mime) return { ok: false, error: 'That file is not a PNG or JPEG.' };

  const path = logoStoragePath(input.userId, input.funnelId, randomBytes(8).toString('hex'), extensionFor(mime));

  const { error } = await createAdminClient()
    .storage.from(BRAND_BUCKET)
    .upload(path, input.bytes, { contentType: mime, upsert: false, cacheControl: '31536000' });

  if (error) {
    const message = error.message ?? '';
    if (isBucketMissing(message)) return { ok: false, error: BUCKET_MISSING };
    console.error('[funnels] logo upload failed:', message);
    return { ok: false, error: 'We could not store that logo just now. Please try again.' };
  }

  const { data } = createAdminClient().storage.from(BRAND_BUCKET).getPublicUrl(path);
  const url = data?.publicUrl;
  if (!url) {
    // Stored but unaddressable. Clean up rather than leave a file nothing
    // can reach.
    await deleteLogoByPath(path);
    return { ok: false, error: 'We could not store that logo just now. Please try again.' };
  }
  return { ok: true, url };
}

async function deleteLogoByPath(path: string): Promise<void> {
  if (!hasServiceRole()) return;
  const { error } = await createAdminClient().storage.from(BRAND_BUCKET).remove([path]);
  if (error) console.error('[funnels] logo delete failed:', error.message);
}

/**
 * Removes a logo we previously stored, if the URL is one of ours.
 *
 * Failure is logged and swallowed: an orphaned file is not worth failing a
 * save the customer has already been told succeeded, and the new logo is
 * what they care about.
 */
export async function deleteLogoIfOurs(url: string | null | undefined): Promise<void> {
  const path = ourStoragePath(url);
  if (!path) return;
  await deleteLogoByPath(path);
}
