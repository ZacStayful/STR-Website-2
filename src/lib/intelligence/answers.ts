/**
 * Batch 22, Part E: Stayful Intelligence's answers to the question chips.
 * Written once here, in the first person, with every figure read from
 * settings or the member's state at render time: no price is typed in a
 * template, so a change on /admin/billing changes the answer (within the
 * settings cache). Up to MAX_CHIPS are offered, only those that apply.
 *
 * Batch 26's typed chat and the calls batch reuse these.
 *
 * Pure: no network, no database, no server-only.
 */
import { formatPence } from '../credit/deal-pricing.ts';
import { CHIP_ORDER, MAX_CHIPS } from './config.ts';

export type ChipKey = (typeof CHIP_ORDER)[number];

export interface AnswerFacts {
  balancePence: number;
  topupRate: number;
  openMinPence: number;
  openMaxPence: number;
  /** Batch 20's pack, when it is on and not bought: its price and the credit it gives. */
  pack: { pricePence: number; creditPence: number } | null;
  /** How saved-deal alerts reach the member. */
  alertsByText: boolean;
  /** "I ranked N live deals …" */
  checked: number | null;
  tailored: boolean;
  belowTopLevel: boolean;
  fullPence: number;
  pmiPence: number;
  /** The welcome price on their revealed deals and the day it ends; null outside the window. */
  welcome: { fullPence: number; until: string } | null;
  /** The first deep report's price, when they haven't had one. */
  firstDeepPence: number | null;
  freeMember: boolean;
  freeDelayHours: number;
  call: { perMinPence: number; textPence: number; emailPence: number };
  topupPresetsPence: readonly number[];
  autoTopupOn: boolean;
  /** Part F's line, when there is a low or no match. */
  noMatch: string | null;
}

export interface Answer {
  key: ChipKey;
  question: string;
  answer: string;
  action: { label: string; href: string } | null;
}

const list = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

function one(key: ChipKey, f: AnswerFacts): Answer | null {
  switch (key) {
    case 'credits':
      return {
        key,
        question: 'How do credits work?',
        answer: `You have ${formatPence(f.balancePence)} of credit. It pays for opening deals, daily picks and reports; paid from top-up credit, prices are ${f.topupRate}× the plan price.`,
        action: { label: 'Top up', href: '/account/billing' },
      };
    case 'open_cost':
      return {
        key,
        question: 'What does it cost to open a deal?',
        answer: `${formatPence(f.openMinPence)}–${formatPence(f.openMaxPence)} to open a deal, depending on how profitable it is. It comes out of your credit and shows the address and listing.`,
        action: null,
      };
    case 'pack':
      if (!f.pack) return null;
      return {
        key,
        question: `What do I get with the ${formatPence(f.pack.pricePence)} pack?`,
        answer: `${formatPence(f.pack.creditPence)} of credit for ${formatPence(f.pack.pricePence)}, once. It covers opening deals, your daily picks and reports.`,
        action: { label: 'Get the pack', href: '/today?offer=pack' },
      };
    case 'save':
      return {
        key,
        question: 'What happens when I save a deal?',
        answer: `Saving is free. It goes to My deals and I'll tell you by ${f.alertsByText ? 'email and text' : 'email'} if the price drops, it comes back on the market, it's getting attention or it's gone.`,
        action: null,
      };
    case 'how_picked': {
      const n = f.checked ?? 0;
      const answer = f.tailored
        ? `I ranked ${n.toLocaleString('en-GB')} live deals against your answers: must-haves first, then nice-to-haves, the short-let income check and profit. More answers make it sharper.`
        : `I ranked ${n.toLocaleString('en-GB')} live deals in your areas and budget by short-let income and profit.`;
      return { key, question: 'How do you pick my deals?', answer, action: f.belowTopLevel ? { label: 'Improve accuracy', href: '/welcome' } : null };
    }
    case 'analysis': {
      const welcome = f.welcome ? ` (${formatPence(f.welcome.fullPence)} on your matches until ${f.welcome.until})` : '';
      const deep = formatPence(f.fullPence + f.pmiPence);
      const first = f.firstDeepPence !== null ? ` (${formatPence(f.firstDeepPence)} your first time)` : '';
      return {
        key,
        question: "What's in a full analysis and a deep report?",
        answer: `A full analysis is ${formatPence(f.fullPence)}${welcome}: it opens the deal and gives 12 months of short-let income, costs, comparables and due-diligence checks, with a PDF. A deep report adds PMI's second opinion for ${deep}${first}.`,
        action: null,
      };
    }
    case 'free_delay':
      if (!f.freeMember || f.freeDelayHours <= 0) return null;
      return {
        key,
        question: 'Why do free members see deals later?',
        answer: `Free members see a new deal ${f.freeDelayHours} hours after it goes live; members who have paid see it straight away.`,
        action: { label: 'See plans', href: '/pricing' },
      };
    case 'calls':
      return {
        key,
        question: 'How do calls from you work?',
        answer: `I only call if you've said yes: about ${formatPence(f.call.perMinPence)} a minute from your credit, missed calls free, texts ${formatPence(f.call.textPence)}, emails ${formatPence(f.call.emailPence)}. I'm not making calls yet.`,
        action: { label: 'Notification settings', href: '/account/notifications' },
      };
    case 'topup':
      return {
        key,
        question: 'How do I top up or turn on auto top-up?',
        answer: `Top up ${list(f.topupPresetsPence.map(formatPence))} in Account → Billing. Auto top-up adds your chosen amount when you drop below your limit; it needs a saved card.`,
        action: f.autoTopupOn ? null : { label: 'Turn on auto top-up', href: '/account/billing#auto-topup' },
      };
    case 'no_match':
      if (!f.noMatch) return null;
      return { key, question: "Why can't you find me anything?", answer: f.noMatch, action: null };
  }
}

/** The chips that apply, in order, at most MAX_CHIPS. */
export function answersFor(f: AnswerFacts): Answer[] {
  const out: Answer[] = [];
  // A low or no match moves its answer to the front: it's the question on their mind.
  const order: ChipKey[] = f.noMatch ? ['no_match', ...CHIP_ORDER.filter((k) => k !== 'no_match')] : [...CHIP_ORDER];
  for (const k of order) {
    const a = one(k, f);
    if (a) out.push(a);
    if (out.length >= MAX_CHIPS) break;
  }
  return out;
}
