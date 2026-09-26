import 'server-only';

/**
 * The reads behind My deals: what trackedDeals (tracked.ts) merges, loaded
 * for one person (or their team) with the service role and scoped by id.
 *
 * Who is in scope mirrors Team reports (saved_searches' RLS): a report
 * belongs to the team owner's account, and the owner and every ACTIVE member
 * see all of the team's; a suspended member sees only their own; a member's
 * reports from before they joined stay theirs alone. Here, for scope 'team',
 * the owner and active members see every deal anyone on the team tracks,
 * except a member's rows and Keep / Pass from before they joined; a
 * suspended member, or scope 'own', sees only their own stages. Opens are
 * the team's either way (deal_opens.user_id is the owner who paid), exactly
 * as on /deals.
 *
 * Nothing a member tracks is dropped for volume: their own rows, every Keep
 * and every open they pressed are read to caps no real account reaches. Only
 * the long tails are capped (teammates' rows, passes), newest first.
 *
 * The early-access window (src/lib/marketplace/visibility.ts) applies to a
 * deal nobody on the team has opened: inside it, a kept deal is left out for
 * an account that has never paid, as it is on the grid.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { payerFor, teamOf } from '../team';
import { CARD_COLUMNS, type DealCard } from '../marketplace/grid';
import { dealVisible, type DealVisibility } from '../marketplace/visibility';
import { dealVisibilityFor } from '../marketplace/tier';
import { loadSourcedListings } from '../marketplace/server';
import type { DealRow } from '../marketplace/types';
import { KEPT_STATUS, toCheckedListingRow, type PipelineStatus } from './pipeline';
import { forViewer, trackedDeals, type TrackedDeal, type TrackedDealFacts, type TrackedOpenInput, type TrackedPickAnswerInput, type TrackedPipelineInput, type TrackedReactionInput, type ViewerDeal } from './tracked';

const PAGE = 1000;
/** Effectively everything: a cap only so a runaway account cannot stall the page. */
const ALL = 10_000;
/** The long tails, newest first: teammates' rows, passes. */
const TAIL = 2_000;
const ID_CHUNK = 150;

const PIPELINE_COLUMNS = 'id, user_id, canonical_url, source, kind, postcode, postcode_area, lat, lng, snapshot, status, notes, share_token, analysed_report_id, listing_status, updated_at, created_at';

/** A marketplace deal as My deals draws it: the card's public columns plus its state. Never the address. */
export interface TrackedCard extends DealCard {
  retired_reason: string | null;
  retired_at: string | null;
}

export interface TrackedLoad {
  /** Every (person, deal) in scope: what Batch 6's alerts read. */
  items: TrackedDeal[];
  /** One item per deal, for the person looking. */
  view: ViewerDeal[];
  /** Card facts for each marketplace deal in `view`, by deal id. */
  cards: Map<string, TrackedCard>;
  /** The address of each OPENED marketplace deal in `view` that has no pipeline row of its own, by deal id. */
  addresses: Map<string, string>;
  /** Everyone in scope (the viewer first). */
  people: string[];
  /** The account that pays: whose opens these are. */
  payerId: string;
  visibility: DealVisibility;
}

type Admin = ReturnType<typeof createAdminClient>;
type Result = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

async function paged<T>(label: string, cap: number, run: (from: number, to: number) => Result): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await run(from, Math.min(from + PAGE, cap) - 1);
    if (error) {
      // A table the schema has not caught up with reads as empty, never as a failed page.
      console.warn(`[tracked] ${label} read failed:`, error.message);
      break;
    }
    out.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

async function chunked<T>(label: string, ids: string[], run: (some: string[]) => Result): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await run(ids.slice(i, i + ID_CHUNK));
    if (error) console.warn(`[tracked] ${label} read failed:`, error.message);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

export interface TrackedScope {
  /** The viewer first. */
  people: string[];
  payerId: string;
  /** When each team MEMBER joined (not the owner): what they tracked before that stays theirs alone. */
  joinedAt: Map<string, number>;
}

