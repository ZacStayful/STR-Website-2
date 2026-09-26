/**
 * Early access on the deal card and the /deals banner. The rule itself —
 * who is paid, how long the delay is, when it starts — is Batch 1's
 * (visibility.ts, tier.ts, billing_settings.free_deal_delay_hours); this
 * module only words it.
 *
 *   paying member → a badge on a deal still inside the window:
 *                   "Early access · Free members see this in 31h"
 *   free member   → never sees those deals; one banner with the real count
 *
 * Pure, so the wording and the arithmetic are tested.
 */
import { filtersToSearch, type DealFilters } from './grid.ts';

const HOUR_MS = 60 * 60 * 1000;

/**
 * When free members get this deal, or null when they already have it. A live
 * deal with no `live_since` is brand new as far as the window goes (as
 * dealVisible treats it), so free members get it a full delay from now.
 */
export function earlyAccessFor(liveSinceIso: string | null | undefined, delayHours: number, now: Date = new Date()): { freeAt: Date } | null {
  if (!Number.isFinite(delayHours) || delayHours <= 0) return null;
  const live = liveSinceIso ? Date.parse(liveSinceIso) : NaN;
  const freeAt = (Number.isFinite(live) ? live : now.getTime()) + delayHours * HOUR_MS;
  return freeAt > now.getTime() ? { freeAt: new Date(freeAt) } : null;
}

/** "Free members see this in 31h" — whole hours, rounded up, never "in 0h". */
export function earlyAccessHint(freeAt: Date, now: Date = new Date()): string {
  const hours = Math.max(1, Math.ceil((freeAt.getTime() - now.getTime()) / HOUR_MS));
  return `Free members see this in ${hours}h`;
}

/** Whether the member has narrowed the grid (anything beyond sort, page and their own kept/passed view). */
export function isFiltered(f: DealFilters): boolean {
  return filtersToSearch({ ...f, sort: 'profit', page: 1, view: 'all' }) !== '';
}

/**
 * The free member's banner, or null to show none. The count is the real
 * number of deals inside the window that match the grid's own filters.
 */
export function earlyAccessBanner(count: number | null, filtered: boolean): string | null {
  if (count === null || !Number.isFinite(count) || count <= 0) return null;
  const n = Math.floor(count);
  const deals = n === 1 ? 'new deal' : 'new deals';
  const verb = n === 1 ? 'is' : 'are';
  return `${n.toLocaleString('en-GB')} ${deals}${filtered ? ' matching this search' : ''} ${verb} in early access. Paid members are seeing ${n === 1 ? 'it' : 'them'} now.`;
}
