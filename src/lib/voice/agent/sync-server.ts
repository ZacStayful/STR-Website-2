import 'server-only';

/**
 * Batch 23: push the agent in git (src/lib/voice/agent + src/lib/persona) to
 * ElevenLabs. A dry run shows what would change; apply creates or updates
 * the tools (when `toolsToo`), then PATCHes the agent. The tool ids are kept
 * in billing_settings.si_agent_tool_ids so a second sync updates rather than
 * duplicates them.
 *
 * Batch 24: the knowledge in the prompt is the knowledge base's approved
 * call answers, rendered by src/lib/knowledge (agentKnowledge), with their
 * figures as {{k_*}} variables filled on every call. Call this through
 * src/lib/knowledge/agent-server.ts syncAgentKnowledge, which refuses while a
 * required answer is missing. A prompt that would use a variable calls don't
 * send is refused here.
 *
 * Calls go-live: the sync also sets the agent's two webhooks on this agent
 * only: "who is ringing" (/api/voice/elevenlabs/initiate, with
 * ELEVENLABS_INITIATE_SECRET as its x-si-secret header) and the post-call
 * webhook, found by its URL among the workspace's webhooks (created by hand
 * in ElevenLabs, because only ElevenLabs can make its HMAC secret). The
 * workspace settings, which other agents use, are never touched.
 */
import { createHash } from 'node:crypto';
import { createAdminClient } from '../../supabase/admin';
import { getBillingSettings, updateBillingSetting } from '../../credit/unit-costs';
import { siteUrl } from '../../url';
import { VOICE, voiceId } from '../../persona/stayful-intelligence';
import { promptVariables } from '../../knowledge/agent';
import { TOOL_NAMES, initiateSecret, toolSecret, voiceConfig, webhookSecret, type ToolName } from '../config';
import { elevenLabsJson } from '../elevenlabs-server';
import { toolConfig } from './tools';
import { agentConfig, pickPostCallWebhook, type AgentPlatformNow } from './agent-config';
import { VARIABLE_NAMES } from './variables';

const TOOL_IDS_KEY = 'si_agent_tool_ids';

export interface SyncResult {
  ok: boolean;
  dry: boolean;
  message: string;
  changes: string[];
  promptChars?: number;
}

