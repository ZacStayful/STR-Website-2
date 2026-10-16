import 'server-only';

/**
 * Batch 27: each step, carried out by the code its button uses (Zac, 29
 * Sep: one path). Nothing here charges, moves a stage or saves an answer
 * itself:
 *
 *   Keep / Pass / stage   setStageForMember (My deals' stage select), which
 *                         keeps an unopened deal to Kept or Passed
 *   full analysis         startDealAnalysis, then the button's own run route
 *   Deep report           the same with PMI; on a deal with its report, the
 *                         button's PMI add-on route
 *   deep search           startDeepSearch and one slice, as /api/deep-search
 *   listing check         checkListingForMember, as /api/listing/resolve;
 *                         Keep then records it with recordCheckedListing
 *   profile change        answerQuestion (the profile editor's own save)
 *
 * Each price is quoted the way its own code will check it, so a step never
 * fails on "the price changed" because the eye priced it differently.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { createAdminClient } from '../supabase/admin';
import { logActivity } from '../activity/log';
import { getBillingSettings, getUnitCostTable } from '../credit/unit-costs';
import { estimateAction } from '../credit/estimate';
import { openCreditBase } from '../credit/deal-pricing';
import { analysisQuote } from '../analysis/deal-analysis-rules';
import { offeredPmiAddonFor, offeredPricesFor } from '../analysis/offers-server';
import { startDealAnalysis } from '../analysis/deal-analysis';
import { existingOpen } from '../marketplace/open';
import { loadDealById } from '../marketplace/server';
import { openPricePence } from '../marketplace/ladder';
import { setDealReaction } from '../marketplace/reactions-server';
import { dealVisibilityFor } from '../marketplace/tier';
import { setStageForMember } from '../listing/stage-server';
import { checkListingForMember, recordCheckedListing } from '../listing/server';
import { SOURCE_LABELS } from '../listing/detect';
import type { ListingSnapshot } from '../listing/types';
import type { QuickEstimate } from '../listing/quick-types';
import type { PipelineStatus } from '../listing/pipeline';
import { getMarketAccess } from '../market/gate';
import { parseMarketGoals } from '../market/goals';
import { BUDGET_CHOICES, BUDGET_LABELS } from '../market/filters';
import { deepQuoteFor, runSearchSlice, searchStatusFor, startDeepSearch, type DeepQuoteView } from '../sourcing-demand/member-search';
import { SEARCH_SLICE_MS } from '../intelligence/config';
import { answerQuestion, matchCountFor, profileSummaryFor } from '../profile/server';
import { applyAnswer, currentValue, questionsFor, type Answers } from '../profile/questions';
import { DEAL_TYPE_LABELS, typesShown } from '../profile/deal-types';
import { activeProfileFor } from '../profiles/server';
import { ACTIVITY_BY, CRITERIA_SAVED_AS, type CriteriaQuestion } from './config';
import { areaCodes, dealTypeOf } from './validate';
import type { StageState } from './undo';

export type Admin = ReturnType<typeof createAdminClient>;

/** Who the eye is acting for: always the session's member. */
export interface ActingMember {
  userId: string;
  email: string | null;
  payerId: string;
  admin: boolean;
  teamMember: boolean;
}

/** The activity extras every action carries (the log's keys are snake_case; event.ts drops anything else). */
export function byEye(instructionId: string, more: Record<string, string | number | boolean | null> = {}): Record<string, string | number | boolean | null> {
  return { ...more, by: ACTIVITY_BY, instruction_id: instructionId };
}

// ── Quotes ──────────────────────────────────────────────────────────────────

/**
 * A Full analysis or Deep report of a deal, quoted exactly as
 * startDealAnalysis checks it: the member's offer price (welcome, first
 * Deep report), less what the team paid to open it, plus the open at its
 * ladder price when it isn't open yet. Null when the deal can't be read.
 */
