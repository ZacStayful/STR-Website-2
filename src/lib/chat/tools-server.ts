import 'server-only';

/**
 * Batch 26: the full view's look-ups. Every one is read-only and runs for
 * the member the route took from the session (ChatTools is built per
 * question from it); nothing the model passes can name another member.
 *
 * What a look-up may return:
 *   - only deals the member can see (their deal visibility: a free member
 *     never sees a deal inside the 48-hour delay, by list or by id; an
 *     unknown deal and a hidden one answer the same "not available")
 *   - card-level facts as the app shows them, and a report's figures only
 *     for a deal the member has opened or analysed
 *   - never an address, a full postcode or a listing link, opened or not
 *     (the deal page shows those; the "Open deal" button goes there)
 * Every figure is formatted here, the way the app writes it, so the answer
 * can quote it exactly (the figure guard checks it did).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../supabase/admin';
import { dealCardsByIds } from '../marketplace/queries';
import { cardStatesFor, cardViewsFor } from '../marketplace/card-state';
import type { CardView } from '../marketplace/card-view';
import { describeType, priceLine, type DealCard } from '../marketplace/grid';
import { cashBuyerOf } from '../marketplace/most-you-can-pay';
import { withTailoring } from '../tailoring/numbers';
import { usesTailoring } from '../tailoring/profile';
import { getAreaCardsWithin } from '../market/cached';
import { loadTrackedDeals } from '../listing/tracked-server';
import { PIPELINE_STATUSES } from '../listing/pipeline';
import { groupByStage } from '../listing/tracked';
import { offMarketReason } from '../pipeline/facts';
import { proposeActions } from '../si-actions/plan-server';
import { draftMessage } from '../si-actions/draft-server';
import type { DraftView } from '../si-actions/view';
import { fileMemberBug } from '../si-actions/report-server';
import { checkFigures, allowedFigures } from './guard';
import { todayKey } from '../today/day';
import { todaysPick, checkedCountFor } from '../today/selection';
import { checkedLine } from '../today/checked';
import { whatIfViewFor } from '../intelligence/what-if-server';
import { deepQuoteFor, searchStatusFor } from '../sourcing-demand/member-search';
import { dealTypesFor, DEAL_TYPE_LABELS } from '../profile/deal-types';
import { BUDGET_LABELS } from '../market/filters';
import { memberReasonLabel, memberCallStatusLabel } from '../standout/reasons';
import { ukDay } from '../activity/week';
import { londonDayStart } from '../leads/search';
import { CALL_TYPE_LABEL, type CallType } from '../voice/config';
import { formatPence } from '../credit/deal-pricing';
import { checkFact } from '../knowledge/facts-rules';
import { MAX_LIST_DEALS, MAX_TOOL_RESULT_CHARS } from './config';
import { balanceLabel } from './format';
import { buildButton, type ChatButton } from './actions';
import type { ChatContext } from './context-server';
import type { ChatMember } from './turns-server';
import { lookUpKnowledge } from './knowledge-server';
import type { ToolInput } from './tools';

const AREA_WAIT_MS = 1_500;

const gbp = (n: number | null | undefined): string | null => (typeof n === 'number' && Number.isFinite(n) ? `£${Math.round(n).toLocaleString('en-GB')}` : null);
const pct = (n: number | null | undefined, scale = 1): string | null => (typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * scale)}%` : null);

/** What one answer's look-ups have shown, so its buttons can only point at those. */
export interface AnswerState {
  deals: Set<string>;
  whatIfs: Set<string>;
  showMe: Set<string>;
  deepSearchOffered: boolean | null;
  buttons: ChatButton[];
  factProposal: string | null;
  toolsUsed: string[];
  knowledgeSlug: string | null;
  /** The matcher's best score across this answer's knowledge look-ups. */
  matchConfidence: number | null;
  /** Every tool result, for the figure guard: an answer may only quote these. */
  sources: string[];
  /** Batch 27: this answer proposed an instruction (src/lib/si-actions); it runs once the answer is delivered. */
  instruction: boolean;
  /** Batch 27: a drafted agent message, for the member to copy and send. Never stored, never seen by the model. */
  draft: DraftView | null;
  /** Batch 27: a bug the eye filed for the member (Batch 18's #ref). Such a question isn't charged (Zac, 11 Oct). */
  report: { kind: 'bug'; ref: number } | null;
  /** Batch 27: a feature request for the member to send from its card (the feedback form, filled in). */
  featureRequest: string | null;
  /** Batch 27: tap choices when it was unclear what they meant. */
  choices: string[];
}

