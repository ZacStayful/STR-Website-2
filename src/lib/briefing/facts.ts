/**
 * Batch 23b: the morning fact sheet.
 *
 * Built by code, per member, per UK morning, from data we hold. The AI writes
 * words around these facts and never computes one: every derived figure (time
 * saved, the usual night, the drop) is worked out here, and each fact carries
 * the exact forms it may be said in (./forms.ts).
 *
 * What a fact may contain is closed: counts, money, days, a stage label from
 * PIPELINE_STATUSES, a property type from the fixed list below, and a place
 * that is a town or an area name. Never a listing title, description, agent
 * text, address, postcode, outcode or link: the inputs below have no field
 * for one, and placeName() refuses anything that does not look like a town.
 *
 * Only angles that can be known before the picks pass runs are here (Zac,
 * 2026-10-03): the top pick is chosen at 07:00 UTC, after the briefing.
 *
 * Pure: no network, no database, no server-only.
 */
import { TIME_SAVED } from '../home/config.ts';
import { countForms, dayForms, durationForms, moneyForms, percentForms, timesForms } from './forms.ts';

export type FactId =
  | 'screened_yesterday'
  | 'time_saved'
  | 'qualified_yesterday'
  | 'qualified_usual'
  | 'fit_live'
  | 'drop_old_price'
  | 'drop_new_price'
  | 'drop_amount'
  | 'drop_pct'
  | 'drops_more'
  | 'passes_count'
  | 'passes_days'
  | 'pipeline_count'
  | 'overdue_days'
  | 'week_screened'
  | 'week_kept';

export interface Fact {
  id: FactId;
  /** What the figure is, in plain words, for the writer. */
  label: string;
  value: number;
  /** Every way it may be said. The first is the plain one, used by the template. */
  forms: string[];
}

/** The fixed property-type words a fact may use. */
export const PROPERTY_TYPES = ['flat', 'terraced house', 'semi-detached house', 'detached house', 'bungalow', 'maisonette', 'cottage', 'house'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

const TYPE_PLURAL: Record<PropertyType, string> = {
  flat: 'flats',
  'terraced house': 'terraced houses',
  'semi-detached house': 'semi-detached houses',
  'detached house': 'detached houses',
  bungalow: 'bungalows',
  maisonette: 'maisonettes',
  cottage: 'cottages',
  house: 'houses',
};

export function typePlural(t: PropertyType): string {
  return TYPE_PLURAL[t];
}

/** A listing's raw type mapped onto the fixed list; null when it is not one of them. */
export function propertyTypeOf(rawType: string | null | undefined): PropertyType | null {
  const t = (rawType ?? '').toLowerCase();
  if (!t.trim()) return null;
  if (/maisonette/.test(t)) return 'maisonette';
  if (/flat|apartment|studio|penthouse/.test(t)) return 'flat';
  if (/bungalow/.test(t)) return 'bungalow';
  if (/cottage/.test(t)) return 'cottage';
  if (/semi/.test(t)) return 'semi-detached house';
  if (/terrace|town ?house|end of terrace/.test(t)) return 'terraced house';
  if (/detached/.test(t)) return 'detached house';
  if (/house/.test(t)) return 'house';
  return null;
}

/**
 * A town or area name safe to hand the writer: letters, spaces, hyphens and
 * apostrophes, at most 40 characters. Anything else (a sentence, a number, a
 * link) is refused, so a listing field can never carry an instruction in.
 */
export function placeName(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!t || t.length > 40) return null;
  if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' ’-]*$/.test(t)) return null;
  return t;
}

/** "a terraced house in Leeds" / "a flat" / "a deal in Leeds". */
export function placePhrase(town: string | null, type: PropertyType | null): string {
  const what = type ?? 'deal';
  const article = /^[aeiou]/.test(what) ? 'an' : 'a';
  return town ? `${article} ${what} in ${town}` : `${article} ${what}`;
}

// ── Inputs (all already counted and scoped by the server side) ──

export interface KeptDrop {
  town: string | null;
  type: PropertyType | null;
  oldPrice: number;
  newPrice: number;
  /** 'total' for a sale, 'pcm' for a rental. */
  period: 'total' | 'pcm';
}

export interface OverdueDeal {
  /** My deals key: d-<dealId> / l-<checkedListingId>. */
  key: string;
  stage: 'watching' | 'contacted' | 'viewing' | 'offer';
  stageLabel: string;
  days: number;
  town: string | null;
  type: PropertyType | null;
}

export interface SheetInputs {
  /** The UK day the briefing is for, YYYY-MM-DD. */
  ukDay: string;
  /** New listings first screened yesterday (UK day) in the member's areas and kinds: listing_scan_days, the one "scanned". */
  screenedYesterday: number | null;
  /** Deals in the member's areas and kinds that went live (qualified) yesterday. */
  qualifiedYesterday: number | null;
  /** The same count for each of the seven days before yesterday, oldest first; null where unknown. */
  qualifiedPrior: (number | null)[];
  /** Live deals that fit the member's active profile now (Today's "N match"). */
  fitLive: number | null;
  /** Price drops recorded in the last day on deals they kept (newest first). */
  keptDrops: KeptDrop[];
  /** Their passes in the last 30 days, by property type, most first. */
  passesByType: { type: PropertyType; count: number }[];
  /** Deals in their pipeline (Kept to Offer). */
  pipelineCount: number;
  /** Pipeline deals past their nudge time, most overdue first. */
  overdue: OverdueDeal[];
  /** Mondays only: last week's screened count in their areas, and how many deals they kept. */
  week: { screened: number; kept: number } | null;
}

