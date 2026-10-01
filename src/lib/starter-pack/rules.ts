/**
 * The £10 starter pack (Batch 20, Part A): who is offered it, how its credit
 * lands in the ledger, and everything it says. The numbers are the
 * billing_settings rows in src/lib/lifecycle/settings.ts; the reads, the
 * claim and the grant are in ./server.ts and ./grant-server.ts.
 *
 * The ledger: the price paid is a 'topup' grant (source_ref pi:<payment
 * intent>), so the existing top-up machinery applies (early access through
 * last_topup_at, Batch 9's "Paying", refunds, team seats), and the rest is a
 * 'welcome'-kind bonus (source_ref pack_bonus:<payment intent>) spent at the
 * same rate as the welcome credit it replaces. With a Full analysis at £4 of
 * plan-rate credit, £20 of bonus and £10 of top-up credit (spent at 1.3×)
 * come to about 7.
 *
 * Once per person, ever: the account, its email, its mobile number and the
 * card. The first three are known before paying, so the offer is never shown
 * to them; the card only when it has been authorised, so a repeat card is
 * cancelled before it is ever charged (manual capture).
 *
 * Pure: no network, no database, no server-only.
 */
import { formatGbp } from '../credit/pricing.ts';
import { starterPackBonusPence, isPackAccount, type LifecycleSettings } from '../lifecycle/settings.ts';

/** Batch 21 (B47): 'pending' is a Checkout this browser started minutes ago that the webhook has not settled yet. */
export type OfferBlock = 'off' | 'existing_member' | 'team_member' | 'bought' | 'already_had' | 'on_plan' | 'pending';

/** How long after starting a Checkout the offer stays hidden in that browser, so the member cannot pay twice while the webhook is on its way. */
export const CHECKOUT_PENDING_MS = 10 * 60_000;

/**
 * The email key the pack's once-per-person claim is made on (Batch 21,
 * B21): trimmed and lower-cased as profiles.email is (emailKey), with a
 * plus-tag dropped and, for Gmail, the dots in the local part removed and
 * googlemail.com read as gmail.com, since those all deliver to one inbox.
 * The profile's own key is left alone: this is only for the claim.
 */
export function packEmailKey(email: string | null | undefined): string | null {
  const key = (email ?? '').trim().toLowerCase();
  const at = key.lastIndexOf('@');
  if (at <= 0) return null;
  let local = key.slice(0, at);
  let domain = key.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local ? `${local}@${domain}` : null;
}

export interface PackFacts {
  createdAt: string | null;
  /**
   * The account already had the £20 welcome credit (welcome:<id>): it joined
   * under the old offer, whatever the cutover says now (it can be moved).
   */
  hadWelcome: boolean;
  teamMember: boolean;
  /** profiles.starter_pack_bought_at, or a granted purchase row. */
  bought: boolean;
  /** A reserved or granted purchase for this account, its email or its number. */
  alreadyHad: boolean;
  /** A live, trialling, past-due or paused subscription, or a plan granted by hand. */
  onPlan: boolean;
  /** Batch 21 (B47): this browser started a pack Checkout in the last CHECKOUT_PENDING_MS and no purchase row has arrived yet. */
  checkoutPending?: boolean;
}

export type PackOffer = { eligible: true } | { eligible: false; reason: OfferBlock };

export function packOffer(f: PackFacts, s: Pick<LifecycleSettings, 'starterPackFrom'>): PackOffer {
  if (!s.starterPackFrom) return { eligible: false, reason: 'off' };
  if (!isPackAccount(f.createdAt, s) || f.hadWelcome) return { eligible: false, reason: 'existing_member' };
  if (f.teamMember) return { eligible: false, reason: 'team_member' };
  if (f.bought) return { eligible: false, reason: 'bought' };
  if (f.alreadyHad) return { eligible: false, reason: 'already_had' };
  if (f.onPlan) return { eligible: false, reason: 'on_plan' };
  if (f.checkoutPending) return { eligible: false, reason: 'pending' };
  return { eligible: true };
}

/** The Today card shows until they buy, except for the days after "Not now". */
export function todayCardShown(offer: PackOffer, snoozedUntil: string | null, now: Date): boolean {
  if (!offer.eligible) return false;
  const until = snoozedUntil ? Date.parse(snoozedUntil) : Number.NaN;
  return !(Number.isFinite(until) && until > now.getTime());
}

