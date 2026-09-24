/**
 * Keyed, one-way digest of an estate or letting agent's name.
 *
 * `src/lib/listing/types.ts` states that agent details are deliberately not
 * kept, and that rule stands. But "this listing came back with a different
 * agent" is one of the strongest signals that a seller has lost patience, and
 * answering it only needs to know whether two values differ — never what they
 * are. So the name is hashed on the way in and the name itself is dropped,
 * exactly as the listing description already is.
 *
 * HMAC-SHA256 truncated to 16 bytes. The key matters: there are only a few
 * thousand agent brands in the UK, so a plain digest would be reversible by
 * dictionary in seconds. Without a key configured this returns null — no
 * signal is a better failure than a reversible one.
 *
 * `agentHashWith` takes the key explicitly so it can be unit tested;
 * `agentHash` is the env-reading wrapper application code calls. Same split as
 * `secrets.ts`.
 */
import { createHmac } from 'node:crypto';

/** Trims the cosmetic differences that would otherwise look like a new agent. */
export function normaliseAgentName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(?:ltd|limited|llp|plc|the|estate agents?|estates?|lettings?|property|properties|sales)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The digest, or null when there is no usable name. */
export function agentHashWith(key: string, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = normaliseAgentName(raw);
  if (!name) return null;
  return createHmac('sha256', key).update(name).digest('base64url').slice(0, 22);
}

/** Null when AGENT_HASH_KEY is unset: the signal is dropped rather than made reversible. */
export function agentHash(raw: string | null | undefined): string | null {
  const key = process.env.AGENT_HASH_KEY;
  return key ? agentHashWith(key, raw) : null;
}
