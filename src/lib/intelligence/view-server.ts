import 'server-only';

/**
 * Batch 22, Parts B and E: what the Stayful Intelligence view shows. The
 * signup reveal and the header eye's /intelligence both read it:
 *   - Today's own first 3 cards (today/view-server.ts loadTodayView), for the
 *     primary profile on the reveal and the active one from the header, so
 *     the reveal is identical to Today by construction
 *   - each card's view (prices, numbers, why) as Today builds it
 *   - "I checked N live deals" (the day's stored choice)
 *   - the facts the question chips are answered from
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { isAdminEmail } from '../admin';
import { payerFor } from '../team';
import { teamCreditSnapshot, type TeamCreditSnapshot } from '../team/credit';
import { getBillingSettings } from '../credit/unit-costs';
import { dealVisibilityFor } from '../marketplace/tier';
import { openedDealIds } from '../marketplace/queries';
import { cardViewsFor } from '../marketplace/card-state';
import { cashBuyerOf } from '../marketplace/most-you-can-pay';
import { getAreaCardsWithin } from '../market/cached';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getContact } from '../sms/store';
import { activeProfileFor, primaryProfileFor } from '../profiles/server';
import { isRunning, type SavedProfile } from '../profiles/rules';
import { tailoringForMember } from '../tailoring/server';
import { usesTailoring } from '../tailoring/profile';
import { withTailoring } from '../tailoring/numbers';
import { loadTodayView, type TodayView } from '../today/view-server';
import { checkedCountFor } from '../today/selection';
import { checkedLine } from '../today/checked';
import type { StoredChoice } from '../today/choice';
import { todayKey } from '../today/day';
import { analysisOffer, offerLabel } from '../analysis/offers';
import { quoterFor } from '../credit/quote-server';
import { enhancedEnabled } from '../analysis/run';
import type { PriceLabel } from '../credit/deal-pricing';
import { offerFloors, offerMemberFor, offerPricingFor, offerSettings } from '../analysis/offers-server';
import { accuracySettings, accuracyView, profileSummaryFor } from '../profile/server';
import type { Level } from '../profile/levels';
import { chipsFor, memberValuesFrom, type Answer, type AnswerFacts } from './answers';
import { renderLive } from '../knowledge/store-server';
import { matchPctOf, revealDeals, revealTone, type RevealTone } from './reveal';
import { whatIfViewFor, type WhatIfView } from './what-if-server';
import { deepQuoteFor, searchStatusFor, type DeepQuoteView } from '../sourcing-demand/member-search';
import { callPencePerMinute } from '../voice/charge-server';
import { callsEnabled } from '../voice/config';

type Cards = TodayView['cards'];

export interface IntelligenceData {
  profile: SavedProfile | null;
  /** The first 3 of Today's cards, best match first. */
  cards: Cards;
  views: Awaited<ReturnType<typeof cardViewsFor>>;
  opened: Set<string>;
  answered: TodayView['answered'];
  tone: RevealTone;
  /** "I checked N live deals …", or null. */
  checkedText: string | null;
  choice: StoredChoice | null;
  nearMiss: boolean;
  advice: string | null;
  tailored: boolean;
  level: Level;
  levelName: string;
  /** Answers still needed for the next level (below the top). */
  nextLevel: { name: string; needed: number } | null;
  answers: Answer[];
  /** Part F: when the match is low or there is none. */
  whatIfs: WhatIfView | null;
  /** Part H: each card's Full analysis and Deep report, priced with the member's offers. */
  analyses: Map<string, { full: PriceLabel | null; deep: PriceLabel | null; fullNote: string | null; deepNote: string | null; fullList: number | null; deepList: number | null }>;
  /** Part G: the member's own search is still running; the deep search's quote when there is no strong match. */
  searching: boolean;
  deepQuote: DeepQuoteView | null;
  credit: TeamCreditSnapshot | null;
  settings: Awaited<ReturnType<typeof getBillingSettings>>;
  visibilityTier: 'paid' | 'free';
  day: string;
}

const AREA_WAIT_MS = 2_000;

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' });
}

/**
 * Today's member context for the reveal (primary profile) or the header view
 * (active profile): the same one Today builds. Also used by the what-ifs.
 */
