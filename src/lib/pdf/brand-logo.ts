import 'server-only';

import { withTimeout } from '../timeout';
import { LOGO_MAX_BYTES } from '../funnels/brand';
import { sniffImage, ALLOWED_LOGO_MIMES } from '../funnels/image';

/**
 * Fetches a customer's logo and turns it into a data URI for the PDF.
 *
 * react-pdf's `<Image>` will happily take a URL and fetch it itself during
 * render — with no timeout. One customer pointing at a slow or dead host
 * would then hang a report for everyone submitting to that funnel, so the
 * fetch happens here instead, bounded, and a failure simply means the
 * header falls back to the company name as text.
 *
 * PNG and JPEG only: those are the formats react-pdf's `<Image>` accepts,
 * which is also why parseLogoUrl refuses anything else.
 */

const FETCH_TIMEOUT_MS = 4_000;

// The sniffing lives in funnels/image.ts, shared with the upload path: one
// definition of "a logo we can use" rather than two that drift.

async function fetchLogo(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;

    const declared = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (declared && !ALLOWED_LOGO_MIMES.has(declared)) return null;

    // Length header first, then the real size — a lying header must not let
    // an arbitrarily large body through.
    const declaredLength = Number(res.headers.get('content-length') ?? 0);
    if (declaredLength > LOGO_MAX_BYTES) return null;

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > LOGO_MAX_BYTES) return null;

    const actual = sniffImage(buf);
    if (!actual) return null;

    return `data:${actual};base64,${Buffer.from(buf).toString('base64')}`;
  } catch {
    return null;
  }
}

/** Null when the logo cannot be used; callers fall back to the name. */
export async function logoDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url || !/^https:\/\//i.test(url)) return null;
  return withTimeout(fetchLogo(url), FETCH_TIMEOUT_MS, null);
}
