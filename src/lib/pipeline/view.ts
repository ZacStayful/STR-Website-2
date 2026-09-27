/**
 * What the next-step slot shows for one deal at one stage: the content
 * (next-steps.ts) filled with the deal's facts, as finished strings. The
 * browser gets only this, never a template or a fact it may not see.
 *
 * Per stage:
 *   Kept       Contact the agent: the enquiry message, then → Contacted
 *   Contacted  Book a viewing: the follow-up message, then → Viewing
 *   Viewing    Check it works as a short let: a checklist, then → Offer
 *   Offer      Make your offer: the offer range and message, then → Secured
 *   Secured    What's next: a checklist and the "Talk to us" line
 *   Passed     Only "Move back to Kept"
 *
 * Pure: no network, no database, no `server-only`.
 */
import type { PipelineStatus } from '../listing/pipeline.ts';
import { NEXT_STEPS } from './next-steps.ts';
import { fillTemplate } from './render.ts';
import { countWord, formatAge, gbp, messageFields, offMarketReason, priceIsStale, stepKindOf, timeOnMarket, type DealFacts } from './facts.ts';
import { OFFER_SLOT } from './offer-amount.ts';
import type { OfferMissing, OfferRange } from './offer-range.ts';
import { CONTENT_STAGE, type Fields, type NextStepsContent, type StageBlock, type StepKind } from './types.ts';

/** The one move each stage's button makes. Secured is the end of the line. */
export const NEXT_MOVE: Record<PipelineStatus, PipelineStatus | null> = {
  watching: 'contacted',
  contacted: 'viewing',
  viewing: 'offer',
  offer: 'secured',
  secured: null,
  passed: 'watching',
};

/** Where members change their targets (the Market Explorer goals panel). */
export const GOALS_HREF = '/markets?goals=1';

export interface RenderedMessage {
  id: string;
  subject: string;
  body: string;
  /** The offer message with OFFER_SLOT where the member's amount goes; null for other messages. */
  withAmount: { subject: string; body: string } | null;
}

export interface OfferView {
  title: string;
  /** "£171,000 to £182,000", or null when there is no figure to suggest. */
  figure: string | null;
  /** How it was worked out, in one line. */
  working: string | null;
  notes: string[];
  goalsLink: { text: string; href: string } | null;
  /** Shown with any figure. */
  disclaimer: string | null;
  amountLabel: string;
  amountHelp: string;
  /** What the amount box starts with: the bottom of the range. */
  initialAmount: number | null;
}

export interface ManageView {
  line: string;
  linkText: string;
  formIntro: string;
  message: string;
  nameLabel: string;
  emailLabel: string;
  phoneLabel: string;
  messageLabel: string;
  send: string;
  sent: string;
  area: string;
  name: string;
  email: string;
}

export interface NextStepView {
  itemKey: string;
  stage: PipelineStatus;
  kind: StepKind;
  /** Null at Passed, which shows only the move back. */
  heading: string | null;
  intro: string | null;
  warning: string | null;
  message: RenderedMessage | null;
  checklist: { id: string; text: string; ticked: boolean }[] | null;
  offer: OfferView | null;
  manage: ManageView | null;
  move: { label: string; to: PipelineStatus } | null;
  labels: NextStepsContent['buttons'];
}

export interface ViewInput {
  itemKey: string;
  stage: PipelineStatus;
  facts: DealFacts;
  memberName: string | null;
  memberEmail: string | null;
  /** Checklist item ids this member has ticked on this deal. */
  ticks: ReadonlySet<string>;
  /** The computed offer range, at the Offer stage. */
  offer: OfferRange | null;
  finance: { targetYieldPct: number; targetMarginPcm: number };
  now: Date;
  content?: NextStepsContent;
}

const pct = (n: number) => `${Number.isInteger(n) ? n : Math.round(n * 10) / 10}%`;

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function renderMessage(m: { id: string; subject: string; body: string }, fields: Fields, withSlot: boolean): RenderedMessage {
  const subject = fillTemplate(m.subject, fields);
  const body = fillTemplate(m.body, fields);
  const withAmount = withSlot ? { subject: fillTemplate(m.subject, { ...fields, offerAmount: OFFER_SLOT }), body: fillTemplate(m.body, { ...fields, offerAmount: OFFER_SLOT }) } : null;
  return { id: m.id, subject, body, withAmount };
}

