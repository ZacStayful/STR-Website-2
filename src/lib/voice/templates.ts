/**
 * Batch 23: every text and email Stayful Intelligence sends around a call,
 * in one editable place. Batch 24's knowledge base will refine the wording
 * here; nothing else in the code writes member-facing call wording.
 *
 * Tone: the persona's sms and email channel rules
 * (src/lib/persona/stayful-intelligence.ts): first person, one or two
 * sentences per text, signed off as Stayful Intelligence. Every text is one
 * GSM-7 segment ending "Reply STOP to opt out" (the rules sendSms enforces;
 * templates.test.ts checks each one with a real link).
 *
 * The agent can only ever choose a template name — never the words.
 *
 * Pure: no network, no database, no server-only.
 */
import { OPT_OUT_LINE, toGsm } from '../sms/gsm.ts';
import { PERSONA_NAME, SMS_SIGN_OFF } from '../persona/stayful-intelligence.ts';
import type { CallTextTemplate } from './config.ts';
import { bodyProblemFor } from './templates-check.ts';

/** Short paths the texts link to (each redirects or serves; see src/app/si). */
export const CONTACT_CARD_PATH = '/si/card';
export const AUTO_TOPUP_PATH = '/si/topup';
/** Where /si/topup lands (sign-in required). */
export const AUTO_TOPUP_PAGE = '/account/billing/auto-topup';
/** Batch 25: a standout deal's short link (/si/deal/<token> → the deal in the app, sign-in required; never the listing). */
export const DEAL_LINK_PATH = '/si/deal/';
export const dealLinkPath = (token: string) => `${DEAL_LINK_PATH}${token}`;

const pounds = (pence: number) => `£${pence % 100 === 0 ? pence / 100 : (pence / 100).toFixed(2)}`;

/** A text body: the sentence(s), the sign-off, the STOP line, in GSM-7. */
function text(lines: string, signOff = true): string {
  return toGsm([lines, ...(signOff ? [SMS_SIGN_OFF] : []), OPT_OUT_LINE].join('\n'));
}

export interface LinkContext {
  /** The site's base URL (siteUrl()). */
  base: string;
  /** The auto top-up offer, from settings (reveal_auto_topup_amount_pence / _threshold_pence). */
  topupAmountPence: number;
  topupThresholdPence: number;
  /** Batch 25: the deal a deal call is about (src/lib/standout/copy.ts). Never an address or a price. */
  deal?: DealFacts | null;
}

/** Batch 25: what the call's texts and emails say about the deal. */
export interface DealFacts {
  /** "the 2-bed in Harrogate" */
  short: string;
  /** "a 2-bed flat to rent in Harrogate that could make around £1,100–£1,300 a month" */
  headline: string;
  /** The decision's link token: /si/deal/<token>. */
  token: string;
}

const link = (base: string, path: string) => `${base.replace(/\/$/, '')}${path}`;

/** The first wording that fits one GSM-7 segment (a long town name can push a text over 160). */
function firstThatFits(...bodies: string[]): string {
  return bodies.find((b) => bodyProblemFor(b) === null) ?? bodies[bodies.length - 1];
}

/** Batch 25: the text a deal call sends (deal_link), and the one a missed deal call sends. */
export function dealLinkText(c: LinkContext): string {
  const d = c.deal;
  if (!d) return text(`It's saved in your deals: ${link(c.base, '/my-deals')}`);
  const url = link(c.base, dealLinkPath(d.token));
  return firstThatFits(text(`Here's ${d.short} I just rang about. It's in your deals: ${url}`), text(`Here's the deal I just rang about. It's in your deals: ${url}`), text(`It's in your deals: ${url}`));
}

/** The texts the agent may send during a call. */
export function callText(template: Exclude<CallTextTemplate, 'resend_last_link'>, c: LinkContext): string {
  switch (template) {
    case 'contact_card':
      return text(`Here's my contact card. Tap to save me, so you know it's me when I call: ${link(c.base, CONTACT_CARD_PATH)}`);
    case 'auto_topup_link':
      return text(`Your one-tap link to turn on auto top-up (${pounds(c.topupAmountPence)} when you drop below ${pounds(c.topupThresholdPence)}): ${link(c.base, AUTO_TOPUP_PATH)}`);
    case 'deal_link':
      return dealLinkText(c);
  }
}

/** The outbound call types (callbacks are the member ringing in). */
export type OutboundCallType = 'intro' | 'low_credit' | 'deal';

/** "I tried to call you" texts, after a missed outbound call. */
export function missedCallText(type: OutboundCallType, c: LinkContext): string {
  if (type === 'intro') return text(`I tried to call to introduce myself. Save my number so you know it's me: ${link(c.base, CONTACT_CARD_PATH)}`);
  if (type === 'deal') {
    const d = c.deal;
    const url = d ? link(c.base, dealLinkPath(d.token)) : link(c.base, '/my-deals');
    return firstThatFits(...(d ? [text(`I tried to call you about ${d.short}. It's in your deals: ${url}`)] : []), text(`I tried to call you about a deal. It's in your deals: ${url}`), text(`I tried to call you. It's in your deals: ${url}`));
  }
  return text(`I tried to call you - you're nearly out of credit. Auto top-up in one tap: ${link(c.base, AUTO_TOPUP_PATH)}`);
}

