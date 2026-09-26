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
import { isSendable, screeningScore, type Band, type Screening } from './screen.ts';
import { findOutcode } from './html.ts';

/** The short-let check as far as the search card can answer it; anything worse never reaches ranking. */
export type Precheck = 'ok' | 'unknown';

export interface RankOptions {
  /** How far down the ranking to keep. The picks run reaches 40 deep when better candidates are capped or unsuitable. */
  depth: number;
  mode: MotivationMode;
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
 * Feedback rules, then the income gate, then fit, then the short-let split.
 * Each step is the picks run's own, in the picks run's order.
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
  const list = rankPicksByBand(kept, opts.depth, opts.mode);
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
