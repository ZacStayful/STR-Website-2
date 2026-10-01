/**
 * Batch 23: the dynamic variables every call carries, the openers they pick,
 * and the one place both outbound calls and inbound callbacks build them.
 * ElevenLabs requires every variable the agent uses on every call, so all of
 * them are always sent. None is a balance, an address or a deal figure.
 *
 * Pure.
 */
import { PERSONA_VERSION } from '../../persona/stayful-intelligence.ts';
import type { CallType } from '../config.ts';
import {
  CALLBACK_MEMBER_OPENER,
  CALLBACK_MISSED_INTRO_OPENER,
  CALLBACK_MISSED_LOW_CREDIT_OPENER,
  CALLBACK_UNKNOWN_OPENER,
  INTRO_OPENER,
  LOW_CREDIT_OPENER,
} from './scripts.ts';

/** What the agent is told about why this call is happening. */
export type CallContext = 'intro' | 'low_credit' | 'missed_intro' | 'missed_low_credit' | 'member' | 'unknown';

export const VARIABLE_NAMES = ['first_name', 'caller_status', 'call_type', 'context', 'card_sent', 'minutes_available', 'topup_amount', 'topup_threshold', 'persona_version'] as const;

export interface VariablesInput {
  callType: CallType;
  context: CallContext;
  firstName: string | null;
  member: boolean;
  cardSent: boolean;
  /** Whole minutes the call may last (the balance and the max call length). */
  minutesAvailable: number;
  topupAmountPence: number;
  topupThresholdPence: number;
}

const pounds = (pence: number) => (pence % 100 === 0 ? `${pence / 100} pounds` : `£${(pence / 100).toFixed(2)}`);

export function callVariables(i: VariablesInput): Record<string, string | number | boolean> {
  return {
    first_name: i.firstName ?? 'there',
    caller_status: i.member ? 'member' : 'unknown',
    call_type: i.callType,
    context: i.context,
    card_sent: i.cardSent,
    minutes_available: Math.max(0, Math.floor(i.minutesAvailable)),
    topup_amount: pounds(i.topupAmountPence),
    topup_threshold: pounds(i.topupThresholdPence),
    persona_version: PERSONA_VERSION,
  };
}

/** The first thing the agent says. */
export function openerFor(context: CallContext): string {
  switch (context) {
    case 'intro':
      return INTRO_OPENER;
    case 'low_credit':
      return LOW_CREDIT_OPENER;
    case 'missed_intro':
      return CALLBACK_MISSED_INTRO_OPENER;
    case 'missed_low_credit':
      return CALLBACK_MISSED_LOW_CREDIT_OPENER;
    case 'member':
      return CALLBACK_MEMBER_OPENER;
    case 'unknown':
      return CALLBACK_UNKNOWN_OPENER;
  }
}

/** Fill {{name}} placeholders for an opener sent as an override (ElevenLabs fills them too). */
export function fill(template: string, vars: Record<string, string | number | boolean>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : ''));
}
