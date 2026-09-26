import 'server-only';

/**
 * The reads behind My deals: what trackedDeals (tracked.ts) merges, loaded
 * for one person (or their team) with the service role and scoped by id.
 *
 * Who is in scope mirrors Team reports (saved_searches' RLS): a report
 * belongs to the team owner's account, and the owner and every ACTIVE member
 * see all of the team's; a suspended member sees only their own. Here, for
 * scope 'team', the owner and active members see every deal anyone on the
 * team tracks; a suspended member, or scope 'own', sees only their own
 * stages. Opens are the team's either way (deal_opens.user_id is the owner
 * who paid), exactly as on /deals.
 *
 * The early-access window (src/lib/marketplace/visibility.ts) applies to a
 * deal nobody on the team has opened: inside it, a kept deal is left out for
 * an account that has never paid, as it is on the grid.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { payerFor, teamMembersOf, teamOf } from '../team';
import { CARD_COLUMNS, type DealCard } from '../marketplace/grid';
import { dealVisible, type DealVisibility } from '../marketplace/visibility';
import { dealVisibilityFor } from '../marketplace/tier';
import { loadSourcedListings } from '../marketplace/server';
import { isPipelineStatus, KEPT_STATUS, toCheckedListingRow, type PipelineStatus } from './pipeline';
import { forViewer, trackedDeals, type TrackedDeal, type TrackedDealFacts, type TrackedOpenInput, type TrackedPickAnswerInput, type TrackedPipelineInput, type TrackedReactionInput, type ViewerDeal } from './tracked';

const PAGE = 1000;
/** Rows read per store and scope. My deals is a working list, not an archive; the Explorer reads 200. */
const MAX_ROWS = 2000;
const ID_CHUNK = 150;

const PIPELINE_COLUMNS = 'id, user_id, canonical_url, source, kind, postcode, postcode_area, lat, lng, snapshot, status, notes, share_token, analysed_report_id, listing_status, updated_at';

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

