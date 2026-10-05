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
  /** Defaults for every variable (variables.ts unknownCallerDefaults), so a call never fails on a missing one. */
  variableDefaults?: Record<string, string | number | boolean>;
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
        ...(i.variableDefaults ? { dynamic_variables: { dynamic_variable_placeholders: Object.fromEntries(Object.entries(i.variableDefaults).filter(([k]) => !k.startsWith('secret__'))) } } : {}),
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
  const matches = listedWebhooks(list)
    .filter((h) => typeof h.webhook_url === 'string' && sameUrl(h.webhook_url, url) && h.is_disabled !== true)
    .map((h) => ({ id: h.webhook_id as string, autoDisabled: h.is_auto_disabled === true }));
  return matches.find((m) => !m.autoDisabled) ?? matches[0] ?? null;
}

function listedWebhooks(list: unknown): Record<string, unknown>[] {
  const hooks = list && typeof list === 'object' && Array.isArray((list as { webhooks?: unknown }).webhooks) ? (list as { webhooks: unknown[] }).webhooks : [];
  return hooks.filter((h): h is Record<string, unknown> => Boolean(h) && typeof h === 'object' && typeof (h as Record<string, unknown>).webhook_id === 'string' && Boolean((h as Record<string, unknown>).webhook_id));
}

/** The webhook with this id, if it is still there and not switched off by hand. */
export function webhookById(list: unknown, id: string): { id: string; autoDisabled: boolean } | null {
  const h = listedWebhooks(list).find((w) => w.webhook_id === id && w.is_disabled !== true);
  return h ? { id, autoDisabled: h.is_auto_disabled === true } : null;
}

/** The name of the post-call webhook the Sync creates (ElevenLabs → Settings → Webhooks). */
export const POST_CALL_WEBHOOK_NAME = 'Stayful Intelligence calls (made by the app)';

/** POST /v1/workspace/webhooks with HMAC auth answers { webhook_id, webhook_secret }: the only time the secret is given. */
export function parseCreatedWebhook(json: unknown): { id: string; secret: string } | null {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  return typeof j.webhook_id === 'string' && j.webhook_id && typeof j.webhook_secret === 'string' && j.webhook_secret ? { id: j.webhook_id, secret: j.webhook_secret } : null;
}

/**
 * Workspace settings (GET /v1/convai/settings) that point at this site.
 * They apply to every agent in the ElevenLabs workspace, so other agents'
 * calls would come here and be refused; this agent has its own (set by the
 * Sync). Read only: the Sync never changes the workspace settings.
 */
export function workspaceWarnings(settings: unknown, list: unknown, siteBase: string): string[] {
  const s = (settings && typeof settings === 'object' ? settings : {}) as { webhooks?: { post_call_webhook_id?: unknown } | null; conversation_initiation_client_data_webhook?: { url?: unknown } | null };
  const base = siteBase.trim().replace(/\/+$/, '').toLowerCase();
  const ours = (u: unknown) => typeof u === 'string' && u.trim().toLowerCase().startsWith(`${base}/`);
  const out: string[] = [];
  const postId = s.webhooks?.post_call_webhook_id;
  const hook = typeof postId === 'string' ? listedWebhooks(list).find((h) => h.webhook_id === postId) : undefined;
  if (hook && ours(hook.webhook_url)) out.push(`warning: the workspace's post-call webhook (used by every agent) is ${String(hook.webhook_url)}, so your other agents' call results come here and are refused. In ElevenLabs → Agents → Settings, set it back to what it was (your other agents' webhook, or none). This agent gets its own from the Sync.`);
  const initUrl = s.conversation_initiation_client_data_webhook?.url;
  if (ours(initUrl)) out.push(`warning: the workspace's conversation-initiation webhook (used by every agent) is ${String(initUrl)}. Clear it in ElevenLabs → Agents → Settings: this agent gets its own from the Sync.`);
  return out;
}

/**
 * The ElevenLabs number (GET /v1/convai/phone-numbers/{id}): its number and
 * the agent that answers its incoming calls. Outbound calls name the agent
 * each time; incoming calls go only to the assigned agent, and are refused
 * (the caller hears busy) when there is none.
 */
export function phoneAssignment(json: unknown, agentId: string): { phone: string | null; assignedId: string | null; assignedName: string | null; ours: boolean } {
  const j = (json && typeof json === 'object' ? json : {}) as { phone_number?: unknown; assigned_agent?: { agent_id?: unknown; agent_name?: unknown } | null };
  const assignedId = typeof j.assigned_agent?.agent_id === 'string' && j.assigned_agent.agent_id ? j.assigned_agent.agent_id : null;
  return {
    phone: typeof j.phone_number === 'string' && j.phone_number ? j.phone_number : null,
    assignedId,
    assignedName: typeof j.assigned_agent?.agent_name === 'string' && j.assigned_agent.agent_name ? j.assigned_agent.agent_name : null,
    ours: assignedId === agentId,
  };
}

/** Twilio hands a number's calls to ElevenLabs when its Voice URL is ElevenLabs' (set when the number is imported there). */
export function isElevenLabsVoiceUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'elevenlabs.io' || host.endsWith('.elevenlabs.io');
  } catch {
    return false;
  }
}
