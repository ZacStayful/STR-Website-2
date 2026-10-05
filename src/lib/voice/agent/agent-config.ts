/**
 * Batch 23: the whole ElevenLabs agent as one object — prompt (persona +
 * call task + knowledge), opener, the one SI voice, limits, the built-in
 * tools (end call; voicemail: hang up, no message), data collection for an
 * unhappy member, the opener override, and transcript retention.
 *
 * The two webhooks are set on this agent only (ElevenLabs' per-agent
 * workspace_overrides), never in the workspace settings: other agents in the
 * same ElevenLabs workspace have their own.
 *
 * Pure: the server half (sync-server.ts) fetches the live figures and sends it.
 */
import { VOICE } from '../../persona/stayful-intelligence.ts';
import { agentPrompt } from './prompt.ts';
import { CALLBACK_UNKNOWN_OPENER } from './scripts.ts';

export interface AgentConfigInput {
  knowledge: string;
  voiceId: string;
  toolIds: string[];
  maxCallSeconds: number;
  retentionDays: number;
  /** The agent's "who is ringing" webhook (/api/voice/elevenlabs/initiate), or null to leave the agent's as it is. */
  initiationWebhook?: { url: string; secret: string } | null;
  /** The post-call webhook's id (found by its URL), or null to leave the agent's as it is. */
  postCallWebhookId?: string | null;
  /** What the agent has now: sent back where there is nothing to set, so a sync never wipes an override. */
  current?: AgentPlatformNow;
}

/** The parts of the agent's platform_settings a sync must keep when it has nothing newer. */
export interface AgentPlatformNow {
  fetchInitiation?: boolean;
  initiationWebhook?: unknown;
  webhooks?: Record<string, unknown>;
}

/**
 * The post-call events the agent's webhook sends: the ones
 * /api/voice/elevenlabs/webhook handles (src/lib/voice/elevenlabs.ts
 * parseWebhook), keyed by ElevenLabs' setting name. No audio.
 */
export const POST_CALL_EVENTS = {
  transcript: 'post_call_transcription',
  call_initiation_failure: 'call_initiation_failure',
  answering_machine_detection: 'answering_machine_detection',
} as const;

/** The header ElevenLabs sends to /api/voice/elevenlabs/initiate (ELEVENLABS_INITIATE_SECRET). */
export const INITIATE_SECRET_HEADER = 'x-si-secret';

function workspaceOverrides(i: AgentConfigInput): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (i.initiationWebhook) out.conversation_initiation_client_data_webhook = { url: i.initiationWebhook.url, request_headers: { [INITIATE_SECRET_HEADER]: i.initiationWebhook.secret } };
  else if (i.current?.initiationWebhook !== undefined) out.conversation_initiation_client_data_webhook = i.current.initiationWebhook;
  if (i.postCallWebhookId) out.webhooks = { ...(i.current?.webhooks ?? {}), post_call_webhook_id: i.postCallWebhookId, events: Object.keys(POST_CALL_EVENTS) };
  else if (i.current?.webhooks) out.webhooks = i.current.webhooks;
  return Object.keys(out).length ? out : null;
}

export function agentConfig(i: AgentConfigInput): Record<string, unknown> {
  const workspace = workspaceOverrides(i);
  return {
    name: 'Stayful Intelligence',
    conversation_config: {
      agent: {
        first_message: CALLBACK_UNKNOWN_OPENER,
        language: 'en',
        prompt: {
          prompt: agentPrompt(i.knowledge),
          tool_ids: i.toolIds,
          built_in_tools: {
            end_call: { type: 'system', name: 'end_call', description: 'End the call when it is finished.', params: { system_tool_type: 'end_call' } },
            voicemail_detection: { type: 'system', name: 'voicemail_detection', description: 'If a voicemail or answering machine answers, end the call at once without leaving a message.', params: { system_tool_type: 'voicemail_detection', voicemail_message: '' } },
          },
        },
      },
      tts: { voice_id: i.voiceId, model_id: VOICE.agentModelId, stability: VOICE.stability, similarity_boost: VOICE.similarityBoost },
      conversation: { max_duration_seconds: i.maxCallSeconds },
    },
    platform_settings: {
      overrides: {
        conversation_config_override: { agent: { first_message: true } },
        // Inbound calls ask /api/voice/elevenlabs/initiate who is ringing (the caller's name, variables and opener).
        enable_conversation_initiation_client_data_from_webhook: i.initiationWebhook ? true : (i.current?.fetchInitiation ?? false),
      },
      ...(workspace ? { workspace_overrides: workspace } : {}),
      data_collection: {
        member_unhappy: { type: 'boolean', description: 'True if the caller seemed unhappy with an answer: said it was not what they asked, or asked the same question twice.' },
      },
      privacy: { retention_days: i.retentionDays },
    },
  };
}

const sameUrl = (a: string, b: string) => a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase();

/**
 * The workspace webhook (GET /v1/workspace/webhooks) whose URL is our
 * post-call URL, a trailing slash ignored. One switched off by hand is
 * skipped; one ElevenLabs switched off after failures is returned last, and
 * flagged, so the Dry run can say so. Null when there is none.
 */
export function pickPostCallWebhook(list: unknown, url: string): { id: string; autoDisabled: boolean } | null {
  const hooks = (list && typeof list === 'object' && Array.isArray((list as { webhooks?: unknown }).webhooks) ? (list as { webhooks: unknown[] }).webhooks : []) as Record<string, unknown>[];
  const matches = hooks
    .filter((h) => h && typeof h.webhook_id === 'string' && h.webhook_id && typeof h.webhook_url === 'string' && sameUrl(h.webhook_url, url) && h.is_disabled !== true)
    .map((h) => ({ id: h.webhook_id as string, autoDisabled: h.is_auto_disabled === true }));
  return matches.find((m) => !m.autoDisabled) ?? matches[0] ?? null;
}
