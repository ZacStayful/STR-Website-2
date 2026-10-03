/**
 * Batch 23b: the one data angle a morning's briefing is about, and the
 * template opener for each (used when the writer's text is rejected, late,
 * switched off, or the member is not briefed by AI).
 *
 * Angles in the brief's numbering. 4, 5, 6 and 10 (all about the top pick)
 * wait for a pick chosen before the briefing pass; 11 and 12 wait for data
 * (90 days of deals, an asking-price series) we do not hold yet.
 *
 * Pure: no network, no database, no server-only.
 */
import { factOf, placePhrase, typePlural, type FactId, type FactSheet } from './facts.ts';

export type AngleId = 'time_saved' | 'funnel' | 'price_drop' | 'memory' | 'thin_night' | 'pipeline' | 'monday';

export interface AngleInfo {
  id: AngleId;
  /** The brief's number, for the admin page and the hand-back. */
  brief: number;
  /** What the opener is about, for the writer. */
  about: string;
  /** The facts this angle may use. */
  facts: FactId[];
}

export const ANGLES: Record<AngleId, AngleInfo> = {
  monday: { id: 'monday', brief: 13, about: 'Last week in one line: how many new listings I screened in their areas, and how many deals they kept.', facts: ['week_screened', 'week_kept'] },
  price_drop: { id: 'price_drop', brief: 3, about: 'A deal they kept dropped its price yesterday.', facts: ['drop_old_price', 'drop_new_price', 'drop_amount', 'drop_pct', 'drops_more'] },
  pipeline: { id: 'pipeline', brief: 9, about: 'Their pipeline: how many deals are in it, and the one that has sat longest in its stage.', facts: ['pipeline_count', 'overdue_days'] },
  thin_night: { id: 'thin_night', brief: 8, about: 'An honest thin night: fewer deals cleared the bar in their areas yesterday than usual.', facts: ['qualified_yesterday', 'qualified_usual', 'screened_yesterday'] },
  memory: { id: 'memory', brief: 7, about: 'A pattern in what they pass on: one property type, again and again this month.', facts: ['passes_count', 'passes_days'] },
  funnel: { id: 'funnel', brief: 2, about: 'The funnel: listings screened yesterday, how many cleared the bar, how many live deals fit them.', facts: ['screened_yesterday', 'qualified_yesterday', 'fit_live'] },
  time_saved: { id: 'time_saved', brief: 1, about: 'Time saved: the new listings I read for them yesterday, and how long that would have taken.', facts: ['screened_yesterday', 'time_saved'] },
};

/** Most specific first: a thing that happened beats a standing figure. */
export const ANGLE_PRIORITY: AngleId[] = ['monday', 'price_drop', 'pipeline', 'thin_night', 'memory', 'funnel', 'time_saved'];

/** Passes of one type before the memory angle speaks (the brief: at least 5 in 30 days). */
export const MEMORY_MIN_PASSES = 5;
/** Below this many listings, "time saved" is minutes of nothing: not worth an opener. */
const TIME_SAVED_MIN_SCREENED = 10;

export function angleEligible(sheet: FactSheet, id: AngleId): boolean {
  const has = (f: FactId) => factOf(sheet, f) !== null;
  switch (id) {
    case 'monday':
      return sheet.isMonday && has('week_screened');
    case 'price_drop':
      return has('drop_new_price');
    case 'pipeline':
      return has('pipeline_count') && has('overdue_days');
    case 'thin_night':
      return has('qualified_usual') && sheet.comparisons.length > 0 && has('screened_yesterday');
    case 'memory':
      return (factOf(sheet, 'passes_count')?.value ?? 0) >= MEMORY_MIN_PASSES;
    case 'funnel':
      return has('screened_yesterday') && has('qualified_yesterday') && has('fit_live');
    case 'time_saved':
      return (factOf(sheet, 'screened_yesterday')?.value ?? 0) >= TIME_SAVED_MIN_SCREENED && has('time_saved');
  }
}

/**
 * Today's angle: the first eligible one in priority order that was not
 * yesterday's (never two days running) and, where there is a choice, not one
 * of the last three days'. Null when nothing new can be said.
 *
 * `recent` is the member's angles, newest first: [yesterday, the day before, …].
 */
export function chooseAngle(sheet: FactSheet, recent: readonly (AngleId | null)[]): AngleId | null {
  const eligible = ANGLE_PRIORITY.filter((id) => angleEligible(sheet, id));
  const yesterday = recent[0] ?? null;
  const allowed = eligible.filter((id) => id !== yesterday);
  const lately = new Set(recent.slice(0, 3).filter((x): x is AngleId => Boolean(x)));
  return allowed.find((id) => !lately.has(id)) ?? allowed[0] ?? null;
}

/** The plain form of a fact (its first), for templates. */
function plain(sheet: FactSheet, id: FactId): string {
  const f = factOf(sheet, id);
  if (!f) throw new Error(`template needs ${id}`);
  return f.forms[0];
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The template opener for an angle, written by code from the sheet's own
 * forms, so it always passes the validator.
 */
export function templateOpener(sheet: FactSheet, angle: AngleId): string {
  const p = (id: FactId) => plain(sheet, id);
  switch (angle) {
    case 'monday': {
      const kept = factOf(sheet, 'week_kept')?.value ?? 0;
      return kept > 0
        ? `Last week I screened ${p('week_screened')} new listings in your areas. You kept ${p('week_kept')} of the deals I found.`
        : `Last week I screened ${p('week_screened')} new listings in your areas. This week's deals are below.`;
    }
    case 'price_drop': {
      const d = sheet.inputs.keptDrops[0];
      const more = factOf(sheet, 'drops_more');
      return `${capital(placePhrase(d.town, d.type).replace(/^an? /, 'The '))} you kept has come down from ${p('drop_old_price')} to ${p('drop_new_price')}.${more ? ` ${capital(more.forms[0])} more of your kept deals dropped too.` : ' The details are in your deals below.'}`;
    }
    case 'pipeline': {
      const late = sheet.inputs.overdue[0];
      const n = factOf(sheet, 'pipeline_count')!.value;
      return `You have ${p('pipeline_count')} ${n === 1 ? 'deal' : 'deals'} in your pipeline. ${capital(placePhrase(late.town, late.type).replace(/^an? /, 'The '))} has been in ${late.stageLabel} for ${p('overdue_days')}.`;
    }
    case 'thin_night':
      return `A quiet night: ${p('qualified_yesterday')} new deals cleared the bar in your areas yesterday, fewer than usual. I still screened ${p('screened_yesterday')} new listings to find them.`;
    case 'memory': {
      const t = sheet.inputs.passesByType[0];
      return `You've passed on ${p('passes_count')} ${typePlural(t.type)} in ${p('passes_days')}. Today's deals are below.`;
    }
    case 'funnel':
      return `Yesterday I screened ${p('screened_yesterday')} new listings in your areas and ${p('qualified_yesterday')} cleared the bar. ${capital(p('fit_live'))} live deals fit what you're after.`;
    case 'time_saved':
      return `I read ${p('screened_yesterday')} new listings in your areas yesterday. That's ${p('time_saved')} of scrolling you didn't have to do.`;
  }
}
