/**
 * Guard for user-supplied "return to" paths (?redirect=, ?next=). Only a
 * same-origin absolute path is accepted — never a scheme, protocol-relative
 * URL or backslash trick — so these params can't become open redirects.
 */
export function safeInternalPath(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (!v.startsWith('/')) return fallback;
  if (v.startsWith('//') || v.startsWith('/\\')) return fallback;
  if (/[\r\n]/.test(v)) return fallback;
  return v;
}
