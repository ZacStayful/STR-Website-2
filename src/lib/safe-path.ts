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
 */
export function safeInternalPath(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (!v.startsWith('/')) return fallback;
  if (v.startsWith('//')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return fallback;
  const path = v.split(/[?#]/, 1)[0];
  if (/(^|\/)\.{1,2}(\/|$)/.test(path)) return fallback;
  return v;
}
