import { LOGO_MAX_BYTES } from './brand.ts';

/**
 * Deciding whether a file really is a logo we can use.
 *
 * PNG and JPEG only — those are the two formats that render on BOTH surfaces
 * a funnel has to satisfy: an `<img>` on the branded page, and react-pdf's
 * `<Image>` in the report. That pair is why SVG and PDF are refused despite
 * one of them working in a browser.
 *
 * The check is on magic bytes, never on the filename. An extension is a
 * claim, not evidence, and it matters more on an upload than on a fetch: a
 * fetched URL was at least chosen deliberately, whereas an upload is
 * whatever happened to be on someone's disk. A file that is not really a PNG
 * renders on neither surface, so catching it at the door is the difference
 * between one clear message now and a customer wondering why their logo is
 * missing from a report a prospect already has.
 *
 * Pure, so both the upload path and the PDF fetch can share exactly one
 * definition of "usable" rather than drifting apart.
 */

export type LogoMime = 'image/png' | 'image/jpeg';

export const ALLOWED_LOGO_MIMES: ReadonlySet<string> = new Set<LogoMime>(['image/png', 'image/jpeg']);

/**
 * Reads the format from the first few bytes.
 *
 * PNG's signature is 8 bytes; the four checked here are the distinctive
 * ones. JPEG starts FF D8 FF for every variant — JFIF, Exif and the rest.
 */
export function sniffImage(bytes: Uint8Array): LogoMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

/** The extension to store under — from the SNIFFED type, never the upload's name. */
export function extensionFor(mime: LogoMime): '.png' | '.jpg' {
  return mime === 'image/png' ? '.png' : '.jpg';
}

/**
 * What a rejected upload was, when we can tell — so the message can say
 * "a PDF cannot be used" rather than "that file could not be used".
 * Recognising a format we refuse is worth more than recognising none.
 */
function describeRejected(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'a PDF';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'a GIF';
  }
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'a WebP';
  }
  // An SVG is XML, so it starts with '<' possibly after whitespace.
  const head = new TextDecoder().decode(bytes.slice(0, 64)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'an SVG';
  return null;
}

/**
 * Why an upload was refused, in words a customer can act on — or null when
 * it is fine. Mirrors the tone of `logoRejectionReason` in brand.ts, which
 * does the same job for a pasted URL.
 */
export function uploadRejectionReason(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0) return 'That file is empty.';
  if (bytes.byteLength > LOGO_MAX_BYTES) {
    return `That file is ${formatSize(bytes.byteLength)}. Logos have to be under ${formatSize(LOGO_MAX_BYTES)} — try exporting it smaller.`;
  }
  if (sniffImage(bytes)) return null;

  const what = describeRejected(bytes);
  if (what === 'a PDF') {
    return 'A PDF cannot be used as a logo — it will not display on the page or in the report. Please use a PNG or JPEG.';
  }
  if (what === 'an SVG') {
    return 'SVG logos do not render in the PDF report. Please use a PNG or JPEG.';
  }
  if (what) {
    return `That is ${what}, which will not render in the PDF report. Please use a PNG or JPEG.`;
  }
  // Includes the case that catches people out: a file RENAMED to .png.
  return 'That file is not a PNG or JPEG. Renaming a file does not change its format — please export it as a PNG or JPEG.';
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
