/**
 * Where a customer's logo lives, and how to tell one of ours from anything
 * else.
 *
 * Pure and tested because `ourStoragePath` gates a DELETE. A customer can
 * paste any https URL into the logo field — including a link to an image on
 * their own website — and when they later replace it, the old value is
 * handed to the cleanup path. Getting this wrong in the permissive
 * direction means trying to delete something that was never ours.
 */

export const BRAND_BUCKET = 'brand-assets';

const PUBLIC_MARKER = `/storage/v1/object/public/${BRAND_BUCKET}/`;

/** `brand/<uuid>/<funnel>-<rand>.png` — the only shape we ever write. */
const OUR_LAYOUT = /^brand\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i;

/**
 * Builds the storage path for a new logo.
 *
 * The user id sits in the path so one customer's assets are distinguishable
 * from another's at a glance in the dashboard — which matters the first time
 * somebody asks whose logo a file is.
 */
export function logoStoragePath(userId: string, funnelId: string, random: string, extension: string): string {
  return `brand/${userId}/${funnelId}-${random}${extension}`;
}

/**
 * The path inside one of our public URLs, or null when the URL is not ours.
 *
 * Deliberately strict: the marker must be present, the remaining path must
 * match the exact layout we write, and anything with traversal or an
 * unexpected shape is refused rather than cleaned up and accepted.
 */
export function ourStoragePath(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  const at = url.indexOf(PUBLIC_MARKER);
  if (at === -1) return null;
  const path = url.slice(at + PUBLIC_MARKER.length).split('?')[0].split('#')[0];
  if (path.includes('..')) return null;
  return OUR_LAYOUT.test(path) ? path : null;
}
