/**
 * Everything a member is tracking, in one list: the deals on My deals.
 *
 * A member's deals come from four stores, and this is the one place they are
 * merged:
 *   - checked_listings  their pipeline: listings they added, and opened deals
 *                       they have given a stage. The stage is `status`.
 *   - deal_reactions    Keep / Pass on a marketplace deal (Batch 3). For a deal
 *                       with no pipeline row, keep = Kept and pass = Passed.
 *   - deal_opens        the team's unlocks. An opened deal with no row and no
 *                       reaction shows at Kept until the member moves it.
 *   - sourcing_sent     daily picks. Every pool pick is an automatic open; one
 *                       only counts here once the member has acted on it (a
 *                       "yes", a keep, a stage, a save), so untouched picks do
 *                       not pile up at Kept.
 *
 * Precedence, per person and deal: pipeline row > reaction > open. A row is
 * matched to a marketplace deal by canonical_url.
 *
 * THE ADDRESS RULE: `canonicalUrl` and `listing` (which carries the address)
 * are only ever set on an item whose address the member may see: their own
 * pipeline row, or a deal their team has opened. A kept deal that nobody has
 * opened carries neither, whatever the caller passed in.
 *
 * For other batches (Batch 6 reads this for watchlist alerts):
 *   - trackedDeals(input)       every (person, deal) being tracked, with
 *                               stage, kind, area, price and last change
 *   - forViewer(items, viewer)  one item per deal for a team view
 *   - groupByStage / stageCounts / countsLine for display
 *   - loadTrackedDeals(userId)  in tracked-server.ts does the reads
 *
 * Pure: no network, no database, no `server-only`.
 */
import { isPipelineStatus, KEPT_STATUS, PIPELINE_STATUSES, type CheckedListingRow, type PipelineStatus } from './pipeline.ts';
import type { ListingKind, ListingSource } from './types.ts';

/** A marketplace deal's own facts. `canonicalUrl` is read to match rows and never passed on for an unopened deal. */
export interface TrackedDealFacts {
  id: string;
  canonicalUrl: string;
  kind: 'sale' | 'rent';
  postcodeArea: string | null;
  price: { amount: number; period: string } | null;
  status: 'live' | 'retired' | 'pending_verify';
}

export interface TrackedPipelineInput extends CheckedListingRow {
  /** Whose row: checked_listings.user_id. */
  userId: string;
}

export interface TrackedReactionInput {
  userId: string;
  dealId: string;
  reaction: 'keep' | 'pass';
  updatedAt: string;
}

export interface TrackedOpenInput {
  dealId: string;
  openedAt: string;
  /** verified_via = 'pick': the daily pick's automatic open, not a press of Open. */
  viaPick: boolean;
}

export interface TrackedPickAnswerInput {
  userId: string;
  dealId: string;
  reaction: 'yes' | 'no' | null;
}

export interface TrackedInput {
  /** The person looking. Open deals nobody has a stage for are theirs to move. */
  viewerId: string;
  /** Pipeline rows of everyone in scope (the viewer alone, or their team). */
  pipeline: TrackedPipelineInput[];
  reactions: TrackedReactionInput[];
  /** The team's opens (status open). Opens are shared: an unlock is the team's. */
  opens: TrackedOpenInput[];
  pickAnswers: TrackedPickAnswerInput[];
  /**
   * Marketplace deals by id: every deal a reaction or an open points at, and
   * any a pipeline row may be (matched by canonical URL). A reaction or open
   * whose deal is missing here is dropped, so the caller filters out deals
   * the member may not see (the early-access window) by leaving them out.
   */
  deals: Map<string, TrackedDealFacts>;
}

export type TrackedSource = 'pipeline' | 'reaction' | 'open';

