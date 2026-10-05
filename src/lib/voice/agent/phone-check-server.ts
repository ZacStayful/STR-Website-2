import 'server-only';

/**
 * The phone check, run and saved. Read only: Twilio and ElevenLabs GETs,
 * never a call, never a change to the agent. Runs on every Dry run and Sync
 * on /admin/calls, and from the 5-minute calls cron when
 * billing_settings.si_phone_check_request is newer than the last check
 * (so it can be asked for without anyone at /admin/calls). The result is
 * kept in billing_settings.si_phone_check ({ at, lines }); callers appear
 * only as the last 3 digits of their number.
 */
import { createAdminClient } from '../../supabase/admin';
import { updateBillingSetting } from '../../credit/unit-costs';
import { voiceConfig } from '../config';
import { elevenLabsJson } from '../elevenlabs-server';
import { numberVoiceUrl, recentCallsTo, recentTwilioAlerts } from '../twilio-voice';
import { isElevenLabsVoiceUrl, phoneAssignment } from './agent-config';
import { conversationLines, listOrNone, normaliseE164, phoneCheckDue, twilioAlertLines, twilioCallLines } from './phone-check';

export const PHONE_CHECK_KEY = 'si_phone_check';
export const PHONE_CHECK_REQUEST_KEY = 'si_phone_check_request';

type AgentNow = { platform_settings?: { overrides?: { enable_conversation_initiation_client_data_from_webhook?: boolean }; workspace_overrides?: { conversation_initiation_client_data_webhook?: { url?: string } | null } } };

/** Run the phone check now, save it, and return its lines. */
export async function runPhoneCheck(): Promise<string[]> {
  const config = voiceConfig();
  if (!config) return ['phone check: ElevenLabs is not configured here'];
  const lines: string[] = [];
  const [num, agent, conversations, workspace, alerts] = await Promise.all([
    elevenLabsJson(config.apiKey, 'GET', `/v1/convai/phone-numbers/${encodeURIComponent(config.phoneNumberId)}`),
    elevenLabsJson(config.apiKey, 'GET', `/v1/convai/agents/${encodeURIComponent(config.agentId)}`),
    elevenLabsJson(config.apiKey, 'GET', `/v1/convai/conversations?agent_id=${encodeURIComponent(config.agentId)}&page_size=3`),
    elevenLabsJson(config.apiKey, 'GET', '/v1/convai/settings'),
    recentTwilioAlerts(),
  ]);
  const p = num.ok ? phoneAssignment(num.json, config.agentId) : null;
  const label = p?.phone ?? config.phoneNumberId;
  const phone = normaliseE164(p?.phone);
  if (!num.ok) lines.push(`phone check: couldn't read the number from ElevenLabs (HTTP ${num.status})`);
  else lines.push(`phone check: ${label} is answered by ${p!.ours ? 'this agent' : p!.assignedName ? `"${p!.assignedName}"` : 'no agent'}`);

  const [voice, twilioCalls] = await Promise.all([
    phone ? numberVoiceUrl(phone) : Promise.resolve({ ok: false as const, reason: `ElevenLabs gives the number as "${label}"` }),
    phone ? recentCallsTo(phone) : Promise.resolve({ ok: false as const, reason: 'no number' }),
  ]);
  if (!voice.ok) lines.push(`phone check: couldn't read the number from Twilio (${voice.reason})`);
  else if (isElevenLabsVoiceUrl(voice.voiceUrl)) lines.push(`phone check: Twilio sends its calls to ElevenLabs (${voice.voiceUrl})`);
  else lines.push(`warning: Twilio sends calls to ${label} to ${voice.voiceUrl ?? 'nowhere'}, not ElevenLabs, so they never reach the agent.`);
  lines.push(`phone check: Twilio's last calls to it: ${twilioCalls.ok ? listOrNone(twilioCallLines(twilioCalls.json)) : `couldn't read (${twilioCalls.reason})`}`);
  lines.push(`phone check: Twilio's last alerts: ${alerts.ok ? listOrNone(twilioAlertLines(alerts.json)) : `couldn't read (${alerts.reason})`}`);
  lines.push(`phone check: ElevenLabs' last conversations for this agent: ${conversations.ok ? listOrNone(conversationLines(conversations.json)) : `couldn't read (HTTP ${conversations.status})`}`);

  const a = (agent.ok ? agent.json : null) as AgentNow | null;
  const agentLookup = !agent.ok ? `couldn't read (HTTP ${agent.status})` : a?.platform_settings?.overrides?.enable_conversation_initiation_client_data_from_webhook === true ? `on → ${a.platform_settings?.workspace_overrides?.conversation_initiation_client_data_webhook?.url ?? 'the workspace one'}` : 'off';
  const wsUrl = workspace.ok ? (workspace.json as { conversation_initiation_client_data_webhook?: { url?: unknown } | null } | null)?.conversation_initiation_client_data_webhook?.url : undefined;
  lines.push(`phone check: "who is ringing" webhook: this agent ${agentLookup}; workspace ${workspace.ok ? (typeof wsUrl === 'string' && wsUrl ? wsUrl : 'none') : `couldn't read (HTTP ${workspace.status})`}`);

  await updateBillingSetting(PHONE_CHECK_KEY, { at: new Date().toISOString(), lines }).catch((err) => console.error('[voice] phone check not saved:', err));
  return lines;
}

/** From the calls cron: run the check when one was asked for after the last. Never throws. */
export async function runRequestedPhoneCheck(): Promise<boolean> {
  try {
    const { data } = await createAdminClient().from('billing_settings').select('key, value').in('key', [PHONE_CHECK_KEY, PHONE_CHECK_REQUEST_KEY]);
    const kv = new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
    const last = kv.get(PHONE_CHECK_KEY) as { at?: unknown } | undefined;
    if (!phoneCheckDue(kv.get(PHONE_CHECK_REQUEST_KEY), last?.at)) return false;
    await runPhoneCheck();
    return true;
  } catch (err) {
    console.error('[voice] requested phone check failed:', err);
    return false;
  }
}
