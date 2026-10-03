/**
 * Batch 23: the agent's server tools as ElevenLabs webhook-tool configs.
 * Every request carries ids ElevenLabs injects (system__ dynamic variables,
 * never filled by the model) and the tool secret in a header from a secret__
 * dynamic variable (never sent to the model). The routes are
 * /api/voice/tools/[tool].
 *
 * The shapes follow ElevenLabs' tools API: a header value from a dynamic
 * variable is `{ variable_name }`, and each body property carries exactly one
 * value source (`description` for the model to fill, or `dynamic_variable`).
 *
 * Pure.
 */
import { CALL_TEXT_TEMPLATES, QUESTION_OUTCOMES, type ToolName } from '../config.ts';

interface Param {
  type: 'string' | 'integer' | 'boolean';
  description: string;
  enum?: readonly string[];
  dynamic_variable?: string;
}

const INJECTED: Record<string, Param> = {
  conversation_id: { type: 'string', description: 'The conversation id (injected).', dynamic_variable: 'system__conversation_id' },
  call_sid: { type: 'string', description: 'The call id (injected).', dynamic_variable: 'system__call_sid' },
  caller_id: { type: 'string', description: 'The calling number (injected).', dynamic_variable: 'system__caller_id' },
  called_number: { type: 'string', description: 'The called number (injected).', dynamic_variable: 'system__called_number' },
};

const TOOLS: Record<ToolName, { description: string; params: Record<string, Param>; required: string[] }> = {
  lookup_caller: {
    description: "Who the caller is: first name, whether they're a member, and why I last called them. Never a balance, an address or a deal.",
    params: { number: { type: 'string', description: 'Ignored: the caller is always the number on this call.' } },
    required: [],
  },
  send_template_text: {
    description: "Text a pre-written message to the member's own number on file (never any other number).",
    params: { template: { type: 'string', description: 'contact_card, auto_topup_link or resend_last_link', enum: CALL_TEXT_TEMPLATES } },
    required: ['template'],
  },
  handoff_to_team: {
    description: "Pass something I can't handle to the Stayful team, who reply by email.",
    params: {
      question: { type: 'string', description: "The caller's question in one line." },
      summary: { type: 'string', description: 'A short summary of what was said.' },
    },
    required: ['question', 'summary'],
  },
  log_question: {
    description: 'Record a question the caller asked and how it went.',
    params: {
      question: { type: 'string', description: 'The question, in the caller’s words.' },
      outcome: { type: 'string', description: 'answered, low_confidence, could_not_answer, member_unhappy or handed_off', enum: QUESTION_OUTCOMES },
      knowledge_ref: { type: 'string', description: 'The knowledge id in square brackets used to answer, if any.' },
    },
    required: ['question', 'outcome'],
  },
  remember_fact: {
    description: "Remember one thing about the member for next time, only after you asked \"Want me to remember that?\" and they said yes. Property preferences and plans only: never health, money beyond their profile, or anything about other people.",
    params: {
      fact: { type: 'string', description: 'The fact in a few words, about the member, without names or numbers they did not give, e.g. "Prefers 2-bed flats near stations".' },
      asked: { type: 'string', description: 'The question you asked them, e.g. "Want me to remember you prefer 2-beds?"' },
      member_said_yes: { type: 'boolean', description: 'True only if they clearly said yes to remembering it.' },
    },
    required: ['fact', 'asked', 'member_said_yes'],
  },
};

export function toolConfig(name: ToolName, baseUrl: string): Record<string, unknown> {
  const t = TOOLS[name];
  const properties: Record<string, unknown> = {};
  for (const [k, p] of Object.entries({ ...INJECTED, ...t.params })) {
    // Exactly one value source per property: an injected id never also carries a description.
    properties[k] = p.dynamic_variable ? { type: p.type, dynamic_variable: p.dynamic_variable } : { type: p.type, description: p.description, ...(p.enum ? { enum: [...p.enum] } : {}) };
  }
  return {
    type: 'webhook',
    name,
    description: t.description,
    response_timeout_secs: 10,
    api_schema: {
      url: `${baseUrl.replace(/\/$/, '')}/api/voice/tools/${name}`,
      method: 'POST',
      request_headers: { 'x-si-tool-token': { variable_name: 'secret__tool_token' } },
      request_body_schema: { type: 'object', properties, required: [...Object.keys(INJECTED).filter((k) => k !== 'caller_id' && k !== 'called_number' && k !== 'call_sid'), ...t.required] },
    },
  };
}
