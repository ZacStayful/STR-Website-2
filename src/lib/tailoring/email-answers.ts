/**
 * Part F: "Yes, more like this" and "Not for me" under each teaser in the
 * daily email (Today's 5).
 *
 * Each link names the send and one deal: /p/d/<sendToken>/<dealId>?a=yes|no.
 * The token is the send's own random one (notification_sends; the digest
 * already minted it, the picks run now does too), so a link is bound to
 * exactly the deals that email carried, and clearing the send's token
 * revokes every link in it. The page:
 *   - checks the deal was one of that send's teasers (teaserInSend);
 *   - writes nothing on a GET, because mail scanners open every link;
 *   - records the answer on one confirming POST, through the grid's own
 *     Keep and Pass, for the send's member, stamped with the profile whose
 *     part of the email the deal was in. So Today's cards, the grid, the
 *     next charged pick and the "Not for me" rules all see it.
 * It shows only what the teaser showed: no photo, no address, no listing or
 * report link, no Open button.
 *
 * Pure: no network, no database, no `server-only`.
 */
export type EmailAnswer = 'yes' | 'no';

export const EMAIL_ANSWER_LABELS: Record<EmailAnswer, string> = { yes: 'Yes, more like this', no: 'Not for me' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEmailAnswer(v: unknown): v is EmailAnswer {
  return v === 'yes' || v === 'no';
}

export function isDealId(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

/** The link under a teaser: the send's token and the deal id only. */
export function teaserAnswerUrl(siteUrl: string, sendToken: string, dealId: string, answer: EmailAnswer): string {
  return `${siteUrl.replace(/\/$/, '')}/p/d/${encodeURIComponent(sendToken)}/${encodeURIComponent(dealId)}?a=${answer}`;
}

/** What a send's summary records per part of the email: whose profile, and its teasers. */
export interface SendPart {
  profile: string | null;
  teasers: string[];
}

export function sendParts(profileIds: readonly (string | null)[], teasersByPart: readonly (readonly string[])[]): SendPart[] {
  return profileIds.map((profile, i) => ({ profile, teasers: [...(teasersByPart[i] ?? [])] }));
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Whether this deal was a teaser in the send (its stored summary), and under
 * which profile. Null: it was not, so the link answers nothing. A send from
 * before the parts were recorded has no profile to name (null profile).
 */
export function teaserInSend(summary: unknown, dealId: string): { profileId: string | null } | null {
  if (!summary || typeof summary !== 'object') return null;
  const s = summary as { teasers?: unknown; parts?: unknown };
  if (!strings(s.teasers).includes(dealId)) return null;
  for (const part of Array.isArray(s.parts) ? s.parts : []) {
    if (!part || typeof part !== 'object') continue;
    const p = part as { profile?: unknown; teasers?: unknown };
    if (strings(p.teasers).includes(dealId)) return { profileId: typeof p.profile === 'string' && isDealId(p.profile) ? p.profile : null };
  }
  return { profileId: null };
}