export function newAnswerState(): AnswerState {
  return { deals: new Set(), whatIfs: new Set(), showMe: new Set(), deepSearchOffered: null, buttons: [], factProposal: null, toolsUsed: [], knowledgeSlug: null, matchConfidence: null, sources: [], instruction: false, draft: null, report: null, featureRequest: null, choices: [] };
}

/** Batch 27: what the action tools need besides the member: the question itself and its hold. */
export interface ToolTurn {
  /** The question's chat_turns.id (the instruction's id, the report's retry key). */
  turnId: string;
  /** The member's own words. */
  question: string;
  email: string | null;
  /** The question's hold, base pence: kept out of what its actions may spend. */
  holdPence: number;
  userAgent: string | null;
}

export interface ChatTools {
  run(input: ToolInput, state: AnswerState): Promise<string>;
}

/** One deal as the chat may describe it: the card's own words and figures, never where exactly. */
function dealFacts(card: DealCard, view: CardView | undefined): Record<string, unknown> {
  return {
    deal_id: card.id,
    type: card.kind === 'rent' ? 'rent-to-rent' : 'to buy',
    property: describeType(card),
    where: [card.town, card.outcode].filter(Boolean).join(' · ') || null,
    price: priceLine(card),
    profit: view?.range ? `${view.range.label} (${view.range.basis})` : null,
    profit_basis: view?.caption ?? null,
    cash_needed: view?.cash ?? null,
    vs_long_let: view?.uplift ?? null,
    works: view?.projectLine ?? null,
    match: view?.explanation?.match ?? null,
    why_on_list: view?.explanation?.why ?? null,
    numbers: view?.numbers?.map((n) => `${n.label}: ${n.value}`) ?? [],
    opened: view?.opened ?? false,
    analysed: view?.analysed ?? false,
    full_analysis_price: view?.fullAnalysis?.main || null,
  };
}

function capped(value: unknown): string {
  const s = JSON.stringify(value);
  return s.length <= MAX_TOOL_RESULT_CHARS ? s : `${s.slice(0, MAX_TOOL_RESULT_CHARS)}…(cut)`;
}

