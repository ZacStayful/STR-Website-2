'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { updateBillingSetting, invalidateCreditCaches } from '@/lib/credit/unit-costs';
import { VOICE_KEYS, parseVoice, type VoiceSettings } from '@/lib/voice/settings';
import { syncAgentKnowledge } from '@/lib/knowledge/agent-server';

/**
 * /admin/calls' actions (Batch 23): the calls settings, and the agent sync.
 * Each checks the admin itself and answers with a message.
 */
async function requireAdmin(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !isAdminEmail(data.user.email)) throw new Error('Not allowed');
}

export type ActionState = { ok: boolean; message: string; changes?: string[] } | null;

const PRICE_KEYS = { siTextPence: 'si_text_pence', siEmailPence: 'si_email_pence' } as const;

export async function saveCallSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const raw = (k: keyof VoiceSettings) => {
      const v = formData.get(k);
      return typeof v === 'string' ? (k === 'outboundWeekdays' ? JSON.stringify(v.split(/[ ,]+/).filter(Boolean).map(Number)) : v) : undefined;
    };
    // Parse through the one parser: anything out of range keeps its default.
    const parsed = parseVoice((key) => {
      const field = (Object.keys(VOICE_KEYS) as (keyof VoiceSettings)[]).find((f) => VOICE_KEYS[f] === key);
      return field ? raw(field) : undefined;
    });
    for (const f of Object.keys(VOICE_KEYS) as (keyof VoiceSettings)[]) await updateBillingSetting(VOICE_KEYS[f], parsed[f]);
    for (const [field, key] of Object.entries(PRICE_KEYS)) {
      const n = Number(formData.get(field));
      if (Number.isFinite(n) && n >= 0 && n <= 500) await updateBillingSetting(key, Math.round(n));
    }
    invalidateCreditCaches();
    revalidatePath('/admin/calls');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function syncAgentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const apply = formData.get('intent') === 'apply';
    // Batch 24: the knowledge is the knowledge base's approved call answers; the button also creates or updates the tools.
    const r = await syncAgentKnowledge({ dry: !apply, toolsToo: true, reason: 'admin: /admin/calls' });
    return { ok: r.ok, message: r.promptChars ? `${r.message} Prompt ${r.promptChars.toLocaleString('en-GB')} characters.` : r.message, changes: r.changes };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