export async function quoteAnalysis(m: ActingMember, dealId: string, withPmi: boolean): Promise<{ basePence: number; opensDeal: boolean } | null> {
  const admin = createAdminClient();
  const deal = await loadDealById(admin, dealId);
  if (!deal) return null;
  const [settings, open, offered] = await Promise.all([getBillingSettings(), existingOpen(admin, m.payerId, deal.canonical_url), m.admin ? Promise.resolve(null) : offeredPricesFor(m.userId, dealId, withPmi).catch(() => null)]);
  const isOpen = open?.status === 'open';
  const pricing = offered && offered.offer ? { ...settings.dealPricing, fullAnalysisPence: offered.fullPence, pmiAddonPence: offered.pmiPence } : settings.dealPricing;
  const ladder = openPricePence(deal.annual_profit === null ? null : Number(deal.annual_profit), settings.dealOpenLadder);
  const quote = analysisQuote({ admin: m.admin, pricing, opened: isOpen, openPaidBasePence: isOpen ? openCreditBase(open) : 0, openPricePence: ladder, withPmi });
  return { basePence: quote.due.purchaseBasePence, opensDeal: !quote.opened };
}

/** The PMI second opinion added to a finished report: what addSecondOpinion checks. */
export async function quotePmiAddon(m: ActingMember): Promise<number> {
  if (m.admin) return 0;
  const offered = await offeredPmiAddonFor(m.userId).catch(() => null);
  return offered ? offered.pmiPence : (await getBillingSettings()).dealPricing.pmiAddonPence;
}

/** The deep search's own quote (about / up to), and whether one is running. */
export async function quoteDeepSearch(userId: string): Promise<{ quote: DeepQuoteView | null; running: boolean }> {
  const [quote, status] = await Promise.all([deepQuoteFor(userId), searchStatusFor(userId)]);
  return { quote, running: status.running };
}

/** A listing check is metered per provider call: about its typical cost, held at its worst case (the reserve checkListingForMember takes). */
export async function quoteLinkCheck(): Promise<{ aboutBasePence: number; maxBasePence: number }> {
  const e = estimateAction(await getUnitCostTable(), 'quick_view');
  return { aboutBasePence: e.typicalBasePence, maxBasePence: e.maxBasePence };
}

/** The Explorer's own rule for listing checks (Pro, a trial with runs left, an admin). */
export async function mayCheckLinks(): Promise<boolean> {
  try {
    return (await getMarketAccess()).state === 'ok';
  } catch {
    return false;
  }
}

// ── Keep / Pass / stage ─────────────────────────────────────────────────────

/** Where a deal stands for the member: its pipeline row's stage, else their Keep / Pass. */
export async function stageStateOf(admin: Admin, userId: string, dealId: string): Promise<StageState | null> {
  const deal = await loadDealById(admin, dealId);
  if (!deal) return null;
  const [reaction, row] = await Promise.all([
    admin.from('deal_reactions').select('reaction').eq('user_id', userId).eq('deal_id', dealId).maybeSingle(),
    admin.from('checked_listings').select('id, status').eq('user_id', userId).eq('canonical_url', deal.canonical_url).maybeSingle(),
  ]);
  const r = ((reaction.data as { reaction?: string } | null)?.reaction ?? null) as 'keep' | 'pass' | null;
  const own = row.data as { id: string; status: PipelineStatus } | null;
  const stage: PipelineStatus | null = own?.status ?? (r === 'keep' ? 'watching' : r === 'pass' ? 'passed' : null);
  return { stage, reaction: r === 'keep' || r === 'pass' ? r : null, checkedListingId: own ? String(own.id) : null };
}

export type StepResult = { ok: true; before: Record<string, unknown> | null; after: Record<string, unknown> | null } | { ok: false; code: string };

