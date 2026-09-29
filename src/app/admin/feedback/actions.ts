'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { changeStatus, markDuplicate, retryStatusEmails, saveNote, undoDuplicate, type RecipientPreview, type SendSummary } from '@/lib/feedback/admin-server';
import { saveFeedbackSettings } from '@/lib/feedback/settings-server';
import { cleanEmail, parseSettings } from '@/lib/feedback/rules';
import { SETTING_KEYS } from '@/lib/feedback/config';

/**
 * /admin/feedback's actions (Batch 18). Each checks the admin itself, as the
 * other admin actions do, and answers with a message rather than throwing,
 * because a client form shows it.
 */
async function requireAdmin(): Promise<{ email: string }> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !isAdminEmail(data.user.email)) throw new Error('Not allowed');
  return { email: data.user.email! };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StatusPreview = { recipients: RecipientPreview[]; subject: string | null; text: string | null; emails: boolean };

export type ActionState = { ok: boolean; message: string; preview?: StatusPreview; summary?: SendSummary | null } | null;

function said(summary: SendSummary | null | undefined, lead: string): string {
  if (!summary) return lead;
  const parts: string[] = [];
  if (summary.sent) parts.push(`emailed ${summary.sent} member${summary.sent === 1 ? '' : 's'}`);
  if (summary.already) parts.push(`${summary.already} already told`);
  if (summary.skipped) parts.push(`${summary.skipped} with no email address`);
  if (summary.failed) parts.push(`${summary.failed} failed (press Retry)`);
  if (summary.remaining) parts.push(`${summary.remaining} still to go (press Save again)`);
  return parts.length ? `${lead} ${parts.join('; ')}.` : `${lead} Nobody to email.`;
}

function refresh(id: string) {
  revalidatePath(`/admin/feedback/${id}`);
  revalidatePath('/admin/feedback');
}

export async function statusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const id = String(formData.get('id') ?? '');
    if (!UUID.test(id)) return { ok: false, message: 'That report could not be found.' };
    const intent = String(formData.get('intent') ?? 'save');
    if (intent === 'retry') {
      const res = await retryStatusEmails(id);
      if (!res.ok) return { ok: false, message: res.message };
      refresh(id);
      return { ok: true, message: said(res.dry ? null : res.summary, 'Retried:'), summary: res.dry ? null : res.summary };
    }
    const res = await changeStatus({ reportId: id, status: formData.get('status'), message: formData.get('message'), dry: intent === 'preview' });
    if (!res.ok) return { ok: false, message: res.message };
    if (res.dry) {
      return {
        ok: true,
        message: res.emails ? 'Nothing has been saved or sent yet.' : 'This status emails nobody. Nothing has been saved yet.',
        preview: { recipients: res.recipients, subject: res.email?.subject ?? null, text: res.email?.text ?? null, emails: res.emails },
      };
    }
    refresh(id);
    return { ok: true, message: said(res.summary, 'Saved.'), summary: res.summary };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function noteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const id = String(formData.get('id') ?? '');
    if (!UUID.test(id)) return { ok: false, message: 'That report could not be found.' };
    const res = await saveNote(id, formData.get('note'));
    if (res.ok) refresh(id);
    return res;
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function duplicateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const id = String(formData.get('id') ?? '');
    if (!UUID.test(id)) return { ok: false, message: 'That report could not be found.' };
    const res = String(formData.get('intent') ?? 'mark') === 'undo' ? await undoDuplicate(id) : await markDuplicate({ reportId: id, ofRef: formData.get('of'), tell: formData.get('tell') === 'on' });
    if (!res.ok) return { ok: false, message: res.message };
    refresh(id);
    return { ok: true, message: said(res.summary, res.message), summary: res.summary };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function settingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const email = cleanEmail(formData.get('adminEmail'));
    if (!email) return { ok: false, message: 'The admin email has to be one email address.' };
    const next = parseSettings(
      new Map<string, unknown>([
        [SETTING_KEYS.dailyLimit, formData.get('dailyLimit')],
        [SETTING_KEYS.maxScreenshots, formData.get('maxScreenshots')],
        [SETTING_KEYS.screenshotMaxMb, formData.get('screenshotMaxMb')],
        [SETTING_KEYS.retentionDays, formData.get('retentionDays')],
        [SETTING_KEYS.adminEmail, email],
      ]),
      email,
    );
    await saveFeedbackSettings({ dailyLimit: next.dailyLimit, maxScreenshots: next.maxScreenshots, screenshotMaxMb: next.screenshotMaxMb, retentionDays: next.retentionDays, adminEmail: next.adminEmail });
    revalidatePath('/admin/feedback');
    return { ok: true, message: `Saved: ${next.dailyLimit} a day, ${next.maxScreenshots} screenshots of up to ${next.screenshotMaxMb} MB, kept ${next.retentionDays} days, emailed to ${next.adminEmail}.` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
