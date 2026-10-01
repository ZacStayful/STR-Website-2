/**
 * Batch 22, Part H: the prices a Full analysis or Deep report is offered at.
 * Worked out by the server from the member's state, never trusted from the
 * page, and fed into the same pricing every quote uses (analysisQuote /
 * dealAnalysisDue), so the button, the quote and the charge always agree.
 *
 *   welcome       a deal the member's reveal showed (signup_reveals.offer_deal_ids),
 *                 within reveal_welcome_days of the reveal, paid for by the member
 *                 themselves: full × (1 − reveal_analysis_discount_pct)
 *   welcome_deep  the same deal as a Deep report (full + PMI): (full + PMI) × (1 − pct);
 *                 it is also the account's first deep report
 *   first_deep    a Deep report, when the paying account has never had one:
 *                 full + deep_first_run_extra_pence (instead of full + PMI)
 *   first_pmi     PMI added to a finished analysis, the first time: + deep_first_run_extra_pence
 *
 * PMI added later is never welcome-priced. Every offer is floored at the live
 * worst-case raw cost (fullAnalysisRawCeiling, with PMI when it is in): an
 * offer that would go under it is raised to it, and one that would then be no
 * cheaper than the list price is dropped.
 *
 * Pure: no network, no database, no server-only.
 */

export type OfferKind = 'welcome' | 'welcome_deep' | 'first_deep' | 'first_pmi';

export interface OfferSettings {
  revealAnalysisDiscountPct: number;
  revealWelcomeDays: number;
  deepFirstRunExtraPence: number;
}

export interface OfferMember {
  /** The deals the member's reveal offered the welcome price on. */
  offerDealIds: readonly string[];
  /** When the member first viewed their reveal (the window starts there); null: never. */
  revealViewedAt: string | null;
  /** The member pays for themselves (not a team seat paid by an owner). */
  paysForSelf: boolean;
  /** The paying account has had a deep report, or has one claimed and running. */
  hadDeepReport: boolean;
  /** This member already used the welcome price on this deal. */
  usedWelcomeOn: readonly string[];
}

export interface ListPrices {
  fullPence: number;
  pmiPence: number;
}

export interface Floors {
  /** Worst-case raw cost of a Full analysis, and of one with PMI. */
  fullRawPence: number;
  deepRawPence: number;
  /** Worst-case raw cost of PMI alone. */
  pmiRawPence: number;
}

export interface OfferedPrices extends ListPrices {
  offer: OfferKind | null;
  /** This purchase is the account's first deep report (claims the unique index). */
  firstDeep: boolean;
  /** The list total this replaces, for the struck-through price. */
  listTotalPence: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));
const floorTo = (p: number) => Math.ceil(Math.max(0, p));

function withinWindow(viewedAt: string | null, days: number, now: Date): boolean {
  if (!viewedAt) return false;
  const t = Date.parse(viewedAt);
  if (!Number.isFinite(t)) return false;
  return now.getTime() <= t + Math.max(0, days) * 86_400_000;
}

/** The welcome price applies to this deal for this member now. */
export function welcomeApplies(dealId: string, m: OfferMember, s: OfferSettings, now: Date): boolean {
  if (!m.paysForSelf) return false;
  if (!m.offerDealIds.includes(dealId)) return false;
  if (m.usedWelcomeOn.includes(dealId)) return false;
  if (pct(s.revealAnalysisDiscountPct) <= 0) return false;
  return withinWindow(m.revealViewedAt, s.revealWelcomeDays, now);
}

/**
 * The prices for a Full analysis (withPmi false) or a Deep report (withPmi
 * true) of a feed deal. Returns the list prices untouched when no offer
 * applies; the caller passes { fullPence, pmiPence } on to analysisQuote.
 */
export function analysisOffer(input: { dealId: string; withPmi: boolean; list: ListPrices; member: OfferMember | null; settings: OfferSettings; floors: Floors; now: Date }): OfferedPrices {
  const { list, member: m, settings: s, floors } = input;
  const listTotal = round2(list.fullPence + (input.withPmi ? list.pmiPence : 0));
  const none: OfferedPrices = { ...list, offer: null, firstDeep: false, listTotalPence: listTotal };
  if (!m) return none;
  const off = pct(s.revealAnalysisDiscountPct) / 100;

  if (welcomeApplies(input.dealId, m, s, input.now)) {
    if (!input.withPmi) {
      const full = Math.max(round2(list.fullPence * (1 - off)), floorTo(floors.fullRawPence));
      if (full < list.fullPence) return { fullPence: full, pmiPence: list.pmiPence, offer: 'welcome', firstDeep: false, listTotalPence: listTotal };
    } else {
      const total = Math.max(round2(listTotal * (1 - off)), floorTo(floors.deepRawPence));
      if (total < listTotal) {
        const full = Math.max(round2(list.fullPence * (1 - off)), 0);
        const pmi = round2(Math.max(0, total - full));
        return { fullPence: round2(total - pmi), pmiPence: pmi, offer: 'welcome_deep', firstDeep: !m.hadDeepReport, listTotalPence: listTotal };
      }
    }
  }

  if (input.withPmi && !m.hadDeepReport) {
    const extra = Math.max(0, s.deepFirstRunExtraPence);
    const total = Math.max(round2(list.fullPence + extra), floorTo(floors.deepRawPence));
    if (total < listTotal) return { fullPence: list.fullPence, pmiPence: round2(total - list.fullPence), offer: 'first_deep', firstDeep: true, listTotalPence: listTotal };
  }
  return none;
}

/** PMI added to a finished analysis: the first time for the account, + the first-run extra. Never welcome-priced. */
export function pmiAddonOffer(input: { listPmiPence: number; hadDeepReport: boolean; settings: Pick<OfferSettings, 'deepFirstRunExtraPence'>; floors: Pick<Floors, 'pmiRawPence'> }): { pmiPence: number; offer: OfferKind | null; firstDeep: boolean } {
  if (input.hadDeepReport) return { pmiPence: input.listPmiPence, offer: null, firstDeep: false };
  const price = Math.max(Math.max(0, input.settings.deepFirstRunExtraPence), floorTo(input.floors.pmiRawPence));
  if (price >= input.listPmiPence) return { pmiPence: input.listPmiPence, offer: null, firstDeep: true };
  return { pmiPence: price, offer: 'first_pmi', firstDeep: true };
}

/** The ledger line's suffix for an offer. */
export function offerLabel(offer: OfferKind | null | undefined): string | null {
  if (offer === 'welcome' || offer === 'welcome_deep') return 'welcome price';
  if (offer === 'first_deep' || offer === 'first_pmi') return 'first-time price';
  return null;
}

/**
 * The lowest discount admin may save: one that would put the welcome price
 * under the worst-case raw cost is refused (the runtime floor still holds
 * whatever is saved).
 */
export function maxSafeDiscountPct(list: ListPrices, floors: Pick<Floors, 'fullRawPence'>): number {
  if (!(list.fullPence > 0)) return 0;
  const room = 1 - floorTo(floors.fullRawPence) / list.fullPence;
  return Math.max(0, Math.floor(room * 100));
}