export async function intelligenceMember(user: Pick<User, 'id' | 'email'>, mode: 'reveal' | 'header', now: Date = new Date()) {
  const adminUser = isAdminEmail(user.email);
  const [payer, visibility, profile] = await Promise.all([payerFor(user.id), dealVisibilityFor(user.id, adminUser), mode === 'reveal' ? primaryProfileFor(user.id) : activeProfileFor(user.id)]);
  const goals = profile?.goals ?? null;
  const savedAreas = profile?.areas ?? [];
  const paused = profile !== null && !isRunning(profile);
  const tailoring = paused ? null : await tailoringForMember(user.id, profile, goals, savedAreas, now);
  return { profile, paused, member: { userId: user.id, payerId: payer.payerId, goals, savedAreas, visibility, profileId: profile?.id ?? null, profileActive: profile?.isActive ?? true, tailoring } };
}

export async function loadIntelligence(input: { user: User; supabase: SupabaseClient; mode: 'reveal' | 'header'; now?: Date }): Promise<IntelligenceData> {
  const now = input.now ?? new Date();
  const user = input.user;
  const adminUser = isAdminEmail(user.email);
  const [{ profile, paused, member }, settings, summary, credit, levelSettings] = await Promise.all([
    intelligenceMember(user, input.mode, now),
    getBillingSettings(),
    profileSummaryFor(user.id),
    teamCreditSnapshot({ id: user.id, admin: adminUser }).catch(() => null),
    accuracySettings(),
  ]);
  const goals = member.goals;
  const tailoring = member.tailoring;
  const visibility = member.visibility;
  const payer = { payerId: member.payerId };
  const today = await loadTodayView(member, now, { paused });
  const keep = new Set(revealDeals(today.cards.map((c) => c.id)));
  const cards = today.cards.filter((c) => keep.has(c.id));

  const [baseViews, opened, snapshot, storedChoice, contact, offerMember, floors, offerS] = await Promise.all([
    cardViewsFor({ supabase: input.supabase as never, userId: user.id, adminUser, cards, finance: goals?.finance ?? null, cashBuyer: cashBuyerOf(goals) }),
    openedDealIds(payer.payerId, cards.map((c) => c.id)),
    getAreaCardsWithin(AREA_WAIT_MS),
    today.selection?.choice ?? (profile ? checkedCountFor(profile.id, now) : Promise.resolve(null)),
    hasServiceRole() ? getContact(createAdminClient(), user.id).catch(() => null) : Promise.resolve(null),
    offerMemberFor(user.id),
    offerFloors(),
    offerSettings(),
  ]);
  const views = withTailoring(baseViews, cards, tailoring, snapshot, now, { why: true });

  // Part H: the Full analysis and the Deep report for each card, priced as startDealAnalysis will price them.
  const [offers, quoter] = await Promise.all([offerPricingFor(user.id, adminUser, now), quoterFor(payer.payerId, adminUser)]);
  const analyses = new Map<string, IntelligenceData['analyses'] extends Map<string, infer V> ? V : never>();
  for (const c of cards) {
    const v = views.get(c.id);
    if (!v || v.analysed || v.fullAnalysisBasePence === undefined) continue;
    const full = offers.pricing(c.id, false);
    const deep = offers.pricing(c.id, true);
    // The deep purchase is the full one with the Deep report's own full + PMI prices in place of the Full analysis price.
    const deepBase = Math.max(0, v.fullAnalysisBasePence - full.fullAnalysisPence + deep.fullAnalysisPence + deep.pmiAddonPence);
    const fo = offers.offer(c.id, false);
    const dO = offers.offer(c.id, true);
    analyses.set(c.id, {
      full: quoter.label(v.fullAnalysisBasePence),
      deep: enhancedEnabled(true) ? quoter.label(deepBase) : null,
      fullNote: offerLabel(fo?.offer),
      deepNote: offerLabel(dO?.offer),
      fullList: fo ? fo.listTotalPence : null,
      deepList: dO ? dO.listTotalPence : null,
    });
  }
  const tailored = usesTailoring(tailoring);
  const topPct = cards[0] ? matchPctOf(views.get(cards[0].id)?.explanation?.match ?? null) : null;
  const nearMiss = today.selection?.nearMiss === true;
  const tone = revealTone({ cards: cards.length, nearMiss, topMatchPct: tailored ? topPct : null, lowMatchPct: settings.intelligence.revealLowMatchPct });
  const choice = storedChoice ?? null;
  const checkedText = choice ? checkedLine({ checked: choice.checked, meeting: choice.meeting, capped: choice.capped, nearby: choice.nearby, finds: choice.finds }, { tailored, smallCount: settings.intelligence.revealSmallCount }) : null;

  const acc = summary ? accuracyView(summary.progress, levelSettings) : null;
  const level: Level = acc?.level ?? 1;
  const lvl = acc?.next ?? null;

  // The chip answers' facts: every figure from settings or the member's state.
  const list = { fullPence: settings.dealPricing.fullAnalysisPence, pmiPence: settings.dealPricing.pmiAddonPence };
  const firstOffer = offerMember?.offerDealIds[0];
  const welcomePrice = firstOffer ? analysisOffer({ dealId: firstOffer, withPmi: false, list, member: offerMember, settings: offerS, floors, now }) : null;
  const deep = analysisOffer({ dealId: '__none__', withPmi: true, list, member: offerMember, settings: offerS, floors, now });
  const ladder = settings.dealOpenLadder;
  const facts: AnswerFacts = {
    balancePence: credit?.totalPence ?? 0,
    topupRate: settings.spendRates.topup,
    openMinPence: Math.min(...ladder.map((b) => b.pence)),
    openMaxPence: Math.max(...ladder.map((b) => b.pence)),
    pack: credit?.pack ? { pricePence: settings.lifecycle.starterPackPricePence, creditPence: settings.lifecycle.starterPackCreditPence } : null,
    alertsByText: Boolean(contact?.verified_at && contact.enabled && !contact.stopped_at),
    checked: choice?.checked ?? null,
    tailored,
    belowTopLevel: level < 3,
    fullPence: list.fullPence,
    pmiPence: list.pmiPence,
    welcome:
      welcomePrice?.offer === 'welcome' && offerMember?.revealViewedAt
        ? { fullPence: welcomePrice.fullPence, until: dayLabel(new Date(Date.parse(offerMember.revealViewedAt) + settings.intelligence.revealWelcomeDays * 86_400_000).toISOString()) }
        : null,
    firstDeepPence: deep.offer === 'first_deep' ? Math.round(deep.fullPence + deep.pmiPence) : null,
    freeMember: visibility.tier === 'free',
    freeDelayHours: settings.freeDealDelayHours,
    // Batch 23: the minute price members pay (the si:call_minute unit row), and whether calls are live.
    call: { perMinPence: await callPencePerMinute(), textPence: settings.intelligence.siTextPence, emailPence: settings.intelligence.siEmailPence, live: callsEnabled() },
    topupPresetsPence: settings.topupPresetsPence,
    autoTopupOn: Boolean(credit?.autoTopup?.amountPence),
    noMatch: null,
  };

  const [whatIfs, status, deepQuote] = await Promise.all([
    tone === 'match' ? Promise.resolve(null) : whatIfViewFor(member, now),
    searchStatusFor(user.id),
    tone === 'match' ? Promise.resolve(null) : deepQuoteFor(user.id, now),
  ]);
  if (whatIfs) facts.noMatch = whatIfs.items[0]?.line ?? whatIfs.none;
  // Batch 24: the chips' words come only from approved knowledge entries, rendered for this member now.
  const chipAnswers = chipsFor(await renderLive('view', memberValuesFrom(facts)), facts);

  return {
    profile,
    whatIfs,
    analyses,
    searching: status.running,
    deepQuote: status.running ? null : deepQuote,
    cards,
    views,
    opened,
    answered: today.answered,
    tone,
    checkedText,
    choice,
    nearMiss,
    advice: today.selection?.advice ?? null,
    tailored,
    level,
    levelName: acc?.name ?? 'Basic',
    nextLevel: lvl,
    answers: chipAnswers,
    credit,
    settings,
    visibilityTier: visibility.tier,
    day: todayKey(now),
  };
}