export function snoozeUntil(now: Date, days: number): string {
  return new Date(now.getTime() + Math.max(1, days) * 86_400_000).toISOString();
}

/** How the pack's credit lands: the price as top-up credit, the rest as the welcome-kind bonus. */
export function packGrants(s: Pick<LifecycleSettings, 'starterPackPricePence' | 'starterPackCreditPence'>): { topupPence: number; bonusPence: number } {
  return { topupPence: s.starterPackPricePence, bonusPence: starterPackBonusPence(s) };
}

/**
 * About how many Full analyses the pack's credit pays for: the bonus at the
 * welcome rate and the paid part at the top-up rate, against the Full
 * analysis's plan-rate price. Rounded, because the copy says "about".
 */
export function fullAnalysesFor(s: Pick<LifecycleSettings, 'starterPackPricePence' | 'starterPackCreditPence'>, fullAnalysisPence: number, rates: { welcome: number; topup: number }): number {
  if (!(fullAnalysisPence > 0)) return 0;
  const { topupPence, bonusPence } = packGrants(s);
  const base = bonusPence / (rates.welcome > 0 ? rates.welcome : 1) + topupPence / (rates.topup > 0 ? rates.topup : 1);
  return Math.round(base / fullAnalysisPence);
}

/** "£10", "£12.50": whole pounds without pence. */
export function pounds(pence: number): string {
  return pence % 100 === 0 ? `£${Math.round(pence / 100)}` : formatGbp(pence);
}

/** The wording of the tickbox the member ticks before paying, and its version (kept with the purchase). */
export const CONSENT_TEXT = 'I want to use my credit straight away and understand I lose my 14-day right to cancel once I do.';
export const CONSENT_VERSION = 'starter-pack-consent-v1';

export interface PackCopy {
  price: string;
  credit: string;
  analyses: number;
  headline: string;
  body: string;
  buy: string;
  notNow: string;
  consent: string;
  smallPrint: string;
  cardTitle: string;
  cardBody: string;
  cardCta: string;
  accountLine: string;
  accountCta: string;
  deadEnd: string;
  checkoutText: string;
  pricingLine: string;
}

/** Everything the pack says, from the settings and today's Full analysis price. */
export function packCopy(s: Pick<LifecycleSettings, 'starterPackPricePence' | 'starterPackCreditPence'>, fullAnalysisPence: number, rates: { welcome: number; topup: number }): PackCopy {
  const price = pounds(s.starterPackPricePence);
  const credit = pounds(s.starterPackCreditPence);
  const analyses = fullAnalysesFor(s, fullAnalysisPence, rates);
  const about = analyses > 0 ? `about ${analyses} Full ${analyses === 1 ? 'analysis' : 'analyses'}, plus daily deals picked for you` : 'daily deals picked for you and Full analyses of the ones you like';
  return {
    price,
    credit,
    analyses,
    headline: `Start with ${credit} of credit for ${price}`,
    body: `${price} gets you ${credit} of credit: ${about}. It never expires.`,
    buy: `Buy for ${price}`,
    notNow: 'Not now',
    consent: CONSENT_TEXT,
    smallPrint: 'One starter pack per person. Paid securely with Stripe; we save your card for one-tap top-ups.',
    cardTitle: `${price} gets you ${credit} of credit`,
    cardBody: `${about.charAt(0).toUpperCase()}${about.slice(1)}. One per person.`,
    cardCta: `Get ${credit} for ${price}`,
    accountLine: `New members: ${price} gets you ${credit} of credit.`,
    accountCta: 'Get the starter pack',
    deadEnd: `You're out of credit. ${price} gets you ${credit} of credit${analyses > 0 ? `: about ${analyses} Full ${analyses === 1 ? 'analysis' : 'analyses'}` : ''}.`,
    checkoutText: `Your ${credit} of credit is added as soon as you pay. You've asked to use it straight away, so your 14-day right to cancel ends once you use any of it.`,
    pricingLine: `New members: ${price} gets you ${credit} of credit.`,
  };
}

/**
 * How much of the pack's credit a refund (or a dispute) takes back: the same
 * share of the credit as of the payment, so a full refund takes it all. A
 * payment refused as a repeat was added as a plain top-up, so only its price
 * is at stake.
 */
