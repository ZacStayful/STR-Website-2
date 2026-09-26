/**
 * The GSM-7 alphabet, and a text's length in it.
 *
 * A text that is all GSM-7 fits 160 characters in one segment. One character
 * outside it (an emoji, a curly quote, an en dash) switches the whole message
 * to UCS-2, which fits only 70 and so costs two or three segments for the
 * same words. Every text we send is one segment of plain GSM-7, so this file
 * decides what that means: `toGsm` swaps the typographic characters our copy
 * and the listing data are full of for their plain equivalents, and
 * `gsmLength` refuses anything it still cannot encode.
 *
 * `£` is in the basic set, so prices cost one character each. The extension
 * set (`€ ^ { } [ ] ~ \ |`) costs two.
 *
 * Pure: no network, no database, no server-only.
 */

/** One segment of GSM-7. Anything longer is never sent. */
export const MAX_SMS_LENGTH = 160;

/** The last line of every text we send. */
export const OPT_OUT_LINE = 'Reply STOP to opt out';

// GSM 03.38 basic character set (the escape character itself excluded).
const BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
// The extension table: each costs an escape plus the character.
const EXTENDED = '\f^{}\\[~]|€';

const BASIC_SET: ReadonlySet<string> = new Set(BASIC);
const EXTENDED_SET: ReadonlySet<string> = new Set(EXTENDED);

// Typographic characters with a plain GSM equivalent.
const SWAPS: ReadonlyArray<[RegExp, string]> = [
  [/[‘’‚‛′`´]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[‐‑‒–—―−]/g, '-'],
  [/…/g, '...'],
  [/[  -   　]/g, ' '],
  [/[​‌‍⁠﻿]/g, ''],
  [/[•·]/g, '-'],
  [/×/g, 'x'],
  [/→/g, 'to'],
];

/** The text with typographic characters replaced by plain GSM-7 ones. Characters with no equivalent are left for gsmLength to refuse. */
export function toGsm(text: string): string {
  let out = text;
  for (const [pattern, plain] of SWAPS) out = out.replace(pattern, plain);
  return out;
}

/** Whether every character is in the GSM-7 basic or extension set. */
export function isGsm(text: string): boolean {
  return gsmLength(text) !== null;
}

/**
 * The text's length in GSM-7 septets (extension characters count two), or
 * null when any character cannot be encoded at all.
 */
export function gsmLength(text: string): number | null {
  let n = 0;
  for (const ch of text) {
    if (BASIC_SET.has(ch)) n += 1;
    else if (EXTENDED_SET.has(ch)) n += 2;
    else return null;
  }
  return n;
}

/** One plain GSM-7 segment: the only shape of text we send. */
export function fitsOneSegment(text: string): boolean {
  const n = gsmLength(text);
  return n !== null && n > 0 && n <= MAX_SMS_LENGTH;
}