async function paged<T>(label: string, run: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await run(from, Math.min(from + PAGE, MAX_ROWS) - 1);
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

/** Who is in scope for this person. */
export async function trackedScope(userId: string, scope: 'own' | 'team'): Promise<{ people: string[]; payerId: string }> {
  const payer = await payerFor(userId);
  if (scope === 'own') return { people: [userId], payerId: payer.payerId };
  const team = await teamOf(userId);
  // A suspended member sees their own, as with reports.
  if (team.suspended) return { people: [userId], payerId: payer.payerId };
  const members = await teamMembersOf(payer.payerId);
  const people = [...new Set([userId, payer.payerId, ...members])];
  return { people, payerId: payer.payerId };
}

async function loadCards(admin: Admin, ids: string[], urls: string[]): Promise<Map<string, TrackedCard & { canonical_url: string }>> {
  const out = new Map<string, TrackedCard & { canonical_url: string }>();
  const cols = `${CARD_COLUMNS}, photo, canonical_url, retired_reason, retired_at`;
  const take = (rows: unknown[] | null) => {
    for (const { photo, ...card } of (rows ?? []) as (TrackedCard & { canonical_url: string; photo: string | null })[]) out.set(card.id, { ...card, has_photo: Boolean(photo) });
  };
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('marketplace_deals').select(cols).in('id', ids.slice(i, i + ID_CHUNK));
    if (error) console.warn('[tracked] deals by id failed:', error.message);
    take(data);
  }
  for (let i = 0; i < urls.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('marketplace_deals').select(cols).in('canonical_url', urls.slice(i, i + ID_CHUNK));
    if (error) console.warn('[tracked] deals by url failed:', error.message);
    take(data);
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
  const { people, payerId } = await trackedScope(userId, opts.scope ?? 'team');

  const [pipelineRaw, reactionRaw, openRaw, pickRaw] = await Promise.all([
    paged<Record<string, unknown>>('pipeline', (from, to) => admin.from('checked_listings').select(PIPELINE_COLUMNS).in('user_id', people).order('updated_at', { ascending: false }).order('id', { ascending: true }).range(from, to)),
    paged<{ user_id: string; deal_id: string; reaction: string; updated_at: string }>('reactions', (from, to) => admin.from('deal_reactions').select('user_id, deal_id, reaction, updated_at').in('user_id', people).order('updated_at', { ascending: false }).order('deal_id', { ascending: true }).range(from, to)),
    paged<{ deal_id: string; opened_at: string; verified_via: string | null }>('opens', (from, to) => admin.from('deal_opens').select('deal_id, opened_at, verified_via').eq('user_id', payerId).eq('status', 'open').order('opened_at', { ascending: false }).order('deal_id', { ascending: true }).range(from, to)),
    paged<{ user_id: string; deal_id: string; reaction: string | null }>('pick answers', (from, to) => admin.from('sourcing_sent').select('user_id, deal_id, reaction').in('user_id', people).eq('reaction', 'yes').not('deal_id', 'is', null).order('sent_at', { ascending: false }).order('canonical_url', { ascending: true }).range(from, to)),
  ]);

  const pipeline: TrackedPipelineInput[] = [];
  for (const raw of pipelineRaw) {
    const r = toCheckedListingRow(raw);
    if (r && typeof raw.user_id === 'string') pipeline.push({ ...r, userId: raw.user_id });
  }
  const reactions: TrackedReactionInput[] = reactionRaw.filter((r) => r.reaction === 'keep' || r.reaction === 'pass').map((r) => ({ userId: r.user_id, dealId: r.deal_id, reaction: r.reaction as 'keep' | 'pass', updatedAt: r.updated_at }));
  const opens: TrackedOpenInput[] = openRaw.map((o) => ({ dealId: o.deal_id, openedAt: o.opened_at, viaPick: o.verified_via === 'pick' }));
  const pickAnswers: TrackedPickAnswerInput[] = pickRaw.map((p) => ({ userId: p.user_id, dealId: p.deal_id, reaction: p.reaction === 'yes' ? 'yes' : null }));

  const rowUrls = new Set(pipeline.map((r) => r.canonicalUrl));
  const openedIds = new Set(opens.map((o) => o.dealId));
  const loaded = await loadCards(admin, [...new Set([...reactions.map((r) => r.dealId), ...opens.map((o) => o.dealId)])], [...rowUrls]);

  // What trackedDeals may use. A deal nobody opened, that no row of theirs
  // points at, and that is still inside this account's early-access window
  // is left out, so a kept deal cannot surface before the grid shows it.
  const deals = new Map<string, TrackedDealFacts>();
  const cards = new Map<string, TrackedCard>();
  for (const [id, c] of loaded) {
    if (!openedIds.has(id) && !rowUrls.has(c.canonical_url) && !dealVisible(c.live_since ?? null, visibility.cutoffIso)) continue;
    const amount = c.price_amount === null ? NaN : Number(c.price_amount);
    deals.set(id, {
      id,
      canonicalUrl: c.canonical_url,
      kind: c.kind === 'rent' ? 'rent' : 'sale',
      postcodeArea: c.postcode_area,
      price: Number.isFinite(amount) && amount > 0 ? { amount, period: c.price_period ?? (c.kind === 'rent' ? 'pcm' : 'total') } : null,
      status: c.status,
    });
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

/** One deal, for its own page: this person's stage, whether it is on their My deals, and any report to open. */
export interface DealTracking {
  stage: PipelineStatus;
  /** On this person's My deals (their own row, reaction, or an open that counts). */
  tracked: boolean;
  checkedListingId: string | null;
  /** Report ids from the pipeline rows in scope, this person's first, then the team's most recent. Not checked to exist. */
  reportCandidates: { id: string; userId: string }[];
}

/**
 * The same rules as trackedDeals, for one deal. `canonicalUrl` is read
 * server-side only. A pick's automatic open counts once someone in scope
 * said yes to it, as on My deals.
 */
export async function dealTrackingFor(input: { userId: string; dealId: string; canonicalUrl: string; opened: boolean; openViaPick: boolean }): Promise<DealTracking> {
  const none: DealTracking = { stage: KEPT_STATUS, tracked: false, checkedListingId: null, reportCandidates: [] };
  if (!hasServiceRole()) return none;
  const admin = createAdminClient();
  const { people } = await trackedScope(input.userId, 'team');
  const [rowsRes, reactionRes, pickRes] = await Promise.all([
    admin.from('checked_listings').select('id, user_id, status, analysed_report_id, updated_at').in('user_id', people).eq('canonical_url', input.canonicalUrl).order('updated_at', { ascending: false }),
    admin.from('deal_reactions').select('reaction').eq('user_id', input.userId).eq('deal_id', input.dealId).maybeSingle(),
    input.openViaPick ? admin.from('sourcing_sent').select('user_id').in('user_id', people).eq('deal_id', input.dealId).eq('reaction', 'yes').limit(1) : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  if (rowsRes.error) console.warn('[tracked] deal rows read failed:', rowsRes.error.message);
  const rows = (rowsRes.data ?? []) as { id: string; user_id: string; status: unknown; analysed_report_id: string | null }[];
  const own = rows.find((r) => r.user_id === input.userId) ?? null;
  const reaction = (reactionRes.data as { reaction?: unknown } | null)?.reaction;
  const pickYes = (pickRes.data ?? []).length > 0;
  const stage: PipelineStatus = own ? (isPipelineStatus(own.status) ? own.status : KEPT_STATUS) : reaction === 'pass' ? 'passed' : KEPT_STATUS;
  const ordered = own ? [own, ...rows.filter((r) => r !== own)] : rows;
  return {
    stage,
    tracked: Boolean(own || reaction === 'keep' || reaction === 'pass' || (input.opened && (!input.openViaPick || pickYes))),
    checkedListingId: own?.id ?? null,
    reportCandidates: ordered.filter((r) => r.analysed_report_id).map((r) => ({ id: r.analysed_report_id!, userId: r.user_id })),
  };
}
