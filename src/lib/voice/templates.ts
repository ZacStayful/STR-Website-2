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

/** Short paths the texts link to (each redirects or serves; see src/app/si). */
export const CONTACT_CARD_PATH = '/si/card';
export const AUTO_TOPUP_PATH = '/si/topup';
/** Where /si/topup lands (sign-in required). */
export const AUTO_TOPUP_PAGE = '/account/billing/auto-topup';

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
}

const link = (base: string, path: string) => `${base.replace(/\/$/, '')}${path}`;

/** The texts the agent may send during a call. */
export function callText(template: Exclude<CallTextTemplate, 'resend_last_link'>, c: LinkContext): string {
  switch (template) {
    case 'contact_card':
      return text(`Here's my contact card. Tap to save me, so you know it's me when I call: ${link(c.base, CONTACT_CARD_PATH)}`);
    case 'auto_topup_link':
      return text(`Your one-tap link to turn on auto top-up (${pounds(c.topupAmountPence)} when you drop below ${pounds(c.topupThresholdPence)}): ${link(c.base, AUTO_TOPUP_PATH)}`);
  }
}

/** "I tried to call you" texts, after a missed outbound call. */
export function missedCallText(type: 'intro' | 'low_credit', c: LinkContext): string {
  if (type === 'intro') return text(`I tried to call to introduce myself. Save my number so you know it's me: ${link(c.base, CONTACT_CARD_PATH)}`);
  return text(`I tried to call you - you're nearly out of credit. Auto top-up in one tap: ${link(c.base, AUTO_TOPUP_PATH)}`);
}

/** Which template a missed call's text resends the link of. */
export function missedCallTemplate(type: 'intro' | 'low_credit'): 'contact_card' | 'auto_topup_link' {
  return type === 'intro' ? 'contact_card' : 'auto_topup_link';
}

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
export function missedCallEmail(type: 'intro' | 'low_credit', c: Pick<LinkContext, 'topupAmountPence' | 'topupThresholdPence'>, firstName: string | null): EmailCopy {
  const hi = firstName ? `Hi ${firstName},` : 'Hi,';
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