export interface TrackedDeal {
  /** Stable handle for the page: `d-<dealId>` for a marketplace deal, `l-<checkedListingId>` for a listing the member added. */
  key: string;
  stage: PipelineStatus;
  kind: ListingKind;
  /** Postcode area, e.g. "M". */
  area: string | null;
  price: { amount: number; period: string } | null;
  /** When the stage (or the row) last changed, ISO. */
  lastChangedAt: string;
  /** The member may see the address: their own row, or a deal the team opened. */
  opened: boolean;
  dealId: string | null;
  /** The marketplace deal's own state, when it is one. */
  dealStatus: TrackedDealFacts['status'] | null;
  /** The pipeline row, when there is one. Null means the stage lives in a reaction or is the open's default. */
  checkedListingId: string | null;
  /** Null unless `opened`. */
  canonicalUrl: string | null;
  /** The full report linked to the row (checked_listings.analysed_report_id). Not checked to still exist. */
  reportId: string | null;
  /** Whose stage this is. */
  userId: string;
  source: TrackedSource;
  /** What the row knows about the listing. Only on a pipeline row, which is always the member's own. */
  listing: { title: string; address: string | null; photo: string | null; bedrooms: number | null; source: ListingSource } | null;
}

const time = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};

/**
 * Every (person, deal) being tracked. One item per person per deal; a team
 * view then narrows to one per deal with forViewer.
 */
export function trackedDeals(input: TrackedInput): TrackedDeal[] {
  const out: TrackedDeal[] = [];
  const dealsByUrl = new Map<string, TrackedDealFacts>();
  for (const d of input.deals.values()) dealsByUrl.set(d.canonicalUrl, d);
  const openedIds = new Set(input.opens.filter((o) => input.deals.has(o.dealId)).map((o) => o.dealId));
  // person → deal ids they already have an item for
  const has = new Map<string, Set<string>>();
  const mark = (userId: string, dealId: string) => {
    const set = has.get(userId) ?? new Set<string>();
    set.add(dealId);
    has.set(userId, set);
  };
  const anyone = new Set<string>();

  // 1. Pipeline rows: the member's own record, so the address is theirs.
  for (const r of input.pipeline) {
    const deal = dealsByUrl.get(r.canonicalUrl) ?? null;
    out.push({
      key: deal ? `d-${deal.id}` : `l-${r.id}`,
      stage: isPipelineStatus(r.status) ? r.status : KEPT_STATUS,
      kind: r.kind,
      area: r.postcodeArea,
      price: r.price,
      lastChangedAt: r.updatedAt,
      opened: true,
      dealId: deal?.id ?? null,
      dealStatus: deal?.status ?? null,
      checkedListingId: r.id,
      canonicalUrl: r.canonicalUrl,
      reportId: r.analysedReportId,
      userId: r.userId,
      source: 'pipeline',
      listing: { title: r.title, address: r.displayAddress, photo: r.photo, bedrooms: r.bedrooms, source: r.source },
    });
    if (deal) {
      mark(r.userId, deal.id);
      anyone.add(deal.id);
    }
  }

  // 2. Keep / Pass on a deal the person has no row for.
  for (const x of input.reactions) {
    const deal = input.deals.get(x.dealId);
    if (!deal || has.get(x.userId)?.has(deal.id)) continue;
    const opened = openedIds.has(deal.id);
    out.push(fromDeal(deal, { stage: x.reaction === 'pass' ? 'passed' : KEPT_STATUS, lastChangedAt: x.updatedAt, opened, userId: x.userId, source: 'reaction' }));
    mark(x.userId, deal.id);
    anyone.add(deal.id);
  }

  // 3. The team's opens nobody in scope has a stage for: Kept, the viewer's to
  //    move. A daily pick's automatic open counts only once acted on.
  const pickYes = new Set(input.pickAnswers.filter((p) => p.reaction === 'yes').map((p) => p.dealId));
  const seenOpen = new Set<string>();
  for (const o of input.opens) {
    const deal = input.deals.get(o.dealId);
    if (!deal || anyone.has(deal.id) || seenOpen.has(deal.id)) continue;
    if (o.viaPick && !pickYes.has(deal.id)) continue;
    seenOpen.add(deal.id);
    out.push(fromDeal(deal, { stage: KEPT_STATUS, lastChangedAt: o.openedAt, opened: true, userId: input.viewerId, source: 'open' }));
  }
  return out;
}