/** Keep, Pass or a stage move, through My deals' own setter; logged as its own kind. */
export async function runStageStep(m: ActingMember, instructionId: string, s: { action: 'keep' | 'pass' | 'stage_move'; dealId: string; stage: PipelineStatus }): Promise<StepResult> {
  const admin = createAdminClient();
  const before = await stageStateOf(admin, m.userId, s.dealId);
  if (!before) return { ok: false, code: 'missing' };
  const out = await setStageForMember({ userId: m.userId, adminUser: m.admin, key: `d-${s.dealId}`, stage: s.stage });
  if (!out.ok) return { ok: false, code: out.code };
  const after = (await stageStateOf(admin, m.userId, s.dealId)) ?? { stage: s.stage, reaction: s.stage === 'passed' ? 'pass' : 'keep', checkedListingId: out.checkedListingId };
  const kind = s.action === 'keep' ? 'keep' : s.action === 'pass' ? 'pass' : 'stage_move';
  logActivity(m.userId, kind, { dealId: s.dealId, extras: byEye(instructionId, { from: before.stage, to: s.stage, item: `d-${s.dealId}` }) });
  return { ok: true, before: { ...before }, after: { ...after } };
}

/** Puts a stage step back (Undo), through the same setters. */
export async function restoreStage(m: ActingMember, instructionId: string, dealId: string, before: StageState, how: 'stage' | 'clear' | 'clear_and_row', rowToRemove: string | null, supabase: SupabaseClient): Promise<boolean> {
  const admin = createAdminClient();
  const now = await stageStateOf(admin, m.userId, dealId);
  if (how === 'stage' && before.stage) {
    const out = await setStageForMember({ userId: m.userId, adminUser: m.admin, key: `d-${dealId}`, stage: before.stage });
    if (!out.ok) return false;
    logActivity(m.userId, before.stage === 'passed' ? 'pass' : before.stage === 'watching' ? 'keep' : 'stage_move', { dealId, extras: byEye(instructionId, { from: now?.stage ?? null, to: before.stage, item: `d-${dealId}`, via: 'undo' }) });
    return true;
  }
  // It wasn't in My deals: take back the Keep / Pass (the card's own Undo), and the row the step made, if it did.
  if (how === 'clear_and_row' && rowToRemove) {
    const { error } = await supabase.from('checked_listings').delete().eq('id', rowToRemove).eq('user_id', m.userId);
    if (error) return false;
    logActivity(m.userId, 'listing_removed', { extras: byEye(instructionId, { item: `l-${rowToRemove}`, via: 'undo' }) });
  }
  const visibility = await dealVisibilityFor(m.userId, m.admin);
  const res = await setDealReaction(m.userId, dealId, null, visibility);
  if (!res.ok) return false;
  logActivity(m.userId, 'reaction_clear', { dealId, extras: byEye(instructionId, { via: 'undo' }) });
  return true;
}

// ── Profile changes ─────────────────────────────────────────────────────────

export interface CriteriaPreview {
  savedAs: 'bedrooms' | 'budget' | 'max_rent' | 'min_profit' | 'r2r_min_profit' | 'property_type' | 'deal_types' | 'where';
  value: unknown;
  before: unknown;
  label: string;
  countBefore: number | null;
  countAfter: number | null;
  profileId: string | null;
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
const asNumber = (v: string): number | null => {
  const s = v.trim().toLowerCase().replace(/[£,\s]/g, '').replace(/pcm|amonth|pm$/g, '');
  const m = /^(\d+(?:\.\d+)?)(k)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) ? n : null;
};

