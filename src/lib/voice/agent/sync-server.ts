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
 * webhook. The Sync button creates the post-call webhook itself through the
 * API (the only way to be given its HMAC secret) and keeps the secret
 * encrypted (src/lib/voice/post-call-webhook-server.ts); one made by hand
 * is used only with ELEVENLABS_WEBHOOK_SECRET. The workspace settings,
 * which other agents use, are never changed: the Dry run only warns when
 * they point at this site.
 */
import { createHash } from 'node:crypto';
import { createAdminClient } from '../../supabase/admin';
import { getBillingSettings, updateBillingSetting } from '../../credit/unit-costs';
import { siteUrl } from '../../url';
import { VOICE, voiceId } from '../../persona/stayful-intelligence';
import { promptVariables } from '../../knowledge/agent';
import { TOOL_NAMES, initiateSecret, toolSecret, voiceConfig, webhookSecret, type ToolName } from '../config';
import { secretsConfigured } from '../../crypto/secrets';
import { savePostCallWebhook, storedPostCallWebhook } from '../post-call-webhook-server';
import { elevenLabsJson } from '../elevenlabs-server';
import { toolConfig } from './tools';
import { agentConfig, isElevenLabsVoiceUrl, parseCreatedWebhook, phoneAssignment, pickPostCallWebhook, POST_CALL_WEBHOOK_NAME, webhookById, workspaceWarnings, type AgentPlatformNow } from './agent-config';
import { numberVoiceUrl, recentCallsTo } from '../twilio-voice';
import { conversationLines, listOrNone, normaliseE164, twilioCallLines } from './phone-check';
import { unknownCallerDefaults } from './variables';
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
async function webhookPlan(apiKey: string, cur: CurrentAgent): Promise<{ initiationWebhook: { url: string; secret: string } | null; postCallWebhookId: string | null; createPostCall: boolean; current: AgentPlatformNow; changes: string[] }> {
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
  let createPostCall = false;
  const [stored, list, workspace] = await Promise.all([
    storedPostCallWebhook().catch(() => null),
    elevenLabsJson(apiKey, 'GET', '/v1/workspace/webhooks'),
    elevenLabsJson(apiKey, 'GET', '/v1/convai/settings'),
  ]);
  if (!list.ok) {
    changes.push(`post-call webhook: couldn't list ElevenLabs webhooks (HTTP ${list.status}), so the agent keeps ${curPostCall ?? 'none'}.`);
  } else {
    // The Sync's own webhook first (the app holds its secret); one made by hand only when ELEVENLABS_WEBHOOK_SECRET holds its secret.
    const found = (stored?.secret ? webhookById(list.json, stored.id) : null) ?? (webhookSecret() ? pickPostCallWebhook(list.json, postCallUrl) : null);
    if (found) {
      postCallWebhookId = found.id;
      if (found.id !== curPostCall) changes.push(`post-call webhook: ${curPostCall ?? 'none'} → ${found.id}`);
      if (found.autoDisabled) changes.push('warning: ElevenLabs switched the post-call webhook off after failures. Switch it back on in Settings → Webhooks.');
    } else if (!secretsConfigured()) {
      changes.push("post-call webhook: can't be created here: CRM_ENCRYPTION_KEY isn't set, so its secret couldn't be kept.");
    } else {
      createPostCall = true;
      changes.push(`post-call webhook: ${curPostCall ?? 'none'} → a new one for ${postCallUrl}, created by the Sync button (its secret is kept encrypted; nothing to copy)`);
    }
    if (workspace.ok) changes.push(...workspaceWarnings(workspace.json, list.json, siteUrl()));
  }
  if (!toolSecret()) changes.push('warning: ELEVENLABS_TOOL_SECRET is not set, so the agent\'s tools will be refused.');
  return { initiationWebhook, postCallWebhookId, createPostCall, current, changes };
}

/**
 * The number's incoming calls: which agent answers them now, and (Dry run
 * only) a phone check: where Twilio sends them, Twilio's and ElevenLabs'
 * last calls, and where the agent asks who is ringing. Read only.
 */
