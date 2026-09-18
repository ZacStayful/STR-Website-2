/**
 * Daily picks: the pure half of "one sourced property a day". The cron
 * (src/app/api/internal/sourcing/route.ts) decides who gets what; this module
 * builds the house queries for members without a filter, turns feedback into
 * query and candidate rules, renders the pick email, and summarises picks for
 * the admin report. Nothing here touches the network or the database, so it
 * runs under `node --test`.
 */
import { randomBytes } from 'node:crypto';
import type { MarketGoals } from '../market/goals.ts';
import { DEFAULT_GOALS } from '../market/goals.ts';
import { budgetBounds, describeDeal, queryKey, type SourcedListing, type SourcedPick, type SourcingKind, type SourcingQuery } from './sourcing.ts';
import { formatListingPrice } from './format.ts';
import { escapeHtml as esc } from '../email/escape.ts';
import { priceFor } from '../credit/pricing.ts';
import type { UnitCostTable } from '../credit/costs.ts';

export type PickBasis = 'goals' | 'house';
export type PickStatus = 'pending' | 'sent' | 'failed';
export type PickReaction = 'yes' | 'no';
export type ReactionSource = 'link' | 'form';

// ── Tokens and time ──

/** Same shape as a deal-sheet share token (24 random bytes, base64url). */
export const PICK_TOKEN = /^[A-Za-z0-9_-]{24,64}$/;

export function isPickToken(v: unknown): v is string {
  return typeof v === 'string' && PICK_TOKEN.test(v);
}

export function newPickToken(): string {
  return randomBytes(24).toString('base64url');
}

export function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// ── Price of a pick ──

export const PICK_UNIT = { provider: 'pmi', unit: 'daily_pick' } as const;

/** What one pick costs the member, in base pence (raw unit cost × markup). */
export function pickPrice(table: UnitCostTable) {
  return priceFor(table, PICK_UNIT.provider, PICK_UNIT.unit, 1);
}

// ── House queries (members without a usable filter) ──

/** The few card fields the house pick needs; structurally matches AreaCardData. */
export interface HouseAreaCard {
  code: string;
  name: string;
  slug: string;
  score: { score: number } | null;
  confidence: { tier: 'confirmed' | 'building' | 'early' };
}

export const HOUSE_AREAS = 8;

/**
 * The best-scored areas Stayful has real data for, as searches. With goals
 * (a member whose filter names no areas) the member's own kind, budget and
 * bedrooms apply; without, both kinds and no bounds, so the reply to the
 * email ("want to buy / want to rent") can tell us which they meant.
 */
export function houseQueries(cards: HouseAreaCard[], goals: MarketGoals | null, limit = HOUSE_AREAS): SourcingQuery[] {
  const g = goals ?? DEFAULT_GOALS;
  const kinds: SourcingKind[] = goals ? (g.sourcingKind === 'both' ? ['sale', 'rent'] : [g.sourcingKind]) : ['sale', 'rent'];
  const bounds = goals ? budgetBounds(g.budget) : { min: null, max: null };
  const minBedrooms = goals ? g.bedrooms ?? null : null;
  const areas = cards
    .filter((c) => c.score !== null && c.confidence.tier !== 'early')
    .sort((a, b) => b.score!.score - a.score!.score)
    .slice(0, limit);
  const out: SourcingQuery[] = [];
  for (const a of areas) {
    for (const kind of kinds) {
      const minPrice = kind === 'sale' ? bounds.min : null;
      const maxPrice = kind === 'sale' ? bounds.max : goals ? g.maxRentPcm ?? null : null;
      out.push({ key: queryKey(kind, a.code, minPrice, maxPrice, minBedrooms), kind, area: a.code, areaName: a.name, areaSlug: a.slug, minPrice, maxPrice, minBedrooms });
    }
  }
  return out;
}

// ── Feedback ──

export const PICK_REASONS = [
  { key: 'wrong_area', label: 'Wrong area' },
  { key: 'too_expensive', label: 'Too expensive' },
  { key: 'wrong_size', label: 'Wrong size' },
  { key: 'wrong_type', label: 'Wrong type of property' },
  { key: 'poor_return', label: 'Return too low' },
  { key: 'want_r2r', label: 'I want rent-to-rent, not to buy' },
  { key: 'want_buy', label: 'I want to buy, not rent-to-rent' },
  { key: 'seen_it', label: 'Already seen it' },
] as const;