/** Who is in scope for this person. */
export async function trackedScope(userId: string, scope: 'own' | 'team'): Promise<TrackedScope> {
  const payer = await payerFor(userId);
  const own: TrackedScope = { people: [userId], payerId: payer.payerId, joinedAt: new Map() };
  if (scope === 'own' || !hasServiceRole()) return own;
  const team = await teamOf(userId);
  // A suspended member sees their own, as with reports.
  if (team.suspended) return own;
  const { data, error } = await createAdminClient().from('team_members').select('member_id, joined_at').eq('owner_id', payer.payerId);
  if (error) {
    console.warn('[tracked] team read failed:', error.message);
    return own;
  }
  const joinedAt = new Map<string, number>();
  for (const m of (data ?? []) as { member_id: string; joined_at: string }[]) {
    const t = Date.parse(m.joined_at);
    if (Number.isFinite(t)) joinedAt.set(m.member_id, t);
  }
  return { people: [...new Set([userId, payer.payerId, ...joinedAt.keys()])], payerId: payer.payerId, joinedAt };
}

/** A teammate's record from before they joined the team: theirs alone, as their pre-team reports are. */
function beforeJoining(scope: TrackedScope, viewerId: string, userId: string, createdAt: unknown): boolean {
  if (userId === viewerId) return false;
  const joined = scope.joinedAt.get(userId);
  if (joined === undefined) return false;
  const t = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
  return Number.isFinite(t) && t < joined;
}

async function loadCards(admin: Admin, ids: string[], urls: string[]): Promise<Map<string, TrackedCard & { canonical_url: string }>> {
  const out = new Map<string, TrackedCard & { canonical_url: string }>();
  const cols = `${CARD_COLUMNS}, photo, canonical_url, retired_reason, retired_at`;
  type Row = TrackedCard & { canonical_url: string; photo: string | null };
  const rows = [
    ...(await chunked<Row>('deals by id', ids, (some) => admin.from('marketplace_deals').select(cols).in('id', some))),
    ...(await chunked<Row>('deals by url', urls, (some) => admin.from('marketplace_deals').select(cols).in('canonical_url', some))),
  ];
  for (const { photo, ...card } of rows) out.set(card.id, { ...card, has_photo: Boolean(photo) });
  return out;
}

function factsOf(c: { id: string; canonical_url: string; kind: string; postcode_area: string | null; price_amount: number | string | null; price_period: string | null; status: TrackedDealFacts['status'] }): TrackedDealFacts {
  const amount = c.price_amount === null ? NaN : Number(c.price_amount);
  return {
    id: c.id,
    canonicalUrl: c.canonical_url,
    kind: c.kind === 'rent' ? 'rent' : 'sale',
    postcodeArea: c.postcode_area,
    price: Number.isFinite(amount) && amount > 0 ? { amount, period: c.price_period ?? (c.kind === 'rent' ? 'pcm' : 'total') } : null,
    status: c.status,
  };
}

type OpenRow = { deal_id: string; opened_at: string; verified_via: string | null };
type ReactionRow = { user_id: string; deal_id: string; reaction: string; updated_at: string; created_at: string };

const toOpen = (o: OpenRow): TrackedOpenInput => ({ dealId: o.deal_id, openedAt: o.opened_at, viaPick: o.verified_via === 'pick' });

function toReactions(rows: ReactionRow[], scope: TrackedScope, viewerId: string): TrackedReactionInput[] {
  return rows
    .filter((r) => (r.reaction === 'keep' || r.reaction === 'pass') && !beforeJoining(scope, viewerId, r.user_id, r.created_at))
    .map((r) => ({ userId: r.user_id, dealId: r.deal_id, reaction: r.reaction as 'keep' | 'pass', updatedAt: r.updated_at }));
}

function toPipeline(rows: Record<string, unknown>[], scope: TrackedScope, viewerId: string): TrackedPipelineInput[] {
  const out: TrackedPipelineInput[] = [];
  for (const raw of rows) {
    const r = toCheckedListingRow(raw);
    if (!r || typeof raw.user_id !== 'string' || beforeJoining(scope, viewerId, raw.user_id, raw.created_at)) continue;
    out.push({ ...r, userId: raw.user_id });
  }
  return out;
}

/**
 * Everything this person is tracking. `scope` 'team' is the My deals view;
 * 'own' is only the person's own stages (plus the team's opens nobody has
 * moved), which is what an alert about "your deals" should read.
 */