export function packClawbackPence(input: { creditPence: number; chargedPence: number; refundedPence: number }): number {
  if (!(input.chargedPence > 0) || !(input.refundedPence > 0)) return 0;
  const share = Math.min(1, input.refundedPence / input.chargedPence);
  return Math.round(input.creditPence * share);
}

/** What the return page says about a purchase, by the state of its row. */
export function returnMessage(status: 'reserved' | 'granted' | 'blocked' | 'failed' | null, blockedBy: string | null, credit: string): { tone: 'ok' | 'warn'; text: string } | null {
  if (status === 'granted') return { tone: 'ok', text: `Your ${credit} of credit is on your account. It never expires.` };
  // Stripe sent them back before the payment was settled (the claim is the webhook's): true either way.
  if (status === 'reserved') return { tone: 'ok', text: `Thanks: your ${credit} of credit is on its way. Refresh the page in a moment if it isn't showing yet.` };
  if (status === 'blocked') {
    const what = blockedBy === 'card' ? 'This card has' : blockedBy === 'email' ? 'This email address has' : blockedBy === 'mobile' ? 'This mobile number has' : 'You have';
    return { tone: 'warn', text: `${what} already had a starter pack (one per person), so we didn't take your payment. You can still top up or choose a plan.` };
  }
  if (status === 'failed') return { tone: 'warn', text: "We couldn't take your payment, so nothing was charged. Please try again." };
  return null;
}

/** Is the pack what a new sign-up gets now? From the cutover moment; before it, new members still get the welcome credit. */
export function packLive(s: Pick<LifecycleSettings, 'starterPackFrom'>, now: Date): boolean {
  const t = s.starterPackFrom ? Date.parse(s.starterPackFrom) : Number.NaN;
  return Number.isFinite(t) && t <= now.getTime();
}

/** What the public pages promise a new member: the welcome credit until the cutover, the starter pack after it. */
export interface PublicOffer {
  pack: boolean;
  signupHeadline: string;
  loginPrompt: string;
  loginLink: string;
  checkEmailLine: string;
  /** "…, and every new member starts with £20." */
  newMembers: string;
  /** A short tick-list line. */
  chip: string;
  /** The Market Explorer FAQ's "alongside £20 of free credit". */
  alongside: string;
  pricingTitle: string;
  pricingDescription: string;
  /** The FAQ's "What does it cost?" opening, once the pack is live (null: the answer as it was). */
  costLead: string | null;
}

export function publicOffer(copy: PackCopy, live: boolean, welcomePence: number): PublicOffer {
  if (live) {
    const analyses = copy.analyses > 0 ? `, about ${copy.analyses} Full ${copy.analyses === 1 ? 'analysis' : 'analyses'} of deals` : '';
    return {
      pack: true,
      signupHeadline: copy.headline,
      loginPrompt: 'New here?',
      loginLink: `${copy.price} gets you ${copy.credit} of credit`,
      checkEmailLine: 'Click it to activate your account.',
      newMembers: `new members can start with ${copy.credit} of credit for ${copy.price}`,
      chip: `${copy.credit} of credit for ${copy.price} to start`,
      alongside: `and new members can start with ${copy.credit} of credit for ${copy.price}`,
      pricingTitle: `Pricing — ${copy.credit} of credit for ${copy.price}, then pay as you go or subscribe`,
      pricingDescription: `Stayful Intelligence pricing. New members get ${copy.credit} of credit for ${copy.price}, then subscribe from £19/month for monthly credit or top up as you go. No contract, cancel any time.`,
      costLead: `New members can start with a ${copy.price} starter pack: ${copy.credit} of credit${analyses}. It never expires.`,
    };
  }
  const welcome = pounds(welcomePence);
  return {
    pack: false,
    signupHeadline: `Start with ${welcome} of free credit`,
    loginPrompt: 'Don’t have an account?',
    loginLink: `Start with ${welcome} of free credit`,
    checkEmailLine: `Click it to activate your account and get your ${welcome} of free credit.`,
    newMembers: `every new member starts with ${welcome}`,
    chip: `${welcome} of free credit included`,
    alongside: `alongside ${welcome} of free credit`,
    pricingTitle: `Pricing — ${welcome} free credit, then pay as you go or subscribe`,
    pricingDescription: `Stayful Intelligence pricing. Start with ${welcome} of free credit, then subscribe from £19/month for monthly credit or top up as you go. No contract, cancel any time.`,
    costLead: null,
  };
}
