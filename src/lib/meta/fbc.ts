/**
 * Meta's click and browser ids, in the formats Meta documents:
 *
 *   _fbc  fb.<subdomain index>.<creation time, ms>.<fbclid>   (the ad click)
 *   _fbp  fb.<subdomain index>.<creation time, ms>.<random>   (the browser)
 *
 * We build _fbc ourselves from a landing's fbclid, only after Accept (the
 * address is tidied before the pixel loads, so it never sees the fbclid).
 * Neither is ever hashed. Pure: no network, no database, no server-only.
 */

/** A Meta click id as it appears in a link: letters, digits, - and _ only. */
export function cleanFbclid(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 && v.length <= 500 && /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

/** fb.1.<ms>.<fbclid>, or null when either part is unusable. */
export function buildFbc(fbclid: string | null | undefined, atMs: number): string | null {
  const id = cleanFbclid(fbclid);
  if (!id || !Number.isFinite(atMs) || atMs <= 0) return null;
  return `fb.1.${Math.floor(atMs)}.${id}`;
}

/** An _fbc value. The pixel may add a short suffix after the click id, so dots are allowed there. */
export function isValidFbc(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= 600 && /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(value);
}

export function isValidFbp(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= 100 && /^fb\.\d\.\d{10,13}\.\d{1,20}$/.test(value);
}

/** The fbclid inside an _fbc value (to tell whether a landing is a new click). */
export function fbclidOf(fbc: string | null | undefined): string | null {
  if (!isValidFbc(fbc)) return null;
  return fbc.split('.').slice(3).join('.') || null;
}

/**
 * Every domain a cookie for `hostname` may have been set on, most specific
 * first: the host itself and each parent domain (the pixel keeps its cookies
 * on the registrable domain, e.g. .stayful.co.uk). Used to delete _fbp and
 * _fbc wherever they are; a write to a public suffix is refused by the
 * browser, so trying it is harmless.
 */
export function cookieDomainsFor(hostname: string): string[] {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host || /^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return [];
  const parts = host.split('.');
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i += 1) out.push(parts.slice(i).join('.'));
  return out;
}

/**
 * The domain our own _fbc goes on, the same one the pixel uses: the
 * registrable domain (stayful.co.uk for intelligence.stayful.co.uk). Null for
 * a bare host (localhost, an IP), where the cookie stays on the host.
 */
export function registrableDomain(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host || /^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return null;
  const parts = host.split('.');
  // Two-part public suffixes we may run under (…co.uk, …org.uk); vercel.app is itself a public suffix.
  const twoPart = /\.(co|org|ac|gov|ltd|plc|me|net|nhs|sch)\.uk$|\.vercel\.app$/;
  const keep = twoPart.test(`.${host}`) ? 3 : 2;
  if (parts.length < keep) return null;
  return parts.slice(-keep).join('.');
}