export async function loadTrackedDeals(userId: string, opts: { scope?: 'own' | 'team'; adminUser?: boolean } = {}): Promise<TrackedLoad> {
  const visibility = await dealVisibilityFor(userId, Boolean(opts.adminUser));
  const empty: TrackedLoad = { items: [], view: [], cards: new Map(), addresses: new Map(), people: [userId], payerId: userId, visibility };
  if (!hasServiceRole()) return empty;
  const admin = createAdminClient();
  const scope = await trackedScope(userId, opts.scope ?? 'team');
  const { people, payerId } = scope;
  const others = people.filter((p) => p !== userId);

  const [ownRows, teamRows, keeps, passes, pressedOpens, pickRaw] = await Promise.all([
    paged<Record<string, unknown>>('own pipeline', ALL, (from, to) => admin.from('checked_listings').select(PIPELINE_COLUMNS).eq('user_id', userId).order('updated_at', { ascending: false }).order('id', { ascending: true }).range(from, to)),
    others.length === 0 ? Promise.resolve([]) : paged<Record<string, unknown>>('team pipeline', TAIL, (from, to) => admin.from('checked_listings').select(PIPELINE_COLUMNS).in('user_id', others).order('updated_at', { ascending: false }).order('id', { ascending: true }).range(from, to)),
    paged<ReactionRow>('keeps', ALL, (from, to) => admin.from('deal_reactions').select('user_id, deal_id, reaction, updated_at, created_at').in('user_id', people).eq('reaction', 'keep').order('updated_at', { ascending: false }).order('deal_id', { ascending: true }).range(from, to)),
    paged<ReactionRow>('passes', TAIL, (from, to) => admin.from('deal_reactions').select('user_id, deal_id, reaction, updated_at, created_at').in('user_id', people).eq('reaction', 'pass').order('updated_at', { ascending: false }).order('deal_id', { ascending: true }).range(from, to)),
    // Every open someone pressed. The daily picks' automatic opens (one a
    // member a day) are read below, only for the deals that need them.
    paged<OpenRow>('opens', ALL, (from, to) => admin.from('deal_opens').select('deal_id, opened_at, verified_via').eq('user_id', payerId).eq('status', 'open').or('verified_via.is.null,verified_via.neq.pick').order('opened_at', { ascending: false }).order('deal_id', { ascending: true }).range(from, to)),
    paged<{ user_id: string; deal_id: string }>('pick answers', ALL, (from, to) => admin.from('sourcing_sent').select('user_id, deal_id').in('user_id', people).eq('reaction', 'yes').not('deal_id', 'is', null).order('sent_at', { ascending: false }).order('canonical_url', { ascending: true }).range(from, to)),
  ]);

  const pipeline = toPipeline([...ownRows, ...teamRows], scope, userId);
  const reactions = toReactions([...keeps, ...passes], scope, userId);
  const pickAnswers: TrackedPickAnswerInput[] = pickRaw.map((p) => ({ userId: p.user_id, dealId: p.deal_id, reaction: 'yes' }));
  const opens: TrackedOpenInput[] = pressedOpens.map(toOpen);

  const rowUrls = new Set(pipeline.map((r) => r.canonicalUrl));
  const loaded = await loadCards(admin, [...new Set([...reactions.map((r) => r.dealId), ...opens.map((o) => o.dealId), ...pickAnswers.map((p) => p.dealId)])], [...rowUrls]);

  // A pick's automatic open still opens its deal: read it for every deal on
  // this list (so a kept deal that came as a pick is shown opened), and for
  // every pick someone said yes to.
  const openedIds = new Set(opens.map((o) => o.dealId));
  const needOpen = [...loaded.keys()].filter((id) => !openedIds.has(id));
  const pickOpens = await chunked<OpenRow>('pick opens', needOpen, (some) => admin.from('deal_opens').select('deal_id, opened_at, verified_via').eq('user_id', payerId).eq('status', 'open').in('deal_id', some));
  for (const o of pickOpens) {
    opens.push(toOpen(o));
    openedIds.add(o.deal_id);
  }

  // What trackedDeals may use. A deal nobody opened, that no row points at,
  // and that is still inside this account's early-access window is left out,
  // so a kept deal cannot surface before the grid shows it.
  const deals = new Map<string, TrackedDealFacts>();
  const cards = new Map<string, TrackedCard>();
  for (const [id, c] of loaded) {
    if (!openedIds.has(id) && !rowUrls.has(c.canonical_url) && !dealVisible(c.live_since ?? null, visibility.cutoffIso)) continue;
    deals.set(id, factsOf(c));
    // The card never carries the canonical URL: it is drawn in the browser.
    const { canonical_url: _url, ...card } = c;
    void _url;
    cards.set(id, card);
  }

  const items = trackedDeals({ viewerId: userId, pipeline, reactions, opens, pickAnswers, deals });
  const view = forViewer(items, userId);

  // Opened deals with no row of their own: the address is theirs, so read it.
  const needAddress = view.filter((v) => v.opened && v.dealId && !v.listing && v.canonicalUrl);
  const addresses = new Map<string, string>();
  if (needAddress.length > 0) {
    const sourced = await loadSourcedListings(admin, needAddress.map((v) => v.canonicalUrl!));
    for (const v of needAddress) {
      const address = sourced.get(v.canonicalUrl!)?.listing.address;
      if (address) addresses.set(v.dealId!, address);
    }
  }
  return { items, view, cards, addresses, people, payerId, visibility };
}

