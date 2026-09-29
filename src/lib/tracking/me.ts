/**
 * What the browser is told by /api/tracking/me and /api/tracking/claim
 * (Batch 19), and the checks every answer passes before the browser acts on
 * it: anything malformed is treated as "nothing to do".
 *
 * Pure: shared by the routes and the browser. No network, no server-only.
 */
import { isMetaEvent, type MetaEventName } from '../meta/events.ts';
import { isChoice, type Choice } from './consent.ts';

/** One conversion for the browser to claim and fire, with the server's event id. */
export interface BrowserConversion {
  /** The conversion's one unique key (meta_conversions.dedupe_key): what a claim names. */
  key: string;
  name: MetaEventName;
  /** What Meta de-duplicates the browser and server copies on. */
  eventId: string;
  /** Subscribe and Purchase only, excluding VAT. */
  valuePence: number | null;
}

export interface MeAnswer {
  signedIn: boolean;
  /** The member's hashed account number: the pixel goes silent if it changes in the same tab. */
  who: string | null;
  /** The member's saved choice, after this device and the member were brought into line. */
  choice: Choice | null;
  /** The server rewrote this device's consent cookie (the member's newer choice). */
  deviceUpdated: boolean;
  /** Admin, staff, switched off or a team seat: no pixel for them at all. */
  excluded: boolean;
  /** For the pixel's init: the hashed email and hashed account number. Consenting members only. */
  pixel: { em: string | null; external_id: string } | null;
  /** Conversions recorded (or released) with consent, from production, under a day old, not fired yet. */
  pending: BrowserConversion[];
}

export const SIGNED_OUT: MeAnswer = { signedIn: false, who: null, choice: null, deviceUpdated: false, excluded: false, pixel: null, pending: [] };

const HASH = /^[a-f0-9]{64}$/;
const EVENT_ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const MAX_PENDING = 10;

export function parseBrowserConversion(v: unknown): BrowserConversion | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.key !== 'string' || o.key.length === 0 || o.key.length > 200) return null;
  if (!isMetaEvent(o.name)) return null;
  if (typeof o.eventId !== 'string' || !EVENT_ID.test(o.eventId)) return null;
  let valuePence: number | null = null;
  if (o.valuePence !== null && o.valuePence !== undefined) {
    if (typeof o.valuePence !== 'number' || !Number.isFinite(o.valuePence) || o.valuePence < 0) return null;
    valuePence = Math.round(o.valuePence);
  }
  return { key: o.key, name: o.name, eventId: o.eventId, valuePence };
}

export function parseMeAnswer(v: unknown): MeAnswer | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.signedIn !== true) return o.signedIn === false ? SIGNED_OUT : null;
  const who = typeof o.who === 'string' && HASH.test(o.who) ? o.who : null;
  let pixel: MeAnswer['pixel'] = null;
  if (o.pixel && typeof o.pixel === 'object') {
    const p = o.pixel as Record<string, unknown>;
    if (typeof p.external_id === 'string' && HASH.test(p.external_id)) {
      pixel = { em: typeof p.em === 'string' && HASH.test(p.em) ? p.em : null, external_id: p.external_id };
    }
  }
  const pending = Array.isArray(o.pending)
    ? o.pending
        .slice(0, MAX_PENDING)
        .map(parseBrowserConversion)
        .filter((c): c is BrowserConversion => c !== null)
    : [];
  return {
    signedIn: true,
    who,
    choice: isChoice(o.choice) ? o.choice : null,
    deviceUpdated: o.deviceUpdated === true,
    excluded: o.excluded === true,
    pixel,
    pending,
  };
}
