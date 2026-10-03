/**
 * Batch 23b: stage nudges. A deal that has sat in its pipeline stage past
 * its time gets one line under the briefing, linking to it in My deals and
 * naming its next step (the stage's next-step template heading).
 *
 * Days count from when the deal ENTERED the stage. With no record of that
 * (the stage was set before stage moves were logged), there is no nudge:
 * a guess would be a number the member could prove wrong.
 *
 * Pure: no network, no database, no server-only.
 */
import { myDealsFocusPath } from '../listing/return-path.ts';
import type { OverdueDeal, PropertyType } from './facts.ts';

export type NudgeStage = 'watching' | 'contacted' | 'viewing' | 'offer';

/** Days in a stage before a nudge (Zac): Kept 7, Contacted 5, Viewing 3, Offer 7. */
export const NUDGE_DAYS: Record<NudgeStage, number> = { watching: 7, contacted: 5, viewing: 3, offer: 7 };

/** The stage's name as My deals shows it. */
export const NUDGE_STAGE_LABEL: Record<NudgeStage, string> = { watching: 'Kept', contacted: 'Contacted', viewing: 'Viewing', offer: 'Offer' };

/** The next step for each stage: the heading of its next-step template (src/lib/pipeline/next-steps.ts). */
export const NEXT_STEP: Record<NudgeStage, string> = {
  watching: 'Contact the agent',
  contacted: 'Book a viewing',
  viewing: 'Check it works as a short let',
  offer: 'Make your offer',
};

export const MAX_NUDGES = 2;

export function isNudgeStage(s: unknown): s is NudgeStage {
  return s === 'watching' || s === 'contacted' || s === 'viewing' || s === 'offer';
}

export interface StageEntry {
  key: string;
  stage: string;
  /** When the deal entered this stage, ISO; null when not recorded. */
  enteredAt: string | null;
  town: string | null;
  type: PropertyType | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every deal past its stage's time, most overdue first (beyond the threshold, then oldest). */
export function overdueDeals(entries: readonly StageEntry[], now: Date): OverdueDeal[] {
  const out: (OverdueDeal & { over: number })[] = [];
  for (const e of entries) {
    if (!isNudgeStage(e.stage) || !e.enteredAt) continue;
    const at = Date.parse(e.enteredAt);
    if (!Number.isFinite(at) || at > now.getTime()) continue;
    const days = Math.floor((now.getTime() - at) / DAY_MS);
    if (days < NUDGE_DAYS[e.stage]) continue;
    out.push({ key: e.key, stage: e.stage, stageLabel: NUDGE_STAGE_LABEL[e.stage], days, town: e.town, type: e.type, over: days - NUDGE_DAYS[e.stage] });
  }
  out.sort((a, b) => b.over - a.over || b.days - a.days || a.key.localeCompare(b.key));
  return out.map(({ over: _over, ...d }) => {
    void _over;
    return d;
  });
}

export interface NudgeLink {
  key: string;
  /** The template line under the briefing when the writer's is not used. */
  text: string;
  /** "Contact the agent". */
  nextStep: string;
  /** Site-relative: /my-deals?focus=<key>. */
  path: string;
}

/** The (at most two) nudges, with their template lines and links. */
export function nudgeLinks(overdue: readonly OverdueDeal[]): NudgeLink[] {
  return overdue.slice(0, MAX_NUDGES).map((d) => {
    const what = d.type ?? 'deal';
    const where = d.town ? ` in ${d.town}` : '';
    return {
      key: d.key,
      text: `The ${what}${where} has been in ${d.stageLabel} for ${d.days} days.`,
      nextStep: NEXT_STEP[d.stage],
      path: myDealsFocusPath(d.key),
    };
  });
}
