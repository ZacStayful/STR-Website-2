/**
 * Admin allow-list.
 *
 * SECURITY: admin is granted by the AUTHENTICATED user's email only — never by
 * comparing a password in code. The password lives in Supabase (hashed) and is
 * checked by the normal login flow; email addresses are not secrets. Callers
 * must derive the email from `supabase.auth.getUser()` (a verified session),
 * not from user input.
 *
 * The list defaults to zac@stayful.co.uk and can be overridden/extended without
 * a code change via the ADMIN_EMAILS env var (comma-separated).
 */

const DEFAULT_ADMIN_EMAILS = ['zac@stayful.co.uk'];

export function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return DEFAULT_ADMIN_EMAILS;
  const parsed = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_ADMIN_EMAILS;
}

/** True when the given (authenticated) email is an admin. Case-insensitive. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}