async function storedToolIds(): Promise<Partial<Record<ToolName, string>>> {
  const { data } = await createAdminClient().from('billing_settings').select('value').eq('key', TOOL_IDS_KEY).maybeSingle();
  const v = (data as { value: unknown } | null)?.value;
  return v && typeof v === 'object' ? (v as Partial<Record<ToolName, string>>) : {};
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

const INITIATE_PATH = '/api/voice/elevenlabs/initiate';
const POST_CALL_PATH = '/api/voice/elevenlabs/webhook';

type CurrentAgent = {
  conversation_config?: { agent?: { prompt?: { prompt?: string; tool_ids?: string[] } }; tts?: { voice_id?: string; model_id?: string }; conversation?: { max_duration_seconds?: number } };
  platform_settings?: { overrides?: { enable_conversation_initiation_client_data_from_webhook?: boolean }; workspace_overrides?: { conversation_initiation_client_data_webhook?: { url?: string } | null; webhooks?: Record<string, unknown> } };
};

/** The agent's webhooks: what to set, what it has now, and the Dry run's lines about them. */
async function webhookPlan(apiKey: string, cur: CurrentAgent): Promise<{ initiationWebhook: { url: string; secret: string } | null; postCallWebhookId: string | null; current: AgentPlatformNow; changes: string[] }> {
  const changes: string[] = [];
  const ws = cur.platform_settings?.workspace_overrides;
  const current: AgentPlatformNow = {
    fetchInitiation: cur.platform_settings?.overrides?.enable_conversation_initiation_client_data_from_webhook === true,
    ...(ws && 'conversation_initiation_client_data_webhook' in ws ? { initiationWebhook: ws.conversation_initiation_client_data_webhook } : {}),
    ...(ws?.webhooks && typeof ws.webhooks === 'object' ? { webhooks: ws.webhooks } : {}),
  };

  const initiateUrl = siteUrl(INITIATE_PATH);
  const secret = initiateSecret();
  const initiationWebhook = secret ? { url: initiateUrl, secret } : null;
  const curInitiateUrl = ws?.conversation_initiation_client_data_webhook?.url ?? null;
  if (!initiationWebhook) changes.push('inbound caller lookup: not set (ELEVENLABS_INITIATE_SECRET missing)');
  else if (!current.fetchInitiation || curInitiateUrl !== initiateUrl) changes.push(`inbound caller lookup: ${current.fetchInitiation && curInitiateUrl ? curInitiateUrl : 'off'} → on (${initiateUrl})`);

  const postCallUrl = siteUrl(POST_CALL_PATH);
  const curPostCall = typeof current.webhooks?.post_call_webhook_id === 'string' ? current.webhooks.post_call_webhook_id : null;
  let postCallWebhookId: string | null = null;
  const list = await elevenLabsJson(apiKey, 'GET', '/v1/workspace/webhooks');
  if (!list.ok) {
    changes.push(`post-call webhook: couldn't list ElevenLabs webhooks (HTTP ${list.status}), so the agent keeps ${curPostCall ?? 'none'}. Choose the webhook for ${postCallUrl} on the agent by hand if it's missing.`);
  } else {
    const found = pickPostCallWebhook(list.json, postCallUrl);
    if (!found) changes.push(`post-call webhook: not found. Create it in ElevenLabs → Settings → Webhooks for ${postCallUrl} (HMAC), and put its secret in ELEVENLABS_WEBHOOK_SECRET.`);
    else {
      postCallWebhookId = found.id;
      if (found.id !== curPostCall) changes.push(`post-call webhook: ${curPostCall ?? 'none'} → ${found.id}`);
      if (found.autoDisabled) changes.push('warning: ElevenLabs switched the post-call webhook off after failures. Switch it back on in Settings → Webhooks.');
    }
  }
  if (!webhookSecret()) changes.push('warning: ELEVENLABS_WEBHOOK_SECRET is not set, so call results will be refused.');
  if (!toolSecret()) changes.push('warning: ELEVENLABS_TOOL_SECRET is not set, so the agent\'s tools will be refused.');
  return { initiationWebhook, postCallWebhookId, current, changes };
}

export async function syncAgent(o: { apply: boolean; knowledge: string; toolsToo: boolean }): Promise<SyncResult> {
  const config = voiceConfig();
  if (!config) return { ok: false, dry: !o.apply, message: 'Set ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID and ELEVENLABS_PHONE_NUMBER_ID first.', changes: [] };
  const settings = await getBillingSettings();
  const knowledge = o.knowledge;
  const base = siteUrl();
  const ids = await storedToolIds();
  const wanted = agentConfig({ knowledge, voiceId: voiceId(), toolIds: TOOL_NAMES.map((n) => ids[n] ?? `(new ${n})`), maxCallSeconds: settings.voice.maxCallSeconds, retentionDays: settings.voice.transcriptRetentionDays });
  const wantedPrompt = String(((wanted.conversation_config as Record<string, Record<string, Record<string, unknown>>>).agent.prompt as Record<string, unknown>).prompt);

  // Every {{variable}} the prompt uses must be one every call sends (or one ElevenLabs fills itself).
  const sent = new Set<string>(VARIABLE_NAMES);
  const unknownVars = promptVariables(wantedPrompt).filter((v) => !sent.has(v) && !v.startsWith('system__') && !v.startsWith('secret__'));
  if (unknownVars.length) return { ok: false, dry: !o.apply, message: `Refused: the prompt uses variables no call sends (${unknownVars.join(', ')}).`, changes: [] };

  // What the agent has now.
  const current = await elevenLabsJson(config.apiKey, 'GET', `/v1/convai/agents/${encodeURIComponent(config.agentId)}`);
  if (!current.ok) return { ok: false, dry: !o.apply, message: `Couldn't read the agent (HTTP ${current.status}).`, changes: [] };
  const cur = (current.json ?? {}) as CurrentAgent;
  const hooks = await webhookPlan(config.apiKey, cur);
  const changes: string[] = [];
  const curPrompt = cur.conversation_config?.agent?.prompt?.prompt ?? '';
  if (curPrompt !== wantedPrompt) changes.push(`prompt ${hash(curPrompt)} → ${hash(wantedPrompt)} (${wantedPrompt.length} characters)`);
  if (cur.conversation_config?.tts?.voice_id !== voiceId()) changes.push(`voice ${cur.conversation_config?.tts?.voice_id ?? 'none'} → ${voiceId()}`);
  if (cur.conversation_config?.tts?.model_id !== VOICE.agentModelId) changes.push(`speech model ${cur.conversation_config?.tts?.model_id ?? 'none'} → ${VOICE.agentModelId}`);
  if (cur.conversation_config?.conversation?.max_duration_seconds !== settings.voice.maxCallSeconds) changes.push(`max call ${cur.conversation_config?.conversation?.max_duration_seconds ?? '?'}s → ${settings.voice.maxCallSeconds}s`);
  if (o.toolsToo) for (const n of TOOL_NAMES) changes.push(ids[n] ? `tool ${n}: update ${ids[n]}` : `tool ${n}: create`);
  else for (const n of TOOL_NAMES) if (!ids[n]) changes.push(`tool ${n}: not created yet (press Sync on /admin/calls)`);
  changes.push(...hooks.changes);
  if (!o.apply) return { ok: true, dry: true, message: 'Dry run: nothing sent.', changes, promptChars: wantedPrompt.length };

  // Tools first, so the agent can list their ids (only from the /admin/calls button: two syncs at once must never create a tool twice).
  const next: Partial<Record<ToolName, string>> = { ...ids };
  if (o.toolsToo) {
    for (const n of TOOL_NAMES) {
      const body = { tool_config: toolConfig(n, base) };
      const r = ids[n] ? await elevenLabsJson(config.apiKey, 'PATCH', `/v1/convai/tools/${encodeURIComponent(ids[n]!)}`, body) : await elevenLabsJson(config.apiKey, 'POST', '/v1/convai/tools', body);
      if (!r.ok) return { ok: false, dry: false, message: `Tool ${n} failed (HTTP ${r.status}): ${JSON.stringify(r.json).slice(0, 300)}`, changes };
      const id = (r.json as { id?: string } | null)?.id ?? ids[n];
      if (id && id !== next[n]) {
        next[n] = id;
        // Saved at once: a sync that fails on a later tool must not create this one again on retry.
        await updateBillingSetting(TOOL_IDS_KEY, next);
      }
    }
  }
  const final = agentConfig({ knowledge, voiceId: voiceId(), toolIds: TOOL_NAMES.map((n) => next[n]).filter((x): x is string => Boolean(x)), maxCallSeconds: settings.voice.maxCallSeconds, retentionDays: settings.voice.transcriptRetentionDays, initiationWebhook: hooks.initiationWebhook, postCallWebhookId: hooks.postCallWebhookId, current: hooks.current });
  const r = await elevenLabsJson(config.apiKey, 'PATCH', `/v1/convai/agents/${encodeURIComponent(config.agentId)}`, final);
  if (!r.ok) return { ok: false, dry: false, message: `Agent update failed (HTTP ${r.status}): ${JSON.stringify(r.json).slice(0, 300)}`, changes };
  return { ok: true, dry: false, message: 'Agent synced.', changes, promptChars: wantedPrompt.length };
}
