/**
 * Guard for user-supplied "return to" paths (?redirect=, ?next=). Only a
 * same-origin absolute path is accepted — never a scheme, protocol-relative
 * URL or backslash trick — so these params can't become open redirects.
 *
 * Control characters are refused anywhere, not only at the start: the URL
 * parser drops tabs and newlines wherever they are, so "/<tab>/evil.com"
 * would otherwise pass the checks below and then resolve as "//evil.com".
 * A backslash is refused anywhere too, because browsers read it as "/", and
 * so is a "." or ".." path segment: "/..//evil.com" stays on this site, but
 * its path normalises to "//evil.com", which a later redirect could misread.
 * Each check is made on the path as written and as it will be routed (see
 * routedPath), so "%2e%2e", "%2f" or "%5c" cannot slip one past.
 */
export function safeInternalPath(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (!v.startsWith('/')) return fallback;
  if (v.startsWith('//')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return fallback;
  const path = v.split(/[?#]/, 1)[0];
  const routed = routedPath(path);
  if (routed === null) return fallback;
  for (const p of [path, routed]) {
    if (p.startsWith('//') || /[\u0000-\u001f\u007f\\]/.test(p)) return fallback;
    if (/(^|\/)\.{1,2}(\/|$)/.test(p)) return fallback;
  }
  return v;
}

/**
 * A path as the site will act on it: %-escapes decoded. The URL parser reads
 * "%2e" as "." when it resolves dot segments, and Next decodes the rest
 * ("%2f", "%61pi") when it matches a route, so a check made only on the
 * escaped form can be walked round. Null when an escape is malformed.
 */
export function routedPath(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}