/** The new value a change makes from the member's answers, with its words; or why it can't. */
function nextValue(q: CriteriaQuestion, raw: string, a: Answers): { value: unknown; label: string } | { reason: 'bad_value' | 'already_there' | 'not_areas_mode' } {
  switch (q) {
    case 'bedrooms': {
      const n = asNumber(raw.replace(/\+|beds?|bedrooms?/gi, ''));
      if (n !== 1 && n !== 2 && n !== 3 && n !== 4) return { reason: 'bad_value' };
      return { value: n, label: `Bedrooms: ${n === 4 ? '4 or more' : `${n} bed`}` };
    }
    case 'budget': {
      const v = raw.trim();
      if (!(BUDGET_CHOICES as readonly string[]).includes(v)) return { reason: 'bad_value' };
      return { value: v, label: `Budget: ${BUDGET_LABELS[v as keyof typeof BUDGET_LABELS]}` };
    }
    case 'max_rent': {
      const n = asNumber(raw);
      if (n === null) return { reason: 'bad_value' };
      return { value: Math.round(n), label: `Most rent: ${gbp(n)} a month` };
    }
    case 'min_profit':
    case 'r2r_min_profit': {
      const n = asNumber(raw);
      if (n === null) return { reason: 'bad_value' };
      return { value: Math.round(n), label: `${q === 'r2r_min_profit' ? 'Rent-to-rent minimum profit' : 'Minimum profit'}: ${gbp(n)} a month` };
    }
    case 'property_type': {
      const v = raw.trim().toLowerCase();
      if (v !== 'flat' && v !== 'house' && v !== 'either') return { reason: 'bad_value' };
      return { value: v, label: `Property type: ${v === 'either' ? 'flat or house' : v}` };
    }
    case 'add_deal_type':
    case 'remove_deal_type': {
      const type = dealTypeOf(raw);
      if (!type) return { reason: 'bad_value' };
      const shown = typesShown({ goals: a.goals, about: a.about }) as string[];
      const next = q === 'add_deal_type' ? (shown.includes(type) ? null : [...shown, type]) : shown.filter((t) => t !== type);
      if (next === null) return { reason: 'already_there' };
      if (next.length === 0 || next.length === shown.length) return { reason: q === 'remove_deal_type' && next.length === shown.length ? 'already_there' : 'bad_value' };
      return { value: next, label: `Deal types: ${next.map((t) => DEAL_TYPE_LABELS[t as keyof typeof DEAL_TYPE_LABELS] ?? t).join(', ')}` };
    }
    case 'add_areas': {
      const where = currentValue('where', a) as { mode?: string; areas?: string[] } | null;
      if (!where || where.mode !== 'areas') return { reason: 'not_areas_mode' };
      const current = Array.isArray(where.areas) ? where.areas : [];
      const extra = areaCodes(raw).filter((x) => !current.includes(x));
      if (extra.length === 0) return { reason: 'already_there' };
      const areas = [...current, ...extra];
      return { value: { ...where, mode: 'areas', areas }, label: `Areas: ${areas.join(', ')}` };
    }
  }
}

/**
 * What a profile change would do, worked out without saving it: the new
 * value, its words, and the match count before and after (matchCountFor,
 * the count the profile editor shows). Read with no cache, so a second
 * change in the same instruction sees the first.
 */
export async function previewCriteria(m: ActingMember, q: CriteriaQuestion, raw: string): Promise<CriteriaPreview | { reason: 'bad_value' | 'already_there' | 'not_areas_mode' | 'failed'; message?: string }> {
  const s = await profileSummaryFor(m.userId);
  if (!s) return { reason: 'failed' };
  const savedAs = CRITERIA_SAVED_AS[q];
  if (!questionsFor(s.answers).some((x) => x.id === savedAs)) return { reason: 'bad_value', message: 'Your profile doesn’t ask that.' };
  const next = nextValue(q, raw, s.answers);
  if ('reason' in next) return next;
  const applied = applyAnswer(savedAs, next.value, s.answers);
  if (!applied.ok) return { reason: 'bad_value', message: applied.error };
  const [countBefore, countAfter, active] = await Promise.all([
    matchCountFor({ userId: m.userId, email: m.email, answers: s.answers, answered: s.quiz.answered }).catch(() => null),
    matchCountFor({ userId: m.userId, email: m.email, answers: applied.answers, answered: s.quiz.answered }).catch(() => null),
    activeProfileFor(m.userId).catch(() => null),
  ]);
  return { savedAs, value: next.value, before: currentValue(savedAs, s.answers), label: next.label, countBefore, countAfter, profileId: active?.id ?? null };
}