function fromDeal(deal: TrackedDealFacts, o: { stage: PipelineStatus; lastChangedAt: string; opened: boolean; userId: string; source: TrackedSource }): TrackedDeal {
  return {
    key: `d-${deal.id}`,
    stage: o.stage,
    kind: deal.kind,
    area: deal.postcodeArea,
    price: deal.price,
    lastChangedAt: o.lastChangedAt,
    opened: o.opened,
    dealId: deal.id,
    dealStatus: deal.status,
    checkedListingId: null,
    // The address rule: never the URL of a deal nobody has opened.
    canonicalUrl: o.opened ? deal.canonicalUrl : null,
    reportId: null,
    userId: o.userId,
    source: o.source,
    listing: null,
  };
}

/** A team view's item: whose it is, and who else on the team tracks the same deal. */
export interface ViewerDeal extends TrackedDeal {
  /** The viewer's own item (or an open nobody has moved yet): the only kind they may change. */
  mine: boolean;
  /** Other people on the team tracking the same deal. */
  alsoTrackedBy: string[];
  /** Whose report `reportId` is, when it came from a teammate's row. */
  reportUserId: string | null;
}

/**
 * One item per deal for the person looking: their own item when they have
 * one, else the teammate's most recently changed. When their own item has no
 * report and a teammate's does, the teammate's report is shown on it (team
 * reports are shared), so the team does not pay for the same report twice.
 */
export function forViewer(items: TrackedDeal[], viewerId: string): ViewerDeal[] {
  const groups = new Map<string, TrackedDeal[]>();
  for (const it of items) {
    const k = it.dealId ? `d:${it.dealId}` : `u:${it.canonicalUrl ?? it.key}`;
    const list = groups.get(k) ?? [];
    list.push(it);
    groups.set(k, list);
  }
  const out: ViewerDeal[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => time(b.lastChangedAt) - time(a.lastChangedAt));
    const winner = sorted.find((it) => it.userId === viewerId) ?? sorted[0];
    const withReport = winner.reportId ? winner : sorted.find((it) => it.reportId);
    out.push({
      ...winner,
      mine: winner.userId === viewerId,
      alsoTrackedBy: [...new Set(sorted.filter((it) => it !== winner && it.userId !== winner.userId).map((it) => it.userId))],
      reportId: withReport?.reportId ?? null,
      reportUserId: withReport && withReport !== winner ? withReport.userId : null,
    });
  }
  return out;
}

/** Most recently changed first. */
export function byLastChange<T extends Pick<TrackedDeal, 'lastChangedAt' | 'key'>>(a: T, b: T): number {
  return time(b.lastChangedAt) - time(a.lastChangedAt) || a.key.localeCompare(b.key);
}

/** Every stage in order (Passed last), each with its items most recently changed first. Empty stages included. */
export function groupByStage<T extends Pick<TrackedDeal, 'stage' | 'lastChangedAt' | 'key'>>(items: T[]): { stage: PipelineStatus; items: T[] }[] {
  return PIPELINE_STATUSES.map((s) => ({ stage: s.key, items: items.filter((it) => it.stage === s.key).sort(byLastChange) }));
}

export function stageCounts(items: Pick<TrackedDeal, 'stage'>[]): Record<PipelineStatus, number> {
  const counts = Object.fromEntries(PIPELINE_STATUSES.map((s) => [s.key, 0])) as Record<PipelineStatus, number>;
  for (const it of items) counts[it.stage] += 1;
  return counts;
}

/** "12 kept · 3 contacted · 1 viewing · 1 offer": the active stages that have anything, Passed left out. */
export function countsLine(counts: Record<PipelineStatus, number>): string {
  return PIPELINE_STATUSES.filter((s) => s.key !== 'passed' && counts[s.key] > 0)
    .map((s) => `${counts[s.key]} ${s.short}`)
    .join(' · ');
}

/**
 * Whether an item is the one a `?focus=` points at: its own key, or the
 * pipeline row behind it (`l-<checkedListingId>`, what the save actions know).
 */
export function matchesFocus(item: Pick<TrackedDeal, 'key' | 'checkedListingId'>, focus: string | null | undefined): boolean {
  if (!focus) return false;
  return item.key === focus || (item.checkedListingId !== null && `l-${item.checkedListingId}` === focus);
}