export interface FactSheet {
  ukDay: string;
  /** "Monday". */
  weekday: string;
  isMonday: boolean;
  facts: Fact[];
  /** The inputs the sheet was built from, for the angles and templates. */
  inputs: SheetInputs;
  /** Comparison words the writer may use ("fewer than usual"): only when a fact supports them. */
  comparisons: string[];
  /** Words for places and types the writer may use. */
  places: string[];
}

/** The memory angle counts passes over this many days. */
export const PASS_WINDOW_DAYS = 30;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayOf(ukDay: string): string {
  return WEEKDAYS[new Date(`${ukDay}T12:00:00Z`).getUTCDay()];
}

/** The median of the known values; null with fewer than five. */
export function usualOf(values: readonly (number | null)[]): number | null {
  const known = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (known.length < 5) return null;
  const mid = Math.floor(known.length / 2);
  return known.length % 2 === 1 ? known[mid] : Math.round((known[mid - 1] + known[mid]) / 2);
}

const positive = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function buildFactSheet(inputs: SheetInputs): FactSheet {
  const facts: Fact[] = [];
  const add = (id: FactId, label: string, value: number, forms: string[]) => facts.push({ id, label, value, forms });
  const comparisons: string[] = [];
  const places = new Set<string>();

  if (positive(inputs.screenedYesterday)) {
    add('screened_yesterday', 'New listings I screened yesterday in your areas', inputs.screenedYesterday, countForms(inputs.screenedYesterday));
    const minutes = (inputs.screenedYesterday * TIME_SAVED.secondsPerPropertyScanned) / 60;
    const d = durationForms(minutes);
    if (d.length > 0) add('time_saved', `Time that would take to read yourself, at ${TIME_SAVED.secondsPerPropertyScanned} seconds a listing`, Math.round(minutes), d);
  }
  if (typeof inputs.qualifiedYesterday === 'number' && inputs.qualifiedYesterday >= 0) {
    add('qualified_yesterday', 'Of those areas, deals that cleared the bar and went live yesterday', inputs.qualifiedYesterday, countForms(inputs.qualifiedYesterday));
    const usual = usualOf(inputs.qualifiedPrior);
    if (usual !== null && usual > 0) {
      add('qualified_usual', 'The usual number a day over the week before (median)', usual, countForms(usual));
      if (inputs.qualifiedYesterday < usual) comparisons.push('fewer than usual', 'quieter than usual', 'below the usual', 'a quiet night', 'a thin night');
    }
  }
  if (typeof inputs.fitLive === 'number' && inputs.fitLive >= 0) add('fit_live', 'Live deals that fit what you are looking for right now', inputs.fitLive, countForms(inputs.fitLive));

  const drop = inputs.keptDrops[0];
  if (drop && drop.newPrice < drop.oldPrice) {
    const suffix = drop.period === 'pcm' ? 'a month' : '';
    add('drop_old_price', 'Its price before the drop', drop.oldPrice, moneyForms(drop.oldPrice, suffix));
    add('drop_new_price', 'Its price now', drop.newPrice, moneyForms(drop.newPrice, suffix));
    add('drop_amount', 'How much it came down', drop.oldPrice - drop.newPrice, moneyForms(drop.oldPrice - drop.newPrice));
    const pct = ((drop.oldPrice - drop.newPrice) / drop.oldPrice) * 100;
    if (pct >= 1) add('drop_pct', 'The drop as a share of the old price', Math.round(pct), percentForms(pct));
    if (inputs.keptDrops.length > 1) add('drops_more', 'Other kept deals that also dropped in the last day', inputs.keptDrops.length - 1, countForms(inputs.keptDrops.length - 1));
    places.add(placePhrase(drop.town, drop.type));
    if (drop.town) places.add(drop.town);
    if (drop.type) places.add(drop.type);
  }

  const passes = inputs.passesByType[0];
  if (passes && passes.count > 0) {
    add('passes_count', `${typePlural(passes.type)} you passed on in the last ${PASS_WINDOW_DAYS} days`, passes.count, [...countForms(passes.count), ...timesForms(passes.count)]);
    add('passes_days', 'The window those passes are counted over', PASS_WINDOW_DAYS, [`the last ${PASS_WINDOW_DAYS} days`, ...dayForms(PASS_WINDOW_DAYS), 'this month']);
    places.add(passes.type).add(typePlural(passes.type));
  }

  if (inputs.pipelineCount > 0) add('pipeline_count', 'Deals in your pipeline (Kept to Offer)', inputs.pipelineCount, countForms(inputs.pipelineCount));
  const late = inputs.overdue[0];
  if (late) {
    add('overdue_days', `Days the oldest one has been in ${late.stageLabel}`, late.days, dayForms(late.days));
    places.add(placePhrase(late.town, late.type)).add(late.stageLabel);
    if (late.town) places.add(late.town);
  }

  const weekday = weekdayOf(inputs.ukDay);
  if (weekday === 'Monday' && inputs.week && inputs.week.screened > 0) {
    add('week_screened', 'New listings I screened last week (Monday to Sunday) in your areas', inputs.week.screened, countForms(inputs.week.screened));
    add('week_kept', 'Deals you kept last week', inputs.week.kept, countForms(inputs.week.kept));
  }

  return { ukDay: inputs.ukDay, weekday, isMonday: weekday === 'Monday', facts, inputs, comparisons, places: [...places] };
}

export function factOf(sheet: FactSheet, id: FactId): Fact | null {
  return sheet.facts.find((f) => f.id === id) ?? null;
}
