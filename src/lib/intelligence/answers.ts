/**
 * Batch 22, Part E: the question chips on the Stayful Intelligence view.
 *
 * Since Batch 24 the words come only from the knowledge base: each chip is
 * the approved, live knowledge entry whose slug is the chip's key (on the
 * `view` channel), rendered for this member with every figure read from
 * settings at that moment (src/lib/knowledge). An entry that is not
 * approved, is stale or doesn't apply to the member is simply not offered.
 * This module keeps what is not words: the member's own values the answers
 * may use, the order, and each chip's button.
 *
 * Pure: no network, no database, no server-only.
 */
import type { MemberValues } from '../knowledge/placeholders.ts';
import { CHIP_ORDER, MAX_CHIPS } from './config.ts';

export type ChipKey = (typeof CHIP_ORDER)[number];

/** Everything the view knows about the member that an answer or a button may use (view-server.ts works it out). */
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
  /** Batch 23: live = calls are switched on (SI_CALLS_ENABLED); the per-minute price is the si:call_minute unit row's. */
  call: { perMinPence: number; textPence: number; emailPence: number; live?: boolean };
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

/** A knowledge answer as rendered for this member (src/lib/knowledge/store-server.ts renderLive). */
export interface RenderedAnswer {
  slug: string;
  question: string;
  answer: string;
}

/** The member's own values the knowledge answers may use. */
export function memberValuesFrom(f: AnswerFacts): MemberValues {
  return {
    balancePence: f.balancePence,
    checked: f.checked,
    tailored: f.tailored,
    alertsByText: f.alertsByText,
    freeMember: f.freeMember,
    packAvailable: f.pack !== null,
    welcome: f.welcome,
    firstDeepPence: f.firstDeepPence,
    noMatch: f.noMatch,
  };
}

const isChip = (k: string): k is ChipKey => (CHIP_ORDER as readonly string[]).includes(k);

/** Each chip's button: not words members are told, so it stays in code. */
export function actionFor(key: ChipKey, f: AnswerFacts): Answer['action'] {
  switch (key) {
    case 'credits':
      return { label: 'Top up', href: '/account/billing' };
    case 'pack':
      return { label: 'Get the pack', href: '/today?offer=pack' };
    case 'how_picked':
      return f.belowTopLevel ? { label: 'Improve accuracy', href: '/welcome' } : null;
    case 'free_delay':
      return { label: 'See plans', href: '/pricing' };
    case 'calls':
      return { label: 'Notification settings', href: '/account/notifications' };
    case 'topup':
      return f.autoTopupOn ? null : { label: 'Turn on auto top-up', href: '/account/billing#auto-topup' };
    default:
      return null;
  }
}

/**
 * The chips, in order, at most MAX_CHIPS: only keys that have an approved,
 * live answer for this member. A low or no match moves its answer to the
 * front: it's the question on their mind.
 */
export function chipsFor(rendered: readonly RenderedAnswer[], f: AnswerFacts): Answer[] {
  const bySlug = new Map(rendered.filter((r) => isChip(r.slug)).map((r) => [r.slug as ChipKey, r]));
  const order: ChipKey[] = f.noMatch ? ['no_match', ...CHIP_ORDER.filter((k) => k !== 'no_match')] : [...CHIP_ORDER];
  const out: Answer[] = [];
  for (const k of order) {
    const r = bySlug.get(k);
    if (!r) continue;
    out.push({ key: k, question: r.question, answer: r.answer, action: actionFor(k, f) });
    if (out.length >= MAX_CHIPS) break;
  }
  return out;
}
