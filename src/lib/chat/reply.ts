/**
 * Batch 26: what the chat sends back to the page, for both surfaces. Pure,
 * so the components and the routes share one shape.
 */
import type { ChatButton } from './actions.ts';
import {
  DID_NOT_FINISH_LINE,
  DONT_KNOW_LINE,
  FAILED_LINE,
  FULL_VIEW_LINE,
  SEAT_PAUSED_LINE,
  TEAM_TOP_UP_LINE,
  TOO_FAST_LINE,
  TOP_UP_LINE,
  UNCHARGED_CAP_LINE,
} from './config.ts';

export type ChatState =
  | 'answer' // an answer, charged (or an admin's, free)
  | 'full_view' // the quick box needs the member's deals: "Ask in the full view"
  | 'unknown' // no approved answer: "I don't know that one yet"
  | 'top_up' // under the floor: "Top up to ask me more"
  | 'seat_paused'
  | 'too_fast'
  | 'uncharged_cap'
  | 'busy' // another question from this member is still being answered
  | 'did_not_finish' // a retry of a question that failed part-way
  | 'failed'
  | 'off';

export interface ChatReply {
  state: ChatState;
  turnId: string | null;
  text: string;
  buttons: ChatButton[];
  /** "Charged 0.8p" under an answer; null when nothing was charged. */
  charged: string | null;
  /** The full view's conversation, for the next question. */
  conversationId?: string | null;
  /** "Want me to remember that?" with the fact, when the answer proposed one. */
  factProposal?: string | null;
  /** The answer was cut short at the question's ceiling. */
  capped?: boolean;
}

/** What a page needs to draw the chat (src/lib/chat/turns-server.ts chatUi); null while it is off. */
export interface ChatUi {
  quickHintPence: number;
  fullHintPence: number;
  quickFloorPence: number;
  fullFloorPence: number;
}

/** The full view's stream: start, thinking, text as it comes, cleared or replaced, then the reply. */
export type FullEvent =
  | { type: 'start'; turnId: string }
  | { type: 'thinking' }
  | { type: 'delta'; text: string }
  | { type: 'clear' }
  | { type: 'replace'; text: string }
  | { type: 'done'; reply: ChatReply };

/** The fixed reply for a state that has no answer of its own. */
export function stateReply(state: Exclude<ChatState, 'answer'>, o: { turnId?: string | null; teamMember?: boolean } = {}): ChatReply {
  const text: Record<Exclude<ChatState, 'answer'>, string> = {
    full_view: FULL_VIEW_LINE,
    unknown: DONT_KNOW_LINE,
    top_up: o.teamMember ? TEAM_TOP_UP_LINE : TOP_UP_LINE,
    seat_paused: SEAT_PAUSED_LINE,
    too_fast: TOO_FAST_LINE,
    uncharged_cap: UNCHARGED_CAP_LINE,
    busy: 'I’m still answering your last question.',
    did_not_finish: DID_NOT_FINISH_LINE,
    failed: FAILED_LINE,
    off: 'Questions aren’t switched on just now.',
  };
  return { state, turnId: o.turnId ?? null, text: text[state], buttons: [], charged: null };
}