async function phonePlan(apiKey: string, agentId: string, phoneNumberId: string, o: { diagnose: boolean; agentLookup: string }): Promise<{ assign: boolean; changes: string[] }> {
  const changes: string[] = [];
  const r = await elevenLabsJson(apiKey, 'GET', `/v1/convai/phone-numbers/${encodeURIComponent(phoneNumberId)}`);
  if (!r.ok) return { assign: false, changes: [`phone number: couldn't read it from ElevenLabs (HTTP ${r.status}), so incoming calls are left as they are.`] };
  const p = phoneAssignment(r.json, agentId);
  const phone = normaliseE164(p.phone);
  const label = p.phone ?? phoneNumberId;
  if (!p.ours) changes.push(`phone number ${label}: incoming calls go to ${p.assignedName ? `"${p.assignedName}"` : p.assignedId ?? 'no agent (callers hear busy)'} → Stayful Intelligence`);
  if (!o.diagnose) return { assign: !p.ours, changes };

  const [voice, twilioCalls, conversations, workspace] = await Promise.all([
    phone ? numberVoiceUrl(phone) : Promise.resolve({ ok: false as const, reason: `ElevenLabs gives the number as "${label}"` }),
    phone ? recentCallsTo(phone) : Promise.resolve({ ok: false as const, reason: 'no number' }),
    elevenLabsJson(apiKey, 'GET', `/v1/convai/conversations?agent_id=${encodeURIComponent(agentId)}&page_size=3`),
    elevenLabsJson(apiKey, 'GET', '/v1/convai/settings'),
  ]);
  changes.push(`phone check: ${label} is answered by ${p.ours ? 'this agent' : p.assignedName ? `"${p.assignedName}"` : 'no agent'}`);
  if (!voice.ok) changes.push(`phone check: couldn't read the number from Twilio (${voice.reason})`);
  else if (isElevenLabsVoiceUrl(voice.voiceUrl)) changes.push(`phone check: Twilio sends its calls to ElevenLabs (${voice.voiceUrl})`);
  else changes.push(`warning: Twilio sends calls to ${label} to ${voice.voiceUrl ?? 'nowhere'}, not ElevenLabs, so they never reach the agent. Re-import the number in ElevenLabs → Phone numbers, which sets it.`);
  changes.push(`phone check: Twilio's last calls to it: ${twilioCalls.ok ? listOrNone(twilioCallLines(twilioCalls.json)) : `couldn't read (${twilioCalls.reason})`}`);
  changes.push(`phone check: ElevenLabs' last conversations for this agent: ${conversations.ok ? listOrNone(conversationLines(conversations.json)) : `couldn't read (HTTP ${conversations.status})`}`);
  const wsUrl = workspace.ok ? (workspace.json as { conversation_initiation_client_data_webhook?: { url?: unknown } | null } | null)?.conversation_initiation_client_data_webhook?.url : undefined;
  changes.push(`phone check: "who is ringing" webhook: this agent ${o.agentLookup}; workspace ${workspace.ok ? (typeof wsUrl === 'string' && wsUrl ? wsUrl : 'none') : `couldn't read (HTTP ${workspace.status})`}`);
  return { assign: !p.ours, changes };
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
  const curLookup = cur.platform_settings?.overrides?.enable_conversation_initiation_client_data_from_webhook === true ? `on → ${cur.platform_settings?.workspace_overrides?.conversation_initiation_client_data_webhook?.url ?? 'the workspace one'}` : 'off';
  const [hooks, phone] = await Promise.all([webhookPlan(config.apiKey, cur), phonePlan(config.apiKey, config.agentId, config.phoneNumberId, { diagnose: !o.apply, agentLookup: curLookup })]);
  // Every variable has a default, so a call whose variables never arrive still starts (as for an unknown caller).
  // Only the ones the agent uses (its prompt and opener), so ElevenLabs never refuses a default it has no use for.
  const used = new Set(promptVariables(JSON.stringify(wanted.conversation_config)));
  const variableDefaults = Object.fromEntries(Object.entries(unknownCallerDefaults({ maxCallSeconds: settings.voice.maxCallSeconds, topupAmountPence: settings.intelligence.revealAutoTopupAmountPence, topupThresholdPence: settings.intelligence.revealAutoTopupThresholdPence })).filter(([k]) => used.has(k)));
  const curDefaults = (cur.conversation_config?.agent as { dynamic_variables?: { dynamic_variable_placeholders?: Record<string, unknown> } } | undefined)?.dynamic_variables?.dynamic_variable_placeholders ?? {};
  const missingDefaults = Object.keys(variableDefaults).filter((k) => curDefaults[k] === undefined);
  const changes: string[] = [];
  const curPrompt = cur.conversation_config?.agent?.prompt?.prompt ?? '';
  if (curPrompt !== wantedPrompt) changes.push(`prompt ${hash(curPrompt)} → ${hash(wantedPrompt)} (${wantedPrompt.length} characters)`);
  if (cur.conversation_config?.tts?.voice_id !== voiceId()) changes.push(`voice ${cur.conversation_config?.tts?.voice_id ?? 'none'} → ${voiceId()}`);
  if (cur.conversation_config?.tts?.model_id !== VOICE.agentModelId) changes.push(`speech model ${cur.conversation_config?.tts?.model_id ?? 'none'} → ${VOICE.agentModelId}`);
  if (cur.conversation_config?.conversation?.max_duration_seconds !== settings.voice.maxCallSeconds) changes.push(`max call ${cur.conversation_config?.conversation?.max_duration_seconds ?? '?'}s → ${settings.voice.maxCallSeconds}s`);
  if (o.toolsToo) for (const n of TOOL_NAMES) changes.push(ids[n] ? `tool ${n}: update ${ids[n]}` : `tool ${n}: create`);
  else for (const n of TOOL_NAMES) if (!ids[n]) changes.push(`tool ${n}: not created yet (press Sync on /admin/calls)`);
  if (missingDefaults.length) changes.push(`variable defaults: ${missingDefaults.length} missing → set (a call whose details never arrive still starts, as for an unknown caller, instead of "busy")`);
  changes.push(...hooks.changes, ...phone.changes);
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
  // The post-call webhook, made here when there is none the app has the secret for (only from the /admin/calls button, like the tools).
  let postCallWebhookId = hooks.postCallWebhookId;
  if (hooks.createPostCall && o.toolsToo) {
    const made = await elevenLabsJson(config.apiKey, 'POST', '/v1/workspace/webhooks', { settings: { auth_type: 'hmac', name: POST_CALL_WEBHOOK_NAME, webhook_url: siteUrl(POST_CALL_PATH) } });
    const hook = made.ok ? parseCreatedWebhook(made.json) : null;
    if (!hook) return { ok: false, dry: false, message: `Creating the post-call webhook failed (HTTP ${made.status}): ${JSON.stringify(made.json).slice(0, 300)}`, changes };
    try {
      await savePostCallWebhook(hook.id, hook.secret);
    } catch (err) {
      return { ok: false, dry: false, message: `The post-call webhook ${hook.id} was created but its secret couldn't be saved (${String((err as Error)?.message ?? err)}). Delete it in ElevenLabs → Settings → Webhooks and sync again.`, changes };
    }
    postCallWebhookId = hook.id;
  }
  const final = agentConfig({ knowledge, voiceId: voiceId(), toolIds: TOOL_NAMES.map((n) => next[n]).filter((x): x is string => Boolean(x)), maxCallSeconds: settings.voice.maxCallSeconds, retentionDays: settings.voice.transcriptRetentionDays, initiationWebhook: hooks.initiationWebhook, postCallWebhookId, current: hooks.current, variableDefaults });
  const r = await elevenLabsJson(config.apiKey, 'PATCH', `/v1/convai/agents/${encodeURIComponent(config.agentId)}`, final);
  if (!r.ok) return { ok: false, dry: false, message: `Agent update failed (HTTP ${r.status}): ${JSON.stringify(r.json).slice(0, 300)}`, changes };
  // Incoming calls to the number go to this agent (only from the /admin/calls button; the Dry run showed which agent had them).
  if (phone.assign && o.toolsToo) {
    const a = await elevenLabsJson(config.apiKey, 'PATCH', `/v1/convai/phone-numbers/${encodeURIComponent(config.phoneNumberId)}`, { agent_id: config.agentId });
    if (!a.ok) return { ok: false, dry: false, message: `Agent synced, but giving it the number's incoming calls failed (HTTP ${a.status}): ${JSON.stringify(a.json).slice(0, 300)}`, changes };
  }
  return { ok: true, dry: false, message: 'Agent synced.', changes, promptChars: wantedPrompt.length };
}