function offerView(c: NextStepsContent, kind: StepKind, range: OfferRange, input: ViewInput): OfferView {
  const o = c.offer;
  const k = kind === 'purchase' ? 'purchase' : 'rentToRent';
  const age = timeOnMarket(input.facts, input.now);
  const fields: Fields = {
    targetYield: pct(input.finance.targetYieldPct),
    targetMargin: gbp(input.finance.targetMarginPcm),
    targetCeiling: range.target ? gbp(range.target.ceiling) : null,
    opening: range.opening !== null ? gbp(range.opening) : null,
    low: range.low !== null ? gbp(range.low) : null,
    high: range.high !== null ? gbp(range.high) : null,
    motivated: range.history ? gbp(range.history.motivated) : null,
    timeOnMarket: formatAge(age, kind),
    reductions: range.history ? countWord(range.history.reductions) : null,
  };

  const missingLine: Record<OfferMissing, string> = {
    notMarketplace: o.missing.notMarketplace,
    noAsking: o.missing.noAsking,
    noRevenue: o.missing.noRevenue,
    studio: o.missing.studio,
    noMargin: o.missing.noMargin,
    tooFarBelow: o.missing.tooFarBelow[k],
    bandsNotSet: o.missing.bandsNotSet,
    noHistory: o.missing.noHistory,
  };
  const notes = range.missing.map((m) => fillTemplate(missingLine[m], fields)).filter((s) => s.trim() !== '');

  let figure: string | null = null;
  let working: string | null = null;
  if (range.show && range.shape) {
    figure = fillTemplate(o.figure[k][range.shape], fields) || null;
    const parts: string[] = [];
    if (range.target) parts.push(fillTemplate(range.target.atOrAboveAsking ? o.targetPartAtAsking[k] : o.targetPart[k], fields));
    if (range.history && fields.timeOnMarket) {
      const variants = range.historyIsTop ? o.historyPartTop : o.historyPart;
      const withCuts = kind === 'purchase' && range.history.reductions > 0;
      parts.push(fillTemplate(withCuts ? variants.ageAndCuts : variants.ageOnly, fields));
    }
    const line = parts.filter((p) => p.trim() !== '').join(' · ');
    working = line ? capitalise(line) : null;
    if (priceIsStale(input.facts, input.now)) notes.push(fillTemplate(o.staleAsking, fields));
  }
  const usesTarget = range.target !== null || range.missing.includes('tooFarBelow') || range.missing.includes('noMargin');
  // Which target the figure used (the reasons for no figure already say it).
  if (range.show && range.target) notes.unshift(fillTemplate(o.targetNote[k], fields));

  return {
    title: o.title,
    figure,
    working,
    notes: notes.filter((s) => s.trim() !== ''),
    goalsLink: usesTarget ? { text: o.goalsLink, href: GOALS_HREF } : null,
    disclaimer: figure ? o.disclaimer : null,
    amountLabel: o.amountLabel[k],
    amountHelp: o.amountHelp,
    initialAmount: range.show ? range.opening : null,
  };
}

/** Postcode areas are one or two letters: the management enquiry needs one. */
const AREA = /^[A-Z]{1,2}$/;

/**
 * The next step for one deal, or null when there is none to show: a kind
 * with no content, or a stage with nothing to say. Opened / own checks are
 * the caller's (server.ts), before any fact reaches this function.
 */
export function buildNextStepView(input: ViewInput): NextStepView | null {
  const c: NextStepsContent = input.content ?? NEXT_STEPS;
  const kind = stepKindOf(input.facts.kind);
  if (!kind) return null;
  const k = kind === 'purchase' ? 'purchase' : 'rentToRent';
  const stage = CONTENT_STAGE[input.stage];
  const to = NEXT_MOVE[input.stage];
  const move = to && stage !== 'secured' ? { label: c.moveButtons[stage], to } : null;
  const base = { itemKey: input.itemKey, stage: input.stage, kind, labels: c.buttons };

  if (stage === 'passed') {
    return { ...base, heading: null, intro: null, warning: null, message: null, checklist: null, offer: null, manage: null, move };
  }

  const block: StageBlock = c.stages[stage][k];
  const fields = messageFields(input.facts, kind, input.memberName, input.now);
  const off = offMarketReason(input.facts);
  // At Offer and Secured the member may be why it is under offer: no warning there.
  const warning = off && (stage === 'kept' || stage === 'contacted' || stage === 'viewing') ? c.offMarket[off] : null;
  const message = block.message ? renderMessage(block.message, fields, stage === 'offer') : null;
  const checklist = block.checklist ? block.checklist.map((i) => ({ id: i.id, text: i.text, ticked: input.ticks.has(i.id) })) : null;
  const offer = stage === 'offer' && input.offer ? offerView(c, kind, input.offer, input) : null;

  let manage: ManageView | null = null;
  const area = (input.facts.postcodeArea ?? '').toUpperCase();
  if (stage === 'secured' && AREA.test(area)) {
    const m = c.manage;
    manage = {
      line: m.line,
      linkText: m.linkText,
      formIntro: m.formIntro,
      message: fillTemplate(m.message, fields),
      nameLabel: m.nameLabel,
      emailLabel: m.emailLabel,
      phoneLabel: m.phoneLabel,
      messageLabel: m.messageLabel,
      send: m.send,
      sent: m.sent,
      area,
      name: fields.memberName ?? '',
      email: input.memberEmail ?? '',
    };
  }

  return { ...base, heading: block.heading, intro: block.intro, warning, message, checklist, offer, manage, move };
}