export type PickReason = (typeof PICK_REASONS)[number]['key'];

export function isPickReason(v: unknown): v is PickReason {
  return PICK_REASONS.some((r) => r.key === v);
}

export function cleanReasons(raw: unknown): PickReason[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return [...new Set(list.map((r) => String(r).trim()).filter(isPickReason))];
}

/** What a past pick tells us, as stored on sourcing_sent. */
export interface PickFeedback {
  reaction: PickReaction | null;
  reactionSource: ReactionSource | null;
  reasons: PickReason[];
  kind: SourcingKind | null;
  postcodeArea: string | null;
  bedrooms: number | null;
  /** Sale price or rent pcm, whichever the pick was. */
  amount: number | null;
  rawType: string | null;
}

/**
 * Only feedback the member confirmed counts: a "no" from the reasons form, or
 * any response that carries reasons. A bare link click can come from a mail
 * security scanner, so it never changes anyone's picks.
 */
export function confirmedNegatives(feedback: PickFeedback[]): PickFeedback[] {
  return feedback.filter((f) => f.reaction === 'no' && (f.reactionSource === 'form' || f.reasons.length > 0));
}

/** Kind and area preferences change what we search for, not just what we keep. */
export function applyQueryFeedback(queries: SourcingQuery[], feedback: PickFeedback[]): SourcingQuery[] {
  const neg = confirmedNegatives(feedback);
  if (neg.length === 0) return queries;
  const badAreas = new Set(neg.filter((f) => f.reasons.includes('wrong_area') && f.postcodeArea).map((f) => f.postcodeArea!.toUpperCase()));
  const wantRent = neg.some((f) => f.reasons.includes('want_r2r'));
  const wantBuy = neg.some((f) => f.reasons.includes('want_buy'));
  const out = new Map<string, SourcingQuery>();
  for (const q of queries) {
    if (badAreas.has(q.area.toUpperCase())) continue;
    let kind = q.kind;
    if (wantRent && !wantBuy && kind === 'sale') kind = 'rent';
    if (wantBuy && !wantRent && kind === 'rent') kind = 'sale';
    // A flipped kind loses the other kind's price bounds (a purchase budget is not a rent ceiling).
    const flipped = kind !== q.kind;
    const minPrice = flipped ? null : q.minPrice;
    const maxPrice = flipped ? null : q.maxPrice;
    const key = queryKey(kind, q.area, minPrice, maxPrice, q.minBedrooms);
    if (!out.has(key)) out.set(key, { ...q, key, kind, minPrice, maxPrice });
  }
  return [...out.values()];
}

/** Price, size and type rules keep what we found but drop what the member already said no to. */
export function applyCandidateFeedback<C extends { listing: SourcedListing }>(candidates: C[], feedback: PickFeedback[]): C[] {
  const neg = confirmedNegatives(feedback);
  if (neg.length === 0) return candidates;
  const cap: Partial<Record<SourcingKind, number>> = {};
  for (const f of neg) {
    if (f.reasons.includes('too_expensive') && f.kind && f.amount) cap[f.kind] = Math.min(cap[f.kind] ?? Infinity, Math.round(f.amount * 0.9));
  }
  const badSizes = new Set(neg.filter((f) => f.reasons.includes('wrong_size') && f.bedrooms !== null).map((f) => f.bedrooms!));
  const badTypes = new Set(neg.filter((f) => f.reasons.includes('wrong_type') && f.rawType).map((f) => f.rawType!.toLowerCase()));
  return candidates.filter(({ listing: l }) => {
    const limit = cap[l.kind];
    if (limit && l.price) {
      const amount = l.kind === 'rent' ? (l.price.period === 'pw' ? (l.price.amount * 52) / 12 : l.price.amount) : l.price.amount;
      if (amount > limit) return false;
    }
    if (l.bedrooms !== null && badSizes.has(l.bedrooms)) return false;
    if (l.rawType && badTypes.has(l.rawType.toLowerCase())) return false;
    return true;
  });
}

// ── The email ──

export interface PickEmailInput {
  pick: SourcedPick;
  siteUrl: string;
  /** sourcing_sent.id and .token for the buttons. */
  id: string;
  token: string;
  basis: PickBasis;
  /** describeGoals() chips when the member has a filter. */
  goalsChips: string[];
  /** The member's first ever pick: explain why they are getting it. */
  firstEver: boolean;
  /** What the pick cost them, in base pence (0 for admins). */
  chargedBasePence: number;
}