export function chatTools(member: ChatMember, ctx: ChatContext, supabase: SupabaseClient, now: Date, turn: ToolTurn | null = null): ChatTools {
  const admin = createAdminClient();
  const acting = { userId: member.userId, email: turn?.email ?? null, payerId: member.payerId, admin: member.admin, teamMember: member.teamMember };
  const finance = ctx.member.goals?.finance ?? null;
  const cashBuyer = cashBuyerOf(ctx.member.goals);

  async function views(cards: DealCard[]): Promise<Map<string, CardView>> {
    if (cards.length === 0) return new Map();
    const [base, snapshot] = await Promise.all([cardViewsFor({ supabase: supabase as never, userId: member.userId, adminUser: member.admin, cards, finance, cashBuyer }), getAreaCardsWithin(AREA_WAIT_MS)]);
    return withTailoring(base, cards, ctx.member.tailoring ?? null, snapshot, now, { why: true });
  }

  async function cardsInOrder(ids: string[]): Promise<DealCard[]> {
    if (ids.length === 0) return [];
    const cards = await dealCardsByIds(ids, ctx.member.visibility);
    const by = new Map(cards.map((c) => [c.id, c]));
    return ids.map((id) => by.get(id)).filter((c): c is DealCard => Boolean(c));
  }

  const tools: Record<ToolInput['tool'], (input: never, state: AnswerState) => Promise<unknown>> = {
    async search_knowledge(input: { question: string }, state) {
      const k = await lookUpKnowledge(input.question, ctx.values, admin);
      state.matchConfidence = Math.max(state.matchConfidence ?? 0, k.topConfidence);
      if (k.answers.length === 0) {
        // R3-33: covered, but not for this member: say so (with the entry as the reference), not "I don't know".
        if (k.hidden) {
          state.knowledgeSlug ??= k.hidden;
          return { found: false, note: "There is an approved answer to this, but it doesn't apply to this member's account. Tell them that in one sentence; don't guess the answer." };
        }
        return { found: false };
      }
      state.knowledgeSlug ??= k.answers[0].slug;
      return { found: true, answers: k.answers.map((a) => ({ slug: a.slug, question: a.question, answer: a.answer })) };
    },

    async my_profile_summary() {
      const p = ctx.profile;
      if (!p) return { profile: null, note: 'They have no search profile yet.' };
      const goals = p.goals;
      const { data: others } = await admin.from('search_profiles').select('name, paused_at').eq('user_id', member.userId).is('deleted_at', null).neq('id', p.id).order('created_at');
      // R3-117: with the profile's About answers, as Today and the standout read it.
      const types = dealTypesFor({ goals, about: ctx.member.tailoring?.about ?? null });
      return {
        name: p.name,
        paused: ctx.paused,
        deal_types: types.map((t) => DEAL_TYPE_LABELS[t] ?? t),
        budget: goals?.budget ? (BUDGET_LABELS[goals.budget] ?? goals.budget) : null,
        max_rent: gbp(goals?.maxRentPcm ?? null) ? `${gbp(goals?.maxRentPcm ?? null)} pcm` : null,
        areas: p.areas.length > 0 ? p.areas : null,
        where: goals?.where ?? null,
        bedrooms: goals?.bedrooms ?? null,
        minimum_profit: gbp(goals?.finance?.targetMarginPcm ?? null) ? `${gbp(goals?.finance?.targetMarginPcm ?? null)} a month` : null,
        other_profiles: ((others ?? []) as { name: string; paused_at: string | null }[]).map((o) => (o.paused_at ? `${o.name} (paused)` : o.name)),
      };
    },

    async todays_picks(_input: never, state) {
      const day = todayKey(now);
      const profileId = ctx.profile?.id ?? null;
      const list = profileId
        ? await admin.from('profile_today_lists').select('deal_ids').eq('profile_id', profileId).eq('day', day).maybeSingle()
        : await admin.from('today_selections').select('deal_ids').eq('user_id', member.userId).eq('day', day).maybeSingle();
      const pick = await todaysPick(member.userId, now, profileId);
      const stored = list.data ? (((list.data as { deal_ids: string[] | null }).deal_ids ?? []) as string[]) : null;
      if (stored === null && !pick) return { ready: false, note: "Today's list isn't chosen yet: it is when they open Today." };
      const ids = [...new Set([...(pick?.dealId ? [pick.dealId] : []), ...(stored ?? [])])].slice(0, MAX_LIST_DEALS);
      const cards = await cardsInOrder(ids);
      const v = await views(cards);
      for (const c of cards) state.deals.add(c.id);
      return { ready: true, deals: cards.map((c) => dealFacts(c, v.get(c.id))) };
    },

    async my_deals(input: { stage: string | null }, state) {
      const load = await loadTrackedDeals(member.userId, { scope: 'own', adminUser: member.admin });
      // Batch 27: in the order My deals shows them (by stage, then most recently changed first), so "my top 3" is its first three.
      const ordered = groupByStage(load.view).flatMap((g) => g.items);
      const rows = ordered.filter((d) => d.dealId && (input.stage ? d.stage === input.stage : d.stage !== 'passed')).slice(0, MAX_LIST_DEALS);
      const cards = rows.map((d) => load.cards.get(d.dealId!)).filter((c): c is NonNullable<typeof c> => Boolean(c));
      const v = await views(cards);
      for (const c of cards) state.deals.add(c.id);
      return {
        deals: rows.map((d) => {
          const card = load.cards.get(d.dealId!);
          // Batch 27: whether it has gone off the market (sold, under offer, let agreed, removed), as the next-step slot says it.
          const off = card ? offMarketReason({ dealStatus: card.status, retiredReason: card.retired_reason ?? null }) : null;
          return { stage: PIPELINE_STATUSES.find((x) => x.key === d.stage)?.label ?? d.stage, off_market: off ? off.replace(/_/g, ' ') : null, ...(card ? dealFacts(card, v.get(card.id)) : { deal_id: d.dealId, type: d.kind === 'rent' ? 'rent-to-rent' : 'to buy', where: d.area }) };
        }),
        total_in_my_deals: load.view.filter((d) => d.stage !== 'passed').length,
      };
    },

    async deal_facts(input: { dealId: string }, state) {
      const [card] = await cardsInOrder([input.dealId]);
      if (!card) return { available: false };
      state.deals.add(card.id);
      const v = (await views([card])).get(card.id);
      const facts = dealFacts(card, v);
      const states = await cardStatesFor(supabase as never, member.userId, member.payerId, [card.id]);
      const reportId = states.get(card.id)?.reportId ?? null;
      if (!reportId) return facts;
      // The report through the member's own session (row security): only one they may open.
      const { data } = await supabase.from('saved_searches').select('result').eq('id', reportId).maybeSingle();
      const r = (data?.result ?? null) as { shortLet?: { annualRevenue?: number; occupancyRate?: number; averageDailyRate?: number }; financials?: { shortLetNetAnnual?: number; longLetNetAnnual?: number; monthlyDifference?: number; breakEvenOccupancy?: number }; dataQuality?: { level?: string; comparablesFound?: number }; verdict?: { fit?: string; riskLevel?: string } } | null;
      if (!r) return facts;
      return {
        ...facts,
        full_analysis: {
          short_let_revenue_a_year: gbp(r.shortLet?.annualRevenue),
          occupancy: pct(r.shortLet?.occupancyRate, (r.shortLet?.occupancyRate ?? 0) <= 1 ? 100 : 1),
          average_nightly_rate: gbp(r.shortLet?.averageDailyRate),
          short_let_net_a_year: gbp(r.financials?.shortLetNetAnnual),
          long_let_net_a_year: gbp(r.financials?.longLetNetAnnual),
          more_than_a_long_let_a_month: gbp(r.financials?.monthlyDifference),
          break_even_occupancy: pct(r.financials?.breakEvenOccupancy, (r.financials?.breakEvenOccupancy ?? 0) <= 1 ? 100 : 1),
          data_quality: r.dataQuality?.level ?? null,
          comparables: r.dataQuality?.comparablesFound ?? null,
          fit: r.verdict?.fit ?? null,
          risk: r.verdict?.riskLevel ?? null,
        },
      };
    },

    async what_if_suggestions(_input: never, state) {
      const w = await whatIfViewFor(ctx.member, now);
      const items = w.items.map((it) => {
        const dealId = it.bestHref?.match(/\/deals\/([0-9a-f-]{36})/i)?.[1] ?? null;
        if (dealId) state.showMe.add(dealId);
        if (it.save === 'use') state.whatIfs.add(it.key);
        return { line: it.line, use_this_key: it.save === 'use' ? it.key : null, show_me_deal_id: dealId, must_have: it.mustHave };
      });
      return items.length > 0 ? { suggestions: items } : { suggestions: [], none: w.none };
    },

    async deals_checked_count() {
      const profileId = ctx.profile?.id;
      const choice = profileId ? await checkedCountFor(profileId, now) : null;
      if (!choice) return { checked: null, note: "Today's list isn't chosen yet." };
      const line = checkedLine({ checked: choice.checked, meeting: choice.meeting, capped: choice.capped, nearby: choice.nearby, finds: choice.finds }, { tailored: usesTailoring(ctx.member.tailoring ?? null), smallCount: ctx.settings.intelligence.revealSmallCount });
      return { line, checked: choice.checked, meeting: choice.meeting };
    },

    async credit_state() {
      const c = ctx.credit;
      const s = ctx.settings;
      const ladder = s.dealOpenLadder.map((b) => b.pence);
      return {
        balance: c ? balanceLabel(c.totalPence) : null,
        team_member: member.teamMember,
        plan: c?.cycle?.planName ?? (c?.noPlan ? 'pay as you go' : null),
        auto_top_up: member.teamMember ? 'set by the team owner' : c?.autoTopup?.amountPence ? `on: ${balanceLabel(c.autoTopup.amountPence)} when below ${balanceLabel(c.autoTopup.thresholdPence)}` : 'off',
        prices: {
          full_analysis: formatPence(s.dealPricing.fullAnalysisPence),
          second_opinion_add_on: formatPence(s.dealPricing.pmiAddonPence),
          opening_a_deal: ladder.length > 0 ? `${formatPence(Math.min(...ladder))} to ${formatPence(Math.max(...ladder))}` : null,
          top_up_amounts: s.topupPresetsPence.map((p) => balanceLabel(p)),
        },
      };
    },

    async why_called(input: { date: string | null }) {
      const day = input.date;
      // R3-106: a call that was never placed has no uk_day: on a given day, the calls queued that UK day count too.
      const start = day ? londonDayStart(day) : null;
      const end = start ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : null;
      let decisions = admin.from('standout_decisions').select('uk_day, outcome, reason, notify, call_status, deal_type, profile_id, created_at').eq('user_id', member.userId).order('created_at', { ascending: false }).limit(10);
      let calls = admin.from('si_calls_log').select('uk_day, call_type, status, blocked_reason, direction, queued_at').eq('user_id', member.userId).order('queued_at', { ascending: false }).limit(10);
      if (day) {
        decisions = decisions.eq('uk_day', day);
        calls = start && end ? calls.or(`uk_day.eq.${day},and(uk_day.is.null,queued_at.gte.${start.toISOString()},queued_at.lt.${end.toISOString()})`) : calls.eq('uk_day', day);
      }
      const [d, k] = await Promise.all([decisions, calls]);
      const inDay = (r: { uk_day: string | null; queued_at: string }) => {
        if (!day) return true;
        if (r.uk_day !== null) return r.uk_day === day;
        const t = Date.parse(r.queued_at);
        return start !== null && end !== null && t >= start.getTime() && t < end.getTime();
      };
      const dRows = ((d.data ?? []) as { uk_day: string; outcome: string; reason: string; notify: string | null; call_status: string | null; deal_type: string | null; profile_id: string | null }[]).filter((r) => !day || r.uk_day === day);
      const kRows = ((k.data ?? []) as { uk_day: string | null; call_type: string; status: string; blocked_reason: string | null; direction: string; queued_at: string }[]).filter(inDay);
      if (dRows.length === 0 && kRows.length === 0) return { found: false, day: day ?? null, today: ukDay(now) };
      // R3-102: which profile each decision was judged on (the main one; the account block names the active one).
      const profileIds = [...new Set(dRows.map((r) => r.profile_id).filter((id): id is string => Boolean(id)))];
      const profiles = profileIds.length > 0 ? (await admin.from('search_profiles').select('id, name').in('id', profileIds)).data : null;
      const nameOf = new Map(((profiles ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
      return {
        found: true,
        day: day ?? null,
        // R3-98: the member's own words for a reason and a call's status (reasons.ts), never the admin page's.
        standout_decisions: dRows.map((r) => ({ day: r.uk_day, for_profile: r.profile_id ? (nameOf.get(r.profile_id) ?? null) : null, outcome: r.outcome, why: memberReasonLabel(r.reason), told_by: r.notify, call: r.call_status ? memberCallStatusLabel(r.call_status) : null })),
        calls: kRows.map((r) => ({ day: r.uk_day, direction: r.direction, about: CALL_TYPE_LABEL[r.call_type as CallType] ?? r.call_type, status: r.status, not_placed_because: r.blocked_reason })),
      };
    },

    async offer_action(input: { kind: string; target: string | null }, state) {
      if (input.kind === 'deep_search' && state.deepSearchOffered === null) {
        const [quote, status] = await Promise.all([deepQuoteFor(member.userId, now), searchStatusFor(member.userId)]);
        state.deepSearchOffered = Boolean(quote) && !status.running;
      }
      const b = buildButton(input.kind, input.target, { surface: 'full', teamMember: member.teamMember, allowedDeals: state.deals, allowedWhatIfs: state.whatIfs, allowedShowMe: state.showMe, deepSearchOffered: Boolean(state.deepSearchOffered) });
      if (!b) return { ok: false, note: 'That button is not available here.' };
      if (!state.buttons.some((x) => x.kind === b.kind && x.href === b.href && x.whatIfKey === b.whatIfKey) && state.buttons.length < 3) state.buttons.push(b);
      return { ok: true, button: b.label };
    },

    async propose_actions(input: { steps: Parameters<typeof proposeActions>[0]['steps'] }, state) {
      if (!turn) return { ok: false, note: 'Not available here.' };
      if (state.instruction) return { ok: false, note: 'Only one plan per answer: the first one stands.' };
      const out = await proposeActions({ member: acting, supabase, turnId: turn.turnId, question: turn.question, seenDeals: state.deals, steps: input.steps, holdPence: turn.holdPence, now });
      if (out.ok === true) state.instruction = true;
      return out;
    },

    async draft_message(input: { dealId: string; message: 'enquiry' | 'follow_up' | 'offer' | null; offerAmount: number | null }, state) {
      if (!turn) return { ok: false, note: 'Not available here.' };
      if (!state.deals.has(input.dealId)) return { ok: false, note: 'Look the deal up first (my_deals or deal_facts), then use its deal_id.' };
      if (state.draft) return { ok: false, note: 'One message per answer.' };
      const out = await draftMessage(acting, { dealId: input.dealId, kind: input.message, offerAmount: input.offerAmount });
      if (!out.ok) return { ok: false, note: out.note };
      state.draft = out.draft;
      return out.forModel;
    },

    async report_issue(input: { kind: 'bug' | 'feature'; summary: string; theirWords: string }, state) {
      if (!turn) return { ok: false, note: 'Not available here.' };
      if (state.report || state.featureRequest) return { ok: false, note: 'Once per answer.' };
      const words = input.theirWords || turn.question;
      if (input.kind === 'feature') {
        state.featureRequest = `${words}${input.summary && input.summary !== words ? `\n\n(${input.summary})` : ''}`.slice(0, 1500);
        return { ok: true, note: "A feature request, filled in, shows under your answer for them to check and send. Say so in one sentence; don't say it has been sent." };
      }
      const r = await fileMemberBug({ userId: member.userId, email: turn.email, turnId: turn.turnId, memberWords: words, summary: input.summary, page: '/intelligence', userAgent: turn.userAgent });
      if (!r.ok) return { ok: false, note: r.error === 'limit' ? "They have sent the most reports we take in a day: say it couldn't be filed today and give the team's email from search_knowledge." : "It couldn't be filed just now: say so, and that they can use Feedback in the menu." };
      state.report = { kind: 'bug', ref: r.ref };
      return { ok: true, filed: true, reference: `#${r.ref}`, note: 'Filed for them with the Stayful team. Tell them its reference in one sentence; they will hear back by email when it is fixed.' };
    },

    async ask_which(input: { options: string[] }, state) {
      // Every choice is a figure the member will see: none may carry one the answer wasn't given.
      const allowed = allowedFigures([...state.sources, turn?.question ?? '']);
      state.choices = input.options.filter((o) => checkFigures(o, allowed).ok).slice(0, 4);
      return { ok: true, note: 'The choices show under your answer as buttons.' };
    },

    async propose_fact(input: { fact: string }, state) {
      if (state.factProposal) return { ok: false, note: 'Only one per answer.' };
      // R3-89: checked now, before the member sees it: nothing sensitive or personal is ever shown as a proposal.
      const c = checkFact({ fact: input.fact, confirmed: true });
      if (!c.ok) return { ok: false, note: "That can't be remembered (it's sensitive, personal, or too long), so nothing is offered." };
      state.factProposal = c.fact;
      return { ok: true, note: 'The page will ask them "Want me to remember that?" under your answer.' };
    },
  };

  return {
    async run(input, state) {
      state.toolsUsed.push(input.tool);
      try {
        const out = await tools[input.tool](input as never, state);
        const text = capped(out);
        state.sources.push(text);
        return text;
      } catch (err) {
        console.error(`[chat] tool ${input.tool} failed:`, (err as Error)?.message ?? err);
        return JSON.stringify({ error: 'That look-up failed just now.' });
      }
    },
  };
}