/** Saves a change through the profile editor's own save; the count after is the one it worked out. */
/** answerQuestion's words when the save itself failed (our side), as against a value the profile can't take. */
const SAVE_FAILED = /cannot be saved right now|could not save/i;

export async function applyCriteria(m: ActingMember, supabase: SupabaseClient, savedAs: string, value: unknown): Promise<{ ok: true; countAfter: number | null } | { ok: false; error: string; ours: boolean }> {
  const r = await answerQuestion({ userId: m.userId, email: m.email, supabase, questionId: savedAs, value, notSure: false, editing: true });
  return r.ok ? { ok: true, countAfter: r.view.matchCount } : { ok: false, error: r.error, ours: SAVE_FAILED.test(r.error) };
}

/** The member's answer to a question now (for Undo's changed-since check), and the active profile. */
export async function criteriaNow(userId: string, savedAs: string): Promise<{ value: unknown; profileId: string | null } | null> {
  const [s, active] = await Promise.all([profileSummaryFor(userId), activeProfileFor(userId).catch(() => null)]);
  if (!s) return null;
  return { value: currentValue(savedAs as Parameters<typeof currentValue>[0], s.answers), profileId: active?.id ?? null };
}

// ── Charged steps ───────────────────────────────────────────────────────────

/** What the page runs next through the button's own route, when a step is started here. */
export type HandOut = { kind: 'analysis'; stepId: string; dealId: string; purchaseId: string } | { kind: 'pmi'; stepId: string; reportId: string; quotedBasePence: number };

export type ChargedStart =
  | { ok: true; handOut: HandOut | null; ledgerRef: string | null; after: Record<string, unknown> | null; payload?: Record<string, unknown> | null; done: boolean }
  | { ok: false; code: string; requiredPence?: number; availablePence?: number };

/** A Full analysis or a Deep report with no report yet: started (and any open charged) by startDealAnalysis; the run is the button's own route. */
export async function startAnalysis(m: ActingMember, supabase: SupabaseClient, stepId: string, s: { dealId: string; withPmi: boolean; quotedBasePence: number }): Promise<ChargedStart> {
  const r = await startDealAnalysis({ supabase, userId: m.userId, adminUser: m.admin, dealId: s.dealId, withPmi: s.withPmi, quotedBasePence: s.quotedBasePence });
  if (r.ok) return { ok: true, handOut: { kind: 'analysis', stepId, dealId: s.dealId, purchaseId: r.purchaseId }, ledgerRef: r.purchaseId, after: null, done: false };
  if (r.code === 'already_done') return { ok: true, handOut: null, ledgerRef: null, after: r.reportId ? { reportId: r.reportId } : null, done: true };
  return { ok: false, code: r.code, requiredPence: (r as { requiredPence?: number }).requiredPence, availablePence: (r as { availablePence?: number }).availablePence };
}

/** The PMI add-on to a finished report: the button's own route runs it (it checks the price, charges and writes). */
export function handOutPmi(stepId: string, reportId: string, quotedBasePence: number): ChargedStart {
  return { ok: true, handOut: { kind: 'pmi', stepId, reportId, quotedBasePence }, ledgerRef: reportId, after: { reportId }, done: false };
}

/** The deep search, started as /api/deep-search starts it; its first slice runs after the reply, the cron does the rest. */
export async function startSearch(m: ActingMember, upToBasePence: number): Promise<ChargedStart> {
  const r = await startDeepSearch(m.userId, upToBasePence);
  if (!r.ok) return { ok: false, code: r.reason === 'credit' ? 'insufficient_credit' : r.reason === 'quote_changed' ? 'price_changed' : r.reason === 'busy' ? 'running' : r.reason === 'off' ? 'unavailable' : 'failed' };
  after(() => runSearchSlice(r.id, { deadlineMs: SEARCH_SLICE_MS }).then(() => undefined));
  return { ok: true, handOut: null, ledgerRef: r.id, after: null, done: false };
}

