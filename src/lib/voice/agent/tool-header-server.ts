import 'server-only';

/**
 * Review R3 (R3-50 / R2-25): how the agent's tools get their token
 * (ELEVENLABS_TOOL_SECRET, checked by /api/voice/tools). Until the first
 * Sync after this change it travels as the secret__tool_token call variable,
 * which every initiation answer and outbound call had to carry; the Sync now
 * keeps it in ElevenLabs as a workspace secret and records that here, after
 * which no call carries it at all.
 */
import { createAdminClient } from '../../supabase/admin';

export const TOOL_HEADER_KEY = 'si_tool_header';

/** Whether the tools take their token from the workspace secret (the Sync set it). Unreadable: not yet, so the variable is still sent and the tools keep working. */
export async function toolHeaderViaSecret(admin: ReturnType<typeof createAdminClient> = createAdminClient()): Promise<boolean> {
  const { data, error } = await admin.from('billing_settings').select('value').eq('key', TOOL_HEADER_KEY).maybeSingle();
  if (error) return false;
  const v = (data as { value?: unknown } | null)?.value as { mode?: unknown } | null | undefined;
  return v?.mode === 'secret';
}
