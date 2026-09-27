/**
 * The form an email is stored in on profiles (trimmed, lowercase: Supabase
 * Auth lowercases every address it stores, and lead provisioning does too),
 * so a look-up is an exact `.eq('email', emailKey(x))`.
 *
 * Never `.ilike('email', x)`: in ILIKE `_` matches any one character and `%`
 * any run, and PostgREST also turns every `*` into `%` with no way to escape
 * it, so `jane_doe@gmail.com` finds `jane.doe@gmail.com` and `j*@x.com` finds
 * anyone at x.com. A stored address that is not lowercase is simply not found,
 * which is the safe way to fail. Pure.
 */
export function emailKey(value: string): string {
  return value.trim().toLowerCase();
}