export function pickLinks(siteUrl: string, id: string, token: string, listingUrl: string) {
  const base = siteUrl.replace(/\/$/, '');
  return {
    yes: `${base}/p/${token}?a=yes`,
    no: `${base}/p/${token}?a=no`,
    save: `${base}/picks?save=${encodeURIComponent(id)}`,
    report: `${base}/estimate?listing=${encodeURIComponent(listingUrl)}`,
    filter: `${base}/markets?goals=1`,
    picks: `${base}/picks`,
    unsubscribe: `${base}/p/${token}?a=unsubscribe`,
    unsubscribePost: `${base}/api/picks/unsubscribe/${token}`,
    listing: listingUrl,
  };
}

/** RFC 8058 one-click headers so mail clients show their own unsubscribe control. */
export function unsubscribeHeaders(links: { unsubscribe: string; unsubscribePost: string }): Record<string, string> {
  return { 'List-Unsubscribe': `<${links.unsubscribePost}>, <${links.unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

function penceLabel(p: number): string {
  return p >= 100 ? `£${(p / 100).toFixed(2)}` : `${Math.round(p)}p`;
}

export function pickLabel(l: SourcedListing): string {
  const bits = [l.bedrooms ? `${l.bedrooms}-bed` : null, l.rawType, formatListingPrice(l.price)].filter(Boolean);
  return `${l.address ?? l.title} — ${bits.join(' · ')}`;
}

export function pickEmail(input: PickEmailInput): { subject: string; text: string; html: string; headers: Record<string, string> } {
  const { pick, basis, goalsChips, firstEver } = input;
  const l = pick.listing;
  const links = pickLinks(input.siteUrl, input.id, input.token, l.canonicalUrl);
  const kindWord = l.kind === 'rent' ? 'rent-to-rent' : 'to buy';
  const subject = `Today's pick ${kindWord}: ${l.bedrooms ? `${l.bedrooms}-bed ` : ''}in ${pick.areaName}${pick.deal ? ` · ${pick.deal.kind === 'purchase' ? `${pick.deal.grossYieldPct.toFixed(1)}% yield` : `£${Math.round(pick.deal.monthlyMargin).toLocaleString('en-GB')}/mo margin`}` : ''}`;
  const why = basis === 'goals' ? `Picked for your filter: ${goalsChips.join(' · ')}.` : `A Stayful house pick from one of the best-scoring areas we track. Set a filter to get picks in your area, budget and size.`;
  const dealLine = pick.deal ? describeDeal(pick.deal) : 'Run a full report for the figures.';
  const intro = firstEver
    ? `Stayful Intelligence now finds you one property a day: the listing that best fits your filter, or a house pick from our best-scoring areas when you have not set one. Each pick uses ${penceLabel(input.chargedBasePence || 10)} of your credit. Turn it off any time with the link at the bottom.`
    : null;
  const costNote = input.chargedBasePence > 0 ? `This pick used ${penceLabel(input.chargedBasePence)} of your credit.` : null;

  const text = [
    `Today's pick from Stayful Intelligence (${kindWord}).`,
    '',
    intro,
    intro ? '' : null,
    pickLabel(l),
    dealLine,
    `Fit ${pick.fit}/100 · ${pick.areaName}`,
    why,
    '',
    `Is this the kind of property you are looking for?`,
    `Yes, more like this: ${links.yes}`,
    `Not for me: ${links.no}`,
    '',
    `Save to my pipeline: ${links.save}`,
    `Full report: ${links.report}`,
    `View listing: ${links.listing}`,
    `Set my filter: ${links.filter}`,
    '',
    'Figures are area averages for the size of property; run a full report before acting on one.',
    costNote,
    `All your picks: ${links.picks}`,
    `Stop daily picks: ${links.unsubscribe}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const btn = (href: string, label: string, primary = false) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 4px 0;padding:10px 16px;border-radius:8px;font-weight:600;text-decoration:none;font-size:14px;${primary ? 'background:#5d8156;color:#fff' : 'background:#eef2ea;color:#2e3d2b'}">${esc(label)}</a>`;
  const photo = l.photo ? `<img src="${esc(l.photo)}" alt="" width="560" style="display:block;width:100%;max-width:560px;border-radius:12px;margin:0 0 14px">` : '';
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#2e3d2b;max-width:560px">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5d8156;font-weight:600">Stayful daily pick · ${esc(kindWord)}</p>
      ${intro ? `<p style="color:#5b6657;font-size:14px;border-left:3px solid #5d8156;padding-left:10px">${esc(intro)}</p>` : ''}
      ${photo}
      <h1 style="font-size:22px;margin:0 0 6px">${esc(l.address ?? l.title)}</h1>
      <p style="margin:0 0 4px;font-weight:600">${esc(pickLabel(l).replace(/^.*? — /, ''))}</p>
      <p style="margin:0 0 4px;color:#5d8156">${esc(dealLine)}</p>
      <p style="margin:0 0 14px;color:#7a8274;font-size:13px">Fit ${pick.fit}/100 · ${esc(pick.areaName)} · ${esc(why)}</p>
      <p style="margin:0 0 6px;font-weight:600">Is this the kind of property you are looking for?</p>
      <p style="margin:0 0 14px">${btn(links.yes, 'Yes, more like this', true)}${btn(links.no, 'Not for me')}</p>
      <p style="margin:0 0 18px">${btn(links.save, 'Save to my pipeline', true)}${btn(links.report, 'Full report')}${btn(links.listing, 'View listing')}${btn(links.filter, basis === 'goals' ? 'Edit my filter' : 'Set my filter')}</p>
      <p style="color:#7a8274;font-size:12px">Figures are area averages for the size of property; run a full report before acting on one.${costNote ? ` ${esc(costNote)}` : ''} See every pick at <a href="${esc(links.picks)}" style="color:#7a8274">${esc(links.picks)}</a>. <a href="${esc(links.unsubscribe)}" style="color:#7a8274">Stop daily picks</a>.</p>
    </div>`.trim();

  return { subject, text, html, headers: unsubscribeHeaders(links) };
}

// ── Admin summary ──

export interface PickRow {
  status: PickStatus;
  kind: SourcingKind | null;
  basis: PickBasis | null;
  postcodeArea: string | null;
  reaction: PickReaction | null;
  reactionSource: ReactionSource | null;
  reasons: PickReason[];
  savedAt: string | null;
  sentAt: string;
}

export interface PickSummary {
  sent: number;
  failed: number;
  responded: number;
  yes: number;
  no: number;
  saved: number;
  byKind: Record<'sale' | 'rent', { sent: number; yes: number; no: number; saved: number }>;
  byBasis: Record<PickBasis, { sent: number; yes: number; no: number; saved: number }>;
  reasons: { key: PickReason; count: number }[];
  areas: { area: string; sent: number; yes: number; no: number }[];
}

export function summarisePicks(rows: PickRow[]): PickSummary {
  const bucket = () => ({ sent: 0, yes: 0, no: 0, saved: 0 });
  const s: PickSummary = { sent: 0, failed: 0, responded: 0, yes: 0, no: 0, saved: 0, byKind: { sale: bucket(), rent: bucket() }, byBasis: { goals: bucket(), house: bucket() }, reasons: [], areas: [] };
  const reasons = new Map<PickReason, number>();
  const areas = new Map<string, { area: string; sent: number; yes: number; no: number }>();
  for (const r of rows) {
    if (r.status === 'failed') {
      s.failed += 1;
      continue;
    }
    if (r.status !== 'sent') continue;
    s.sent += 1;
    const k = r.kind === 'rent' ? s.byKind.rent : s.byKind.sale;
    const b = r.basis === 'house' ? s.byBasis.house : s.byBasis.goals;
    k.sent += 1;
    b.sent += 1;
    const area = r.postcodeArea ? areas.get(r.postcodeArea) ?? { area: r.postcodeArea, sent: 0, yes: 0, no: 0 } : null;
    if (area) {
      area.sent += 1;
      areas.set(area.area, area);
    }
    if (r.reaction) s.responded += 1;
    if (r.reaction === 'yes') {
      s.yes += 1;
      k.yes += 1;
      b.yes += 1;
      if (area) area.yes += 1;
    }
    if (r.reaction === 'no') {
      s.no += 1;
      k.no += 1;
      b.no += 1;
      if (area) area.no += 1;
    }
    if (r.savedAt) {
      s.saved += 1;
      k.saved += 1;
      b.saved += 1;
    }
    for (const reason of r.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  s.reasons = [...reasons.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  s.areas = [...areas.values()].sort((a, b) => b.yes - a.yes || b.sent - a.sent).slice(0, 10);
  return s;
}
