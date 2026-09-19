/**
 * What an API key is allowed to do.
 *
 * Pure and tested, because a scope check that is wrong in the permissive
 * direction is invisible until someone uses it. The two rules that matter:
 *
 *   A key holds exactly the scopes it was minted with. There is no implicit
 *   widening — holding `leads:write` does not confer `leads:read`, even
 *   though it would be convenient, because "write implies read" is the kind
 *   of convenience that grows into a key doing more than its owner meant.
 *
 *   An unknown scope is dropped on the way in, never on the way out. A key
 *   stored with a scope a later version no longer recognises must not be
 *   read as holding it, and a key minted with a typo must not silently hold
 *   nothing while looking like it holds something.
 */

export const SCOPES = [
  'analyse',
  'reports:read',
  'leads:read',
  'leads:write',
  'funnels:read',
  'funnels:write',
  'markets:read',
] as const;

export type Scope = (typeof SCOPES)[number];

export const SCOPE_LABELS: Record<Scope, string> = {
  analyse: 'Run property analyses (spends your credit)',
  'reports:read': 'Read your own report history',
  'leads:read': 'Read leads, counts and exports',
  'leads:write': 'Send leads to your CRM and delete them',
  'funnels:read': 'Read funnel settings and qualification rules',
  'funnels:write': 'Change qualification rules',
  'markets:read': 'Read market snapshots',
};

/** The set offered by default when minting: everything that only reads. */
export const READ_ONLY_SCOPES: Scope[] = ['reports:read', 'leads:read', 'funnels:read', 'markets:read'];

const KNOWN = new Set<string>(SCOPES);

export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && KNOWN.has(value);
}

/**
 * Cleans a list of requested or stored scopes. Anything unrecognised is
 * dropped, duplicates collapse, and the order is the canonical one so two
 * keys with the same reach read identically.
 */
export function parseScopes(raw: unknown): Scope[] {
  const list = Array.isArray(raw) ? raw : [];
  const held = new Set(list.filter(isScope));
  return SCOPES.filter((s) => held.has(s));
}

/** No implicit widening: a key holds what it holds. */
export function hasScope(held: readonly Scope[], needed: Scope): boolean {
  return held.includes(needed);
}

/** Whether a key can do anything at all beyond identifying its owner. */
export function scopesAreEmpty(held: readonly Scope[]): boolean {
  return held.length === 0;
}

/**
 * Whether a key can spend money. Worth its own helper because it is the one
 * distinction a customer should see before they paste a key into an agent
 * they do not control.
 */
export function spendsCredit(held: readonly Scope[]): boolean {
  return held.includes('analyse');
}
