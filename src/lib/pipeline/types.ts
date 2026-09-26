/**
 * The shapes behind the next-step content (next-steps.ts): which stages and
 * kinds there are, which merge fields a message may use, and what each
 * stage's block holds. Kept apart from the content so that file stays
 * readable text.
 *
 * Pure: no network, no database, no `server-only`.
 */
import type { PipelineStatus } from '../listing/pipeline.ts';

/** How the content file names the stages. Batch 5 stores Kept as 'watching'. */
export type ContentStage = 'kept' | 'contacted' | 'viewing' | 'offer' | 'secured' | 'passed';

export const CONTENT_STAGE: Record<PipelineStatus, ContentStage> = {
  watching: 'kept',
  contacted: 'contacted',
  viewing: 'viewing',
  offer: 'offer',
  secured: 'secured',
  passed: 'passed',
};

/** A purchase (buying the property) or a rent-to-rent (renting it to run as a short let). */
export type StepKind = 'purchase' | 'rent-to-rent';

/**
 * Merge fields a message to an agent or landlord may use. Every one of them
 * can be missing on a given deal, so every one must sit inside [square
 * brackets] in a message: see next-steps.ts.
 */
export const MESSAGE_FIELDS = ['address', 'town', 'bedrooms', 'askingPrice', 'askingRent', 'timeOnMarket', 'memberName', 'offerAmount'] as const;
export type MessageField = (typeof MESSAGE_FIELDS)[number];

/**
 * Fields for the offer range's own lines (the working line and the reasons a
 * figure is missing). The code decides which line is shown, so these are
 * always filled when their line appears.
 */
export const OFFER_FIELDS = ['targetYield', 'targetMargin', 'targetCeiling', 'opening', 'low', 'high', 'motivated', 'timeOnMarket', 'reductions'] as const;
export type OfferField = (typeof OFFER_FIELDS)[number];

export type Fields = Partial<Record<string, string | null>>;

/** A message the member copies or opens in their email. `id` names it in the usage tracking. */
export interface MessageBlock {
  id: string;
  subject: string;
  body: string;
}

/** One tickable item. `id` is what the tick is saved under: never rename it once live. */
export interface ChecklistItem {
  id: string;
  text: string;
}

/** What one stage shows for one kind. */
export interface StageBlock {
  heading: string;
  intro: string;
  message?: MessageBlock;
  checklist?: ChecklistItem[];
}

export interface KindBlocks {
  purchase: StageBlock;
  rentToRent: StageBlock;
}

/** The same wording, one version per kind. */
export interface PerKind {
  purchase: string;
  rentToRent: string;
}

export interface OfferWording {
  title: string;
  figure: { range: string; exact: string; upTo: string; around: string };
  targetPart: PerKind;
  targetPartAtAsking: PerKind;
  historyPart: { ageAndCuts: string; ageOnly: string };
  historyPartTop: { ageAndCuts: string; ageOnly: string };
  targetNote: PerKind;
  goalsLink: string;
  missing: {
    noAsking: string;
    noRevenue: string;
    studio: string;
    noMargin: string;
    tooFarBelow: PerKind;
    notMarketplace: string;
    noHistory: string;
    bandsNotSet: string;
  };
  staleAsking: string;
  disclaimer: string;
  amountLabel: PerKind;
  amountHelp: string;
}

export interface NextStepsContent {
  stages: Record<Exclude<ContentStage, 'passed'>, KindBlocks>;
  moveButtons: Record<Exclude<ContentStage, 'secured'>, string>;
  buttons: { copy: string; copied: string; email: string; copyFallback: string; showStep: string };
  offer: OfferWording;
  offMarket: { sold: string; under_offer: string; let_agreed: string; removed: string };
  manage: {
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
  };
}
