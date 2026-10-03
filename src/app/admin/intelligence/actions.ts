'use server';

import { redirect, notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { updateBillingSetting } from '@/lib/credit/unit-costs';
import { contentFromForm, slugFrom } from '@/lib/knowledge/forms';
import { KNOWLEDGE_SETTING_KEYS, validateKnowledgeForm } from '@/lib/knowledge/settings';
import { SLUG_PATTERN } from '@/lib/knowledge/config';
import { runKnowledgeSeed } from '@/lib/knowledge/seed-server';
import { approveEntry, createEntry, rejectDraft, retireEntry, saveDraft } from '@/lib/knowledge/store-server';
import type { EntryContent } from '@/lib/knowledge/render';
import { flashAndGo } from './flash';

/**
 * Batch 24: the knowledge base's admin actions. Admin only (the same check as
 * every admin page; a member gets a 404). Every write is conditional on the
 * version the page showed, so a stale form can never overwrite a newer
 * change, and nothing a member can reach calls any of these.
 */

const KNOWLEDGE = '/admin/intelligence/knowledge';

async function requireAdmin(): Promise<{ email: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/admin/intelligence/knowledge');
  if (!isAdminEmail(user.email)) notFound();
  return { email: user.email ?? 'admin' };
}

const str = (f: FormData, k: string): string => {
  const v = f.get(k);
  return typeof v === 'string' ? v : '';
};
const int = (f: FormData, k: string): number => {
  const n = Number(str(f, k));
  return Number.isInteger(n) ? n : -1;
};
const entryPage = (id: string) => `${KNOWLEDGE}/${encodeURIComponent(id)}`;
/** What a draft needs to be saved at all; everything else (figures, placeholders, length) is shown on the entry page and blocks approval. */
function basicErrors(c: EntryContent): string[] {
  const out: string[] = [];
  if (!c.question) out.push('The question is empty.');
  if (!c.answer) out.push('The answer is empty.');
  if (!c.category) out.push('Choose a category.');
  if (c.channels.length === 0) out.push('Choose at least one channel.');
  return out;
}
const content = (f: FormData) =>
  contentFromForm(
    (k) => (typeof f.get(k) === 'string' ? (f.get(k) as string) : null),
    (k) => f.getAll(k).filter((v): v is string => typeof v === 'string'),
  );

export async function seedAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin();
  const dry = str(formData, 'mode') !== 'run';
  const r = await runKnowledgeSeed({ dry, actor: email });
  revalidatePath(KNOWLEDGE);
  const detail = [
    ...(r.inserted.length ? [`${dry ? 'Would add' : 'Added'}: ${r.inserted.join(', ')}`] : []),
    ...(r.proposed.length ? [`${dry ? 'Would propose' : 'Proposed'}: ${r.proposed.join(', ')}`] : []),
    ...r.skipped.map((s) => `Left alone: ${s.slug} (${s.reason})`),
    ...r.failed.map((s) => `Failed: ${s.slug} (${s.error})`),
  ];
  return flashAndGo(KNOWLEDGE, { kind: r.ok ? 'ok' : 'error', message: r.message, detail });
}

export async function createEntryAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin();
  const c = content(formData);
  const slug = (str(formData, 'slug').trim() || slugFrom(c.question) || '').toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return flashAndGo(`${KNOWLEDGE}/new`, { kind: 'error', message: 'The slug must start with a letter and use only a–z, 0–9 and _ (2 to 48 characters).' });
  const structural = basicErrors(c);
  if (structural.length) return flashAndGo(`${KNOWLEDGE}/new`, { kind: 'error', message: 'Not saved.', detail: structural });
  const r = await createEntry({ slug, content: c, source: 'manual', actor: email });
  if (!r.ok) return flashAndGo(`${KNOWLEDGE}/new`, { kind: 'error', message: r.error });
  revalidatePath(KNOWLEDGE);
  return flashAndGo(entryPage(r.id), { kind: 'ok', message: 'Saved as a draft. Nothing is live until you approve it.' });
}

export async function saveDraftAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin();
  const id = str(formData, 'id');
  const c = content(formData);
  const structural = basicErrors(c);
  if (structural.length) return flashAndGo(entryPage(id), { kind: 'error', message: 'Not saved.', detail: structural });
  const r = await saveDraft({ id, version: int(formData, 'version'), content: c, source: 'manual', actor: email });
  revalidatePath(KNOWLEDGE);
  return flashAndGo(entryPage(id), r.ok ? { kind: 'ok', message: 'Draft saved. The live answer is unchanged until you approve it.' } : { kind: 'error', message: r.error });
}

export async function approveAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin();
  const id = str(formData, 'id');
  const hash = str(formData, 'hash') || null;
  const r = await approveEntry({ id, version: int(formData, 'version'), hash, actor: email });
  revalidatePath(KNOWLEDGE);
  return flashAndGo(entryPage(id), r.ok ? { kind: 'ok', message: 'Approved: live on its channels now.' } : { kind: 'error', message: r.error });
}

export async function rejectAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin();
  const id = str(formData, 'id');
  const r = await rejectDraft({ id, version: int(formData, 'version'), actor: email, note: str(formData, 'note').slice(0, 300) || null });
  revalidatePath(KNOWLEDGE);
  return flashAndGo(entryPage(id), r.ok ? { kind: 'ok', message: 'Rejected. The same answer will not be suggested again.' } : { kind: 'error', message: r.error });
}

export async function retireAction(formData: FormData): Promise<void> {
  const { email } = await requireAdmin();
  const id = str(formData, 'id');
  const r = await retireEntry({ id, version: int(formData, 'version'), actor: email, note: str(formData, 'note').slice(0, 300) || null });
  revalidatePath(KNOWLEDGE);
  return flashAndGo(entryPage(id), r.ok ? { kind: 'ok', message: 'Retired: off every channel now.' } : { kind: 'error', message: r.error });
}

export async function saveKnowledgeSettingsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const r = validateKnowledgeForm((k) => (typeof formData.get(k) === 'string' ? (formData.get(k) as string) : null));
  if (!r.ok) return flashAndGo(KNOWLEDGE, { kind: 'error', message: r.error });
  try {
    for (const [field, value] of Object.entries(r.settings)) await updateBillingSetting(KNOWLEDGE_SETTING_KEYS[field as keyof typeof KNOWLEDGE_SETTING_KEYS], value);
  } catch (err) {
    return flashAndGo(KNOWLEDGE, { kind: 'error', message: `Not saved: ${(err as Error)?.message ?? 'the settings could not be written'}` });
  }
  revalidatePath(KNOWLEDGE);
  return flashAndGo(KNOWLEDGE, { kind: 'ok', message: 'Settings saved.' });
}