/** One deal, for its own page: this person's stage, whether it is on My deals, and any report to open. */
export interface DealTracking {
  /** This person's own stage (Kept when they have none). */
  stage: PipelineStatus;
  /** This person has a stage for it on My deals (their row, reaction, or an open nobody has moved). */
  tracked: boolean;
  /** It is on My deals at all, theirs or a teammate's. */
  onMyDeals: boolean;
  checkedListingId: string | null;
  /** Reports to open, this person's first, then the team's most recent. Only where the address may be seen. Not checked to exist. */
  reportCandidates: { id: string; userId: string }[];
}

/**
 * The same answer My deals gives, for one deal: the same reads, scope and
 * merge (trackedDeals), so the deal page and My deals cannot disagree.
 * The canonical URL is read server-side only.
 */
export async function dealTrackingFor(input: { userId: string; deal: Pick<DealRow, 'id' | 'canonical_url' | 'kind' | 'postcode_area' | 'price_amount' | 'price_period' | 'status'> }): Promise<DealTracking> {
  const none: DealTracking = { stage: KEPT_STATUS, tracked: false, onMyDeals: false, checkedListingId: null, reportCandidates: [] };
  if (!hasServiceRole()) return none;
  const admin = createAdminClient();
  const { userId, deal } = input;
  const scope = await trackedScope(userId, 'team');
  const [rowsRes, reactionRes, openRes, pickRes] = await Promise.all([
    admin.from('checked_listings').select(PIPELINE_COLUMNS).in('user_id', scope.people).eq('canonical_url', deal.canonical_url),
    admin.from('deal_reactions').select('user_id, deal_id, reaction, updated_at, created_at').in('user_id', scope.people).eq('deal_id', deal.id),
    admin.from('deal_opens').select('deal_id, opened_at, verified_via').eq('user_id', scope.payerId).eq('deal_id', deal.id).eq('status', 'open'),
    admin.from('sourcing_sent').select('user_id, deal_id').in('user_id', scope.people).eq('deal_id', deal.id).eq('reaction', 'yes'),
  ]);
  for (const r of [rowsRes, reactionRes, openRes, pickRes]) if (r.error) console.warn('[tracked] deal read failed:', r.error.message);
  const items = trackedDeals({
    viewerId: userId,
    pipeline: toPipeline((rowsRes.data ?? []) as Record<string, unknown>[], scope, userId),
    reactions: toReactions((reactionRes.data ?? []) as ReactionRow[], scope, userId),
    opens: ((openRes.data ?? []) as OpenRow[]).map(toOpen),
    pickAnswers: ((pickRes.data ?? []) as { user_id: string; deal_id: string }[]).map((p) => ({ userId: p.user_id, dealId: p.deal_id, reaction: 'yes' as const })),
    deals: new Map([[deal.id, factsOf({ ...deal, price_amount: deal.price_amount, status: deal.status })]]),
  });
  const [view] = forViewer(items, userId);
  const own = items.find((it) => it.userId === userId) ?? (view?.mine ? view : null);
  const candidates = items.filter((it) => it.reportId && it.opened).sort((a, b) => Number(b.userId === userId) - Number(a.userId === userId) || Date.parse(b.lastChangedAt) - Date.parse(a.lastChangedAt));
  return {
    stage: own?.stage ?? KEPT_STATUS,
    tracked: Boolean(own),
    onMyDeals: Boolean(view),
    checkedListingId: own?.checkedListingId ?? null,
    reportCandidates: candidates.map((it) => ({ id: it.reportId!, userId: it.userId })),
  };
}
