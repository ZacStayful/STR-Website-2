/**
 * "Nothing matched, and here is the one thing to change."
 *
 * A member whose filter is strict can go days with nothing to show for it,
 * which reads as a broken product rather than a strict setting. So when the
 * filter empties the pool we send the closest listing we found and say plainly
 * that it is not an exact match — together with the single constraint costing
 * them the most, and the value that would actually admit something.
 *
 * The analysis is leave-one-out. A listing that fails exactly one constraint
 * tells us what that constraint is costing; a listing that fails three tells us
 * nothing useful, because relaxing any one of them still would not have let it
 * through. Counting only the single-failure listings is what makes the advice
 * honest: "drop this to three months and four more would have qualified" is a
 * checkable promise, and if the member lifts the filter and still gets nothing
 * we have lied to them.
 *
 * Pure: no network, no database, no `server-only`.
 */
import type { SourcedListing } from './sourcing.ts';

/** The constraints worth advising on. Suitability is absent on purpose: a room or a shared-ownership sale is never sendable, so there is nothing to relax. */
export type Dimension = 'motivation' | 'price' | 'bedrooms';

export const DIMENSION_LABELS: Record<Dimension, string> = {
  motivation: 'How long it must have been on the market',
  price: 'Your budget',
  bedrooms: 'Your minimum bedrooms',
};

/** A listing that failed the filter, and what it failed on. */
export interface NearMiss {
  listing: SourcedListing;
  /** Empty means it passed everything and is a real candidate. */
  fails: Dimension[];
  /** Days on market, for advising on the motivation threshold. */
  ageDays: number | null;
  /** Sale price or rent pcm, for advising on the budget. */
  amount: number | null;
  bedrooms: number | null;
}

export interface RelaxOption {
  key: Dimension;
  label: string;
  current: string;
  suggested: string;
  /** How many listings this change alone would have admitted. */
  wouldAdd: number;
}

export interface Relaxation {
  /** The constraint costing the member the most. */
  binding: RelaxOption;
  all: RelaxOption[];
  /**
   * True when another option is within one listing of the binding one. The
   * member is told rather than given an arbitrary winner.
   */
  close: boolean;
}

/** What the member's filter currently says, for labelling and for the new value. */
export interface CurrentFilter {
  kind: 'sale' | 'rent';
  /** Months for a sale, weeks for a let — whichever applies to `kind`. */
  thresholdUnits: number;
  maxPrice: number | null;
  minBedrooms: number | null;
}

/** How many listings a suggestion has to admit before it is worth suggesting. */
export const RELAX_TARGET = 3;

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

function unitWord(kind: 'sale' | 'rent', n: number): string {
  const word = kind === 'rent' ? 'week' : 'month';
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The value that would have admitted `target` of these listings — or, when
 * there are fewer than that, the value that admits all of them. Sorting puts
 * the easiest to admit first, so taking the nth is the smallest change that
 * reaches n.
 */
function valueAdmitting(values: number[], target: number, order: 'asc' | 'desc'): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (order === 'asc' ? a - b : b - a));
  return sorted[Math.min(target, sorted.length) - 1];
}

function onlyFailed(misses: NearMiss[], key: Dimension): NearMiss[] {
  return misses.filter((m) => m.fails.length === 1 && m.fails[0] === key);
}

/**
 * The one change most worth making, and the full picture behind it. Null when
 * no single change would have helped — which is itself worth knowing, because
 * it means the pool is empty for reasons no threshold will fix.
 */
export function analyseRelaxation(misses: NearMiss[], current: CurrentFilter, target = RELAX_TARGET): Relaxation | null {
  const options: RelaxOption[] = [];

  const motivation = onlyFailed(misses, 'motivation');
  if (motivation.length > 0) {
    // The listings that were not quite stale enough. Admitting the oldest of
    // them is the smallest move, so sort by age descending.
    const ages = motivation.map((m) => m.ageDays).filter((d): d is number => d !== null);
    const perUnit = current.kind === 'rent' ? 7 : 30.44;
    const admitDays = valueAdmitting(ages, target, 'desc');
    if (admitDays !== null) {
      const units = Math.max(1, Math.floor(admitDays / perUnit));
      if (units < current.thresholdUnits) {
        options.push({
          key: 'motivation',
          label: DIMENSION_LABELS.motivation,
          current: unitWord(current.kind, current.thresholdUnits),
          suggested: unitWord(current.kind, units),
          wouldAdd: ages.filter((d) => d >= units * perUnit).length,
        });
      }
    }
  }

  const price = onlyFailed(misses, 'price');
  if (price.length > 0 && current.maxPrice !== null) {
    const amounts = price.map((m) => m.amount).filter((a): a is number => a !== null);
    const admit = valueAdmitting(amounts, target, 'asc');
    if (admit !== null && admit > current.maxPrice) {
      options.push({
        key: 'price',
        label: DIMENSION_LABELS.price,
        current: current.kind === 'rent' ? `${gbp(current.maxPrice)} pcm` : gbp(current.maxPrice),
        suggested: current.kind === 'rent' ? `${gbp(admit)} pcm` : gbp(admit),
        wouldAdd: amounts.filter((a) => a <= admit).length,
      });
    }
  }

  const beds = onlyFailed(misses, 'bedrooms');
  if (beds.length > 0 && current.minBedrooms !== null) {
    const counts = beds.map((m) => m.bedrooms).filter((b): b is number => b !== null);
    const admit = valueAdmitting(counts, target, 'desc');
    if (admit !== null && admit < current.minBedrooms) {
      options.push({
        key: 'bedrooms',
        label: DIMENSION_LABELS.bedrooms,
        current: `${current.minBedrooms}`,
        suggested: `${admit}`,
        wouldAdd: counts.filter((b) => b >= admit).length,
      });
    }
  }

  if (options.length === 0) return null;
  const all = [...options].sort((a, b) => b.wouldAdd - a.wouldAdd);
  const binding = all[0];
  return { binding, all, close: all.length > 1 && binding.wouldAdd - all[1].wouldAdd <= 1 };
}

/**
 * The listing to send when nothing matched: fewest failures first, then the
 * best motivation score. It has still passed suitability and the money tests —
 * "closest" never means a deal that does not work.
 */
export function closestMatch(misses: NearMiss[], scoreOf: (l: SourcedListing) => number = () => 0): NearMiss | null {
  const usable = misses.filter((m) => m.fails.length > 0);
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => a.fails.length - b.fails.length || scoreOf(b.listing) - scoreOf(a.listing))[0];
}

/** The line the member reads. Names the change and what it would have been worth. */
export function describeRelaxation(r: Relaxation | null): string | null {
  if (!r) return null;
  const b = r.binding;
  const lead = `Your tightest filter is ${b.label.toLowerCase()} — currently ${b.current}. Change it to ${b.suggested} and ${b.wouldAdd} more would have qualified.`;
  if (!r.close) return lead;
  const other = r.all[1];
  return `${lead} ${other.label} is costing you almost as much (${other.wouldAdd}), so either would help.`;
}
