/**
 * One member's candidates, in the order they should be offered.
 *
 * The daily picks run (src/lib/listing/picks-run.ts) and the Today page both
 * rank through here, so the pick in the morning email and the five on Today
 * are shaped by the same confirmed feedback, the same income bar and the same
 * fit. Where the candidates come from is the caller's business: the run
 * searches, Today reads the marketplace pool. This module only decides what
 * survives and in what order.
 *
 * Pure: no network, no database, no `server-only`, so it runs under
 * `node --test`.
 */
import type { MotivationMode } from '../market/goals.ts';
import { applyCandidateFeedback, cleanReasons, type AppliedRules, type PickFeedback } from './picks.ts';
import { rankPicksByBand, type RankCandidate, type SourcedListing } from './sourcing.ts';
import { bandRank, isSendable, screeningScore, type Band, type Screening } from './screen.ts';
import { findOutcode } from './html.ts';

/** The short-let check as far as the search card can answer it; anything worse never reaches ranking. */
export type Precheck = 'ok' | 'unknown';

/** How far back a member's answers still shape what they are offered. One window for the email and Today. */
export const FEEDBACK_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

export interface RankOptions {
  /** How far down the ranking to keep. The picks run reaches 40 deep when better candidates are capped or unsuitable. */
  depth: number;
  mode: MotivationMode;
  /** Batch 22c: the return-on-cash lift (on unless false). Off, the ranking is exactly the one before it. */
  returnOnCash?: boolean;
}

/**
 * Batch 22c, Part C: return on cash as a ranking factor for purchases. A
 * purchase's estimated annual profit (the screening's surplus over a long
 * let) over its cash in (deposit, tax and setup; an auction lot's bridging
 * cash) lifts its fit by ROC_LIFT_PER_POINT for every percentage point over
 * ROC_FLOOR_PCT, at most ROC_LIFT_MAX. So a £120,000 deal making 12% on its
 * cash (+9) is offered ahead of a £450,000 one making 7% (+1) when both are
 * in the member's budget and otherwise fit alike; two deals with the same
 * return are lifted alike, whatever their price. Rent-to-rent is unchanged.
 * The lift changes the order only: never the screening, the income bar, the
 * profit figures or the budget.
 */
export const ROC_FLOOR_PCT = 6;
export const ROC_LIFT_PER_POINT = 1.5;
export const ROC_LIFT_MAX = 15;

/** A purchase's estimated return on cash, %: the screening's surplus over the deal's cash in. Null for a rental or without either figure. */
export function returnOnCashPct(c: { deal: RankCandidate['deal']; screening?: Screening | null }): number | null {
  if (c.deal?.kind !== 'purchase' || c.screening?.kind !== 'purchase') return null;
  const profit = c.screening.surplus;
  const cash = c.deal.cashRequired;
  if (typeof profit !== 'number' || !Number.isFinite(profit) || !Number.isFinite(cash) || cash <= 0) return null;
  return (profit / cash) * 100;
}

/** The fit points a candidate's return on cash adds: 0 to ROC_LIFT_MAX. */
export function returnOnCashLift(c: { deal: RankCandidate['deal']; screening?: Screening | null }): number {
  const pct = returnOnCashPct(c);
  if (pct === null) return 0;
  return Math.max(0, Math.min(ROC_LIFT_MAX, Math.round(ROC_LIFT_PER_POINT * (pct - ROC_FLOOR_PCT))));
}

/**
 * The lift applied to a band-ordered ranking: each candidate's fit raised
 * (never past 100, as the motivation lift), then re-ordered by fit within
 * its band. Stable, so equal fits keep the ranking's own order (its yield
 * tie-break). Bands never mix: a qualified deal stays ahead of a medium one.
 */
function withReturnOnCash<C extends RankCandidate & { screening?: Screening | null; fit: number }>(list: C[]): C[] {
  const band = (c: C) => bandRank(c.screening?.band ?? 'qualified');
  return list
    .map((c, i) => ({ c: { ...c, fit: Math.min(100, c.fit + returnOnCashLift(c)) }, i }))
    .sort((a, b) => band(a.c) - band(b.c) || b.c.fit - a.c.fit || a.i - b.i)
    .map((x) => x.c);
}