/** Which template a missed call's text resends the link of. */
export function missedCallTemplate(type: OutboundCallType): 'contact_card' | 'auto_topup_link' | 'deal_link' {
  return type === 'intro' ? 'contact_card' : type === 'deal' ? 'deal_link' : 'auto_topup_link';
}

/**
 * Batch 25: a standout saved for a member whose credit is below the deal-call
 * floor: no call, this text instead (texts on and credit for it).
 */
export function belowFloorText(c: LinkContext): string {
  const d = c.deal;
  const url = d ? link(c.base, dealLinkPath(d.token)) : link(c.base, '/my-deals');
  const what = d ? d.short.replace(/^the /, 'a ') : 'a deal';
  return firstThatFits(text(`${capital(what)} that fits you is in your deals: ${url} Top up to get calls.`), text(`A deal that fits you is in your deals: ${url} Top up to get calls.`), text(`A deal is saved in your deals: ${url}`));
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Automatic replies to texts sent to the number (Part E). */
export const SMS_REPLY_WHO = text(`It's ${PERSONA_NAME}, your AI property assistant from Stayful. Ring me on this number any time.`, false);
export const SMS_REPLY_OTHER = text(`Thanks, I've passed that on. You can also ring me on this number.`);

export interface EmailCopy {
  subject: string;
  title: string;
  paragraphs: string[];
  cta: { label: string; path: string };
}

/** "I tried to call you" emails, with the same link the call would have texted. */
export function missedCallEmail(type: OutboundCallType, c: Pick<LinkContext, 'topupAmountPence' | 'topupThresholdPence' | 'deal'> & { callsPerMonth?: number }, firstName: string | null): EmailCopy {
  const hi = firstName ? `Hi ${firstName},` : 'Hi,';
  if (type === 'deal') return dealEmail('missed', c.deal ?? null, firstName, c.callsPerMonth ?? null);
  if (type === 'intro') {
    return {
      subject: 'I tried to call to introduce myself',
      title: 'I tried to call to introduce myself',
      paragraphs: [
        `${hi} it's ${PERSONA_NAME}, your AI property assistant from Stayful. I'm the one searching thousands of short-let deals for you every day.`,
        "I'll only call when there's something worth your time: I'll give you the headline and text you the link. You can ring me back on the number I called from, any time.",
        "Save my contact card so you know it's me when I call.",
      ],
      cta: { label: 'Save my contact card', path: CONTACT_CARD_PATH },
    };
  }
  return {
    subject: "I tried to call you — you're nearly out of credit",
    title: "I tried to call you — you're nearly out of credit",
    paragraphs: [
      `${hi} it's ${PERSONA_NAME}. Your credit is running low, so your daily picks could stop soon.`,
      `Auto top-up adds ${pounds(c.topupAmountPence)} whenever you drop below ${pounds(c.topupThresholdPence)}, so I never stop searching for you. It's one tap to switch on, and you can change or turn it off any time in Account → Billing.`,
    ],
    cta: { label: 'Turn on auto top-up', path: AUTO_TOPUP_PATH },
  };
}

/**
 * Batch 25: the email about a standout deal — after a missed deal call
 * ("I tried to ring you"), or instead of a call when the member's credit is
 * below the floor. The link goes to the deal in the app, never the listing.
 */
export function dealEmail(kind: 'missed' | 'below_floor', deal: DealFacts | null, firstName: string | null, callsPerMonth: number | null): EmailCopy {
  const hi = firstName ? `Hi ${firstName},` : 'Hi,';
  const what = deal ? deal.headline : 'a deal';
  const where = deal ? deal.short.replace(/^the /, 'a ') : 'a deal';
  const path = deal ? `${dealLinkPath(deal.token)}?via=email` : '/my-deals';
  if (kind === 'missed') {
    return {
      subject: `I tried to call you about ${where}`,
      title: `I tried to call you about ${where}`,
      paragraphs: [
        `${hi} I tried to ring you just now. A deal has come up that matches what you're looking for better than anything I've found so far: ${what}.`,
        "I've saved it to your deals, and opening it is free.",
        ...(callsPerMonth ? [`I call about deals like this at most ${callsPerMonth === 1 ? 'once' : callsPerMonth === 2 ? 'twice' : `${callsPerMonth} times`} a month.`] : []),
      ],
      cta: { label: 'See the deal', path },
    };
  }
  return {
    subject: `I've saved a deal for you: ${where}`,
    title: `I've saved a deal for you`,
    paragraphs: [
      `${hi} a deal has come up that matches what you're looking for better than anything I've found so far: ${what}.`,
      "I've saved it to your deals, and opening it is free.",
      'Top up to get a call from me next time one like this comes up.',
    ],
    cta: { label: 'See the deal', path },
  };
}
