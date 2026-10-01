import 'server-only';

/**
 * Batch 23: push the agent in git (src/lib/voice/agent + src/lib/persona) to
 * ElevenLabs, from /admin/calls. A dry run shows what would change; apply
 * creates or updates the four tools, then PATCHes the agent. The tool ids are
 * kept in billing_settings.si_agent_tool_ids so a second sync updates rather
 * than duplicates them.
 */
import { createHash } from 'node:crypto';
import { createAdminClient } from '../../supabase/admin';
import { getBillingSettings, updateBillingSetting } from '../../credit/unit-costs';
import { siteUrl } from '../../url';
import { faqsWith, TRUST_FAQS } from '../../faqs-data';
import { costFiguresNow } from '../../faqs-server';
import { publicOfferNow } from '../../starter-pack/public';
import { voiceId } from '../../persona/stayful-intelligence';
import { TOOL_NAMES, voiceConfig, type ToolName } from '../config';
import { callPencePerMinute } from '../charge-server';
import { elevenLabsJson } from '../elevenlabs-server';
import { renderKnowledge } from './knowledge';
import { serviceGuide } from './service-guide';
import { toolConfig } from './tools';
import { agentConfig } from './agent-config';

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

export async function syncAgent(o: { apply: boolean }): Promise<SyncResult> {
  const config = voiceConfig();
  if (!config) return { ok: false, dry: !o.apply, message: 'Set ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID and ELEVENLABS_PHONE_NUMBER_ID first.', changes: [] };
  const settings = await getBillingSettings();
  const [offer, figures, perMin] = await Promise.all([publicOfferNow(), costFiguresNow(), callPencePerMinute()]);
  const knowledge = renderKnowledge(
    faqsWith(offer, figures),
    TRUST_FAQS,
    serviceGuide({
      callPencePerMin: perMin,
      textPence: settings.intelligence.siTextPence,
      emailPence: settings.intelligence.siEmailPence,
      topupAmountPence: settings.intelligence.revealAutoTopupAmountPence,
      topupThresholdPence: settings.intelligence.revealAutoTopupThresholdPence,
    }),
  );
  const base = siteUrl();
  const ids = await storedToolIds();
  const wanted = agentConfig({ knowledge, voiceId: voiceId(), toolIds: TOOL_NAMES.map((n) => ids[n] ?? `(new ${n})`), maxCallSeconds: settings.voice.maxCallSeconds, retentionDays: settings.voice.transcriptRetentionDays });
  const wantedPrompt = String(((wanted.conversation_config as Record<string, Record<string, Record<string, unknown>>>).agent.prompt as Record<string, unknown>).prompt);

  // What the agent has now.
  const current = await elevenLabsJson(config.apiKey, 'GET', `/v1/convai/agents/${encodeURIComponent(config.agentId)}`);
  if (!current.ok) return { ok: false, dry: !o.apply, message: `Couldn't read the agent (HTTP ${current.status}).`, changes: [] };
  const cur = (current.json ?? {}) as { conversation_config?: { agent?: { prompt?: { prompt?: string; tool_ids?: string[] } }; tts?: { voice_id?: string }; conversation?: { max_duration_seconds?: number } } };
  const changes: string[] = [];
  const curPrompt = cur.conversation_config?.agent?.prompt?.prompt ?? '';
  if (curPrompt !== wantedPrompt) changes.push(`prompt ${hash(curPrompt)} → ${hash(wantedPrompt)} (${wantedPrompt.length} characters)`);
  if (cur.conversation_config?.tts?.voice_id !== voiceId()) changes.push(`voice ${cur.conversation_config?.tts?.voice_id ?? 'none'} → ${voiceId()}`);
  if (cur.conversation_config?.conversation?.max_duration_seconds !== settings.voice.maxCallSeconds) changes.push(`max call ${cur.conversation_config?.conversation?.max_duration_seconds ?? '?'}s → ${settings.voice.maxCallSeconds}s`);
  for (const n of TOOL_NAMES) changes.push(ids[n] ? `tool ${n}: update ${ids[n]}` : `tool ${n}: create`);
  if (!o.apply) return { ok: true, dry: true, message: 'Dry run: nothing sent.', changes, promptChars: wantedPrompt.length };

  // Tools first, so the agent can list their ids.
  const next: Partial<Record<ToolName, string>> = { ...ids };
  for (const n of TOOL_NAMES) {
    const body = { tool_config: toolConfig(n, base) };
    const r = ids[n] ? await elevenLabsJson(config.apiKey, 'PATCH', `/v1/convai/tools/${encodeURIComponent(ids[n]!)}`, body) : await elevenLabsJson(config.apiKey, 'POST', '/v1/convai/tools', body);
    if (!r.ok) return { ok: false, dry: false, message: `Tool ${n} failed (HTTP ${r.status}): ${JSON.stringify(r.json).slice(0, 300)}`, changes };
    const id = (r.json as { id?: string } | null)?.id ?? ids[n];
    if (id) next[n] = id;
  }
  await updateBillingSetting(TOOL_IDS_KEY, next);
  const final = agentConfig({ knowledge, voiceId: voiceId(), toolIds: TOOL_NAMES.map((n) => next[n]).filter((x): x is string => Boolean(x)), maxCallSeconds: settings.voice.maxCallSeconds, retentionDays: settings.voice.transcriptRetentionDays });
  const r = await elevenLabsJson(config.apiKey, 'PATCH', `/v1/convai/agents/${encodeURIComponent(config.agentId)}`, final);
  if (!r.ok) return { ok: false, dry: false, message: `Agent update failed (HTTP ${r.status}): ${JSON.stringify(r.json).slice(0, 300)}`, changes };
  return { ok: true, dry: false, message: 'Agent synced.', changes, promptChars: wantedPrompt.length };
}
