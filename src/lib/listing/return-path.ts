/**
 * The "back to this deal" path carried through the analyser and the open
 * flow (?back=, a hidden `back` field). Only a same-origin path under a deal
 * page or My deals is accepted: safeInternalPath already refuses anything that
 * could leave the site, and the prefix keeps the "Back to this deal" label
 * honest.
 *
 * Pure and client-safe: the analyser page (a client component) uses it too.
 */
import { safeInternalPath } from '../safe-path.ts';

const ALLOWED = [/^\/deals\/[0-9a-f-]{36}(?:[?#]|$)/i, /^\/my-deals(?:[/?#]|$)/];

/** The path, when it is one we will send a member back to; else null. */
export function dealReturnPath(value: unknown): string | null {
  const path = safeInternalPath(typeof value === 'string' ? value : null, '');
  if (!path || path.length > 300) return null;
  return ALLOWED.some((re) => re.test(path)) ? path : null;
}

/** What the back button says for a path from dealReturnPath. */
export function returnLabel(path: string): string {
  return path.startsWith('/my-deals') ? 'Back to My deals' : 'Back to this deal';
}

/** `path` with one query parameter set (replacing any of the same name), keeping any #fragment last. */
export function withParam(path: string, key: string, value: string): string {
  const hashAt = path.indexOf('#');
  const hash = hashAt >= 0 ? path.slice(hashAt) : '';
  const base = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const qAt = base.indexOf('?');
  const pathname = qAt >= 0 ? base.slice(0, qAt) : base;
  const params = new URLSearchParams(qAt >= 0 ? base.slice(qAt + 1) : '');
  params.set(key, value);
  return `${pathname}?${params.toString()}${hash}`;
}

/** Where My deals shows one item: `/my-deals?focus=<key>`. */
export function myDealsFocusPath(key: string): string {
  return `/my-deals?focus=${encodeURIComponent(key)}`;
}
