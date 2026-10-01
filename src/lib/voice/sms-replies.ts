/**
 * Batch 23, Part E: what to say back to a text sent to the Stayful
 * Intelligence number. STOP / START / HELP are Batch 8's and are handled
 * before this is asked. Pure.
 */

/** "Who is this?" and close variants: short messages that are only that question. */
const WHO = [
  /^who (is|s|'s|r|are) (this|that|it|you|u|calling|texting|messaging)$/,
  /^whos (this|that|it|calling|texting)$/,
  /^who dis$/,
  /^who are (you|u)$/,
  /^(sorry )?who (is|s|'s) (this|that) (please|pls|then)$/,
  /^who (is|s|'s) this (number|from)$/,
  /^what (is|s|'s) this( number)?$/,
  /^who (sent|called|texted|rang) (this|me)$/,
  /^who (is|s|'s) stayful( intelligence)?$/,
];

export function normaliseText(body: string): string {
  return body
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/'s\b/g, ' is')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(hi|hello|hey|hiya|um|erm|sorry)[ ,]+/, '')
    .replace(/ (please|pls)$/, '');
}

export function isWhoIsThis(body: string): boolean {
  const n = normaliseText(body);
  if (!n || n.split(' ').length > 7) return false;
  return WHO.some((re) => re.test(n));
}

export type SmsReplyKind = 'who' | 'other';

export function replyKind(body: string): SmsReplyKind {
  return isWhoIsThis(body) ? 'who' : 'other';
}
