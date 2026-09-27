/**
 * An ILIKE pattern that matches `value` exactly, ignoring case only.
 *
 * In ILIKE, `_` matches any one character and `%` any run of them, so an
 * email passed straight in can find someone else: `jane_doe@gmail.com`
 * matches `jane.doe@gmail.com`. Every email look-up by ILIKE goes through
 * this. Pure.
 */
export function exactLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
