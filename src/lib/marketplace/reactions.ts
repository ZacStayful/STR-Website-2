/**
 * Keep and Pass on a marketplace deal: the pure half.
 *
 * A reaction is one row per (member, deal) in deal_reactions. Keep puts the
 * deal on the member's kept list; Pass takes it off their grid and, with a
 * reason, trains their daily picks exactly as a "no" on a pick does. Both are
 * free and neither reveals anything a member pays to see.
 *
 * The picks run reads two kinds of answer — a reaction to an emailed pick
 * (sourcing_sent) and a reaction on the grid (deal_reactions) — and the same
 * listing can carry both. `mergeFeedback` keeps exactly one answer per
 * listing, the most recent, so nothing is counted twice and a member who
 * changes their mind is taken at their latest word.
 *
 * Pure: no network, no database, no `server-only`.
 */
import { cleanReasons, reasonsInGroup, REASON_GROUPS, type PickFeedback, type PickReason } from '../listing/picks.ts';
import { parseScreening, screeningScore } from '../listing/screen.ts';
import type { DealView } from './grid.ts';
import type { DealReaction } from './reaction-state.ts';

export { isDealReaction, nextReaction, type DealReaction } from './reaction-state.ts';

/** The embed, and the filters on it, that narrow the grid to one member's view. */
export interface ReactionFilter {
  /** Appended to the select: an empty embed, so nothing extra comes back. */
  embed: string;
  /** Filters on the embedded rows. The user filter is always first and always present. */
  eq: [column: string, value: string][];
  /** The anti-join: keep only deals with no matching embedded row. */
  absent: boolean;
}

/**
 * How the grid asks for one member's view:
 *   all    → every deal this member has NOT passed (anti-join on their passes)
 *   kept   → only the deals they kept
 *   passed → only the deals they passed
 * Null when there is nothing to filter (no member). Every embed carries the
 * member's id: without it a deal anyone passed would vanish for everyone.
 */
export function reactionFilter(view: DealView, userId: string | null | undefined): ReactionFilter | null {
  if (!userId) return null;
  if (view === 'all') return { embed: 'deal_reactions()', eq: [['deal_reactions.user_id', userId], ['deal_reactions.reaction', 'pass']], absent: true };
  return { embed: 'deal_reactions!inner()', eq: [['deal_reactions.user_id', userId], ['deal_reactions.reaction', view === 'kept' ? 'keep' : 'pass']], absent: false };
}

/** The pass reasons, grouped as the pick forms group them, as plain data a client component can take. */
export interface ReasonGroupView {
  key: string;
  label: string;
  reasons: { key: string; label: string }[];
}

export const PASS_REASON_GROUPS: ReasonGroupView[] = REASON_GROUPS.map((g) => ({
  key: g.key,
  label: g.label,
  reasons: reasonsInGroup(g.key).map((r) => ({ key: r.key, label: r.label })),
}));

/** The deal facts a pass is judged on: the same ones a pick's feedback reads. */
export interface DealFeedbackFacts {
  kind: string;
  postcode_area: string | null;
  outcode: string | null;
  bedrooms: number | null;
  /** Sale: the asking price. Rent: pcm (marketplace_deals normalises it). */
  price_amount: number | string | null;
  price_period: string | null;
  raw_type: string | null;
  screening: unknown;
}

/**
 * A grid reaction as the picks engine reads a pick answer. A pass is a
 * confirmed "no" (a signed-in tap, never a mail scanner), so its reasons
 * become rules; a pass with no reasons adds no rule and only hides the deal.
 * A keep is a "yes": it adds no rule, but as the latest answer it does
 * replace an older "no" on the same listing.
 */
export function dealReactionToFeedback(r: { reaction: DealReaction; reasons: unknown }, d: DealFeedbackFacts): PickFeedback {
  const kind = d.kind === 'sale' || d.kind === 'rent' ? d.kind : null;
  const n = d.price_amount === null || d.price_amount === '' ? NaN : Number(d.price_amount);
  // Same units the pick answers use: a sale's total price, a let's monthly rent.
  const amount = Number.isFinite(n) && n > 0 && (kind === 'rent' ? d.price_period === 'pcm' : d.price_period === 'total') ? n : null;
  return {
    reaction: r.reaction === 'pass' ? 'no' : 'yes',
    reactionSource: 'form',
    reasons: r.reaction === 'pass' ? cleanReasons(r.reasons) : [],
    kind,
    postcodeArea: d.postcode_area,
    bedrooms: d.bedrooms,
    amount,
    rawType: d.raw_type,
    outcode: d.outcode,
    screeningScore: screeningScore(parseScreening(d.screening)),
  };
}

/** One answer about one listing, and when it was given. */
export interface FeedbackEntry {
  url: string;
  at: string | null;
  feedback: PickFeedback;
}

const time = (iso: string | null): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};

/**
 * One answer per listing: whichever was given last. A tie goes to the grid
 * reaction, the more deliberate of the two. Order of the output follows the
 * first time each listing was seen, which keeps the rules deterministic.
 */
export function mergeFeedback(pickEntries: FeedbackEntry[], dealEntries: FeedbackEntry[]): PickFeedback[] {
  const best = new Map<string, FeedbackEntry>();
  const consider = (e: FeedbackEntry, winsTies: boolean) => {
    const held = best.get(e.url);
    if (!held || time(e.at) > time(held.at) || (winsTies && time(e.at) === time(held.at))) best.set(e.url, e);
  };
  for (const e of pickEntries) consider(e, false);
  for (const e of dealEntries) consider(e, true);
  return [...best.values()].map((e) => e.feedback);
}

/** Reasons from a form or a client, cleaned to the known keys. Re-exported so callers need not reach into picks.ts. */
export function cleanPassReasons(raw: unknown): PickReason[] {
  return cleanReasons(raw);
}
