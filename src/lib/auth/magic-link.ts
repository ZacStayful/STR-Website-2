import { siteUrl } from "../url.ts";

// A sign-in link that /auth/confirm verifies server-side from a generateLink
// hashed_token. Needs no PKCE cookie, so it works on any device it is opened
// on, which the WhatsApp welcome relies on.
export function confirmLink(hashedToken: string, next: string): string {
  return siteUrl(`/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=magiclink&next=${encodeURIComponent(next)}`);
}