export interface MemberRanking<C> {
  /** What the member's confirmed answers left standing. */
  afterFeedback: C[];
  /** Of those, what clears the income bar (unscreened candidates pass, as the send loop assumes). */
  kept: C[];
  /** The band of every screened candidate that reached the income bar, for the run's summary. */
  screened: Partial<Record<Band, number>>;
  /** Best first: listings that clear the short-let check on the card, then the ones that need the page. */
  ranked: (C & { fit: number })[];
  /**
   * Something survived the feedback but the income bar took all of it. Worth
   * telling apart from an empty market: only this one is ours to reconsider.
   */
  gated: boolean;
}

/**
 * Feedback rules, then the income gate, then fit (Batch 22c: with the
 * return-on-cash lift), then the short-let split. Each step is the picks
 * run's own, in the picks run's order.
 */
export function rankForMember<C extends RankCandidate & { precheck: Precheck; screening?: Screening | null }>(
  candidates: C[],
  feedback: PickFeedback[],
  rules: AppliedRules,
  opts: RankOptions,
): MemberRanking<C> {
  const screened: Partial<Record<Band, number>> = {};
  const afterFeedback = applyCandidateFeedback(candidates, feedback, rules);
  // ── The income gate ──
  // Applied BEFORE ranking, because rankPicks keeps only the top `depth`:
  // screening afterwards would discard a qualifying property that happened to
  // rank 41st. Counted per band so the admin report can tell a thin market
  // apart from a bar that is too high.
  const kept = afterFeedback.filter((c) => {
    if (!c.screening) return true;
    screened[c.screening.band] = (screened[c.screening.band] ?? 0) + 1;
    return isSendable(c.screening);
  });
  // Band decides what may be sent; fit still decides the order within a band.
  // The two are not comparable across kinds (an uplift % against a profit in
  // pounds), whereas blendFit already normalises both onto one scale. Ranked
  // band by band so the depth cut can never drop a qualified listing in favour
  // of a medium one that happened to fit better.
  // Batch 22c: with the return-on-cash lift, the whole pool is ranked first and cut
  // to depth only after the lift, so a high-return deal just below the cut is never lost.
  const list = opts.returnOnCash === false ? rankPicksByBand(kept, opts.depth, opts.mode) : withReturnOnCash(rankPicksByBand(kept, Math.max(opts.depth, kept.length), opts.mode)).slice(0, Math.max(0, opts.depth));
  // "Could not be run as a short let": a member who said so is only offered
  // listings that already clear the check on the search card, never ones that
  // need the page to rescue them. Band sorting happens INSIDE each of these
  // buckets, or the page reads would be aimed at listings that cannot clear it.
  const ok = list.filter((p) => p.precheck === 'ok');
  const unknown = rules.strictSuitability ? [] : list.filter((p) => p.precheck !== 'ok');
  return { afterFeedback, kept, screened, ranked: [...ok, ...unknown], gated: afterFeedback.length > 0 && kept.length === 0 };
}

/** One stored answer to a pick, as `sourcing_sent` carries it. */
export interface StoredFeedbackRow {
  reaction: unknown;
  reaction_source: unknown;
  reasons: unknown;
  kind: unknown;
  postcode_area: unknown;
}

/**
 * A stored answer, joined to the listing it was about and the screening it was
 * sent on, as the feedback rules read it. The listing supplies size, type and
 * price; the screening supplies the figure "return too low" is measured on.
 * Either may be missing on an old row, and each field then reads as unknown
 * rather than guessed.
 */
export function toPickFeedback(row: StoredFeedbackRow, listing: SourcedListing | null, screening: Screening | null): PickFeedback {
  const l = listing;
  const amount = l?.price ? (l.kind === 'rent' ? (l.price.period === 'pw' ? Math.round((l.price.amount * 52) / 12) : l.price.amount) : l.price.period === 'total' ? l.price.amount : null) : null;
  return {
    reaction: row.reaction === 'yes' || row.reaction === 'no' ? row.reaction : null,
    reactionSource: row.reaction_source === 'form' || row.reaction_source === 'link' ? row.reaction_source : null,
    reasons: cleanReasons(row.reasons),
    kind: row.kind === 'sale' || row.kind === 'rent' ? row.kind : null,
    postcodeArea: typeof row.postcode_area === 'string' ? row.postcode_area : null,
    bedrooms: l?.bedrooms ?? null,
    amount,
    rawType: l?.rawType ?? null,
    // Older stored snapshots carry no outcode; the postcode still has one.
    outcode: l?.outcode ?? findOutcode(l?.postcode ?? l?.address ?? null),
    screeningScore: screeningScore(screening),
  };
}