async function goalsFor(supabase: SupabaseClient, userId: string) {
  try {
    const { data } = await supabase.from('profiles').select('market_goals').eq('id', userId).single();
    return parseMarketGoals(data?.market_goals);
  } catch {
    return null;
  }
}

/** What the card shows of a checked listing: the site, the place, the price and the quick view's income. */
export function listingLines(snap: ListingSnapshot, quick: QuickEstimate | null): { title: string; lines: string[] } {
  const lines: string[] = [];
  const what = [snap.bedrooms !== undefined ? `${snap.bedrooms} bed` : null, snap.rawType?.toLowerCase() ?? null].filter(Boolean).join(' ');
  lines.push([SOURCE_LABELS[snap.source] ?? snap.source, what || null, snap.outcode ?? null].filter(Boolean).join(' · '));
  const per: Record<string, string> = { total: '', pcm: ' a month', pw: ' a week', night: ' a night' };
  if (snap.price) lines.push(`${snap.price.qualifier ? `${snap.price.qualifier} ` : ''}${gbp(snap.price.amount)}${per[snap.price.period] ?? ''}`);
  const e = quick?.estimate;
  if (e) lines.push(`Short-let income about ${gbp(e.grossRevenue)} a year${e.occupancy !== null ? ` at ${Math.round(e.occupancy)}% occupancy` : ''}`);
  else lines.push('No short-let estimate for it yet.');
  if (quick?.limited) lines.push('Some figures weren’t available just now.');
  return { title: snap.title || 'The listing', lines };
}

/** A pasted link, checked as the Explorer's paste box checks it (metered, its own price), not saved until Keep. */
export async function checkLink(m: ActingMember, supabase: SupabaseClient, instructionId: string, url: string): Promise<ChargedStart> {
  const goals = await goalsFor(supabase, m.userId);
  const out = await checkListingForMember(url, { userId: m.userId, goals, save: false, adminUser: m.admin });
  if (!out.ok) {
    if (out.code === 'insufficient_credit') return { ok: false, code: 'insufficient_credit', requiredPence: (out as { requiredPence?: number }).requiredPence, availablePence: (out as { availablePence?: number }).availablePence };
    return { ok: false, code: out.code };
  }
  logActivity(m.userId, 'listing_check', { extras: byEye(instructionId) });
  const shown = listingLines(out.body.snapshot, out.body.quick);
  return { ok: true, handOut: null, ledgerRef: null, after: { ...shown, source: out.body.snapshot.source, keepable: true }, payload: { snapshot: out.body.snapshot, quick: out.body.quick }, done: true };
}

/** Keep on a checked listing: recorded in My deals (Kept) exactly as the Explorer records a check. */
export async function keepCheckedListing(m: ActingMember, instructionId: string, payload: Record<string, unknown>): Promise<string | null> {
  const snap = payload.snapshot as ListingSnapshot | undefined;
  if (!snap || typeof snap !== 'object' || !snap.canonicalUrl) return null;
  const id = await recordCheckedListing(m.userId, snap, (payload.quick as QuickEstimate | null) ?? null);
  if (id) logActivity(m.userId, 'keep', { extras: byEye(instructionId, { item: `l-${id}` }) });
  return id;
}

/** Undo of that Keep: the row it made comes out of My deals again (the Explorer's own Remove). */
export async function unkeepCheckedListing(m: ActingMember, instructionId: string, supabase: SupabaseClient, checkedListingId: string): Promise<boolean> {
  const { error } = await supabase.from('checked_listings').delete().eq('id', checkedListingId).eq('user_id', m.userId);
  if (error) return false;
  logActivity(m.userId, 'listing_removed', { extras: byEye(instructionId, { item: `l-${checkedListingId}`, via: 'undo' }) });
  return true;
}
