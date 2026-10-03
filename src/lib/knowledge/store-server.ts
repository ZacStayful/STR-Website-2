import 'server-only';

/**
 * Batch 24: reads and writes for the knowledge base.
 *
 * Members' code (the chips, the call agent's variables, Batch 26's chat)
 * reads only si_knowledge_live, which has no draft column, through
 * liveEntries / renderLive / answerBySlug. Nothing is cached: an entry Zac
 * retires or that goes stale is gone on the next read.
 *
 * Every admin write is conditional on the version the admin was shown (the
 * row's trigger bumps it on every update), and every write leaves a history
 * row. Approval is the si_knowledge_approve function, which also checks the
 * draft's hash, so the text approved is exactly the text Zac read.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { callsEnabled } from '../voice/config';
import { type KbChannel, type KbSource } from './config';
import { CONDITIONS, PLACEHOLDERS, type GlobalSnapshot, type MemberValues, type PlanRow, type UnitRow } from './placeholders';
import { checkContent, contentHash, draftContent, draftJson, renderEntry, staleReason, type EntryContent, type LiveEntry } from './render';
import { KNOWLEDGE_COLUMNS, LIVE_COLUMNS, isLive, liveContent, liveFromRow, type KnowledgeRow } from './rows';
import { parseKnowledgeSettings, KNOWLEDGE_SETTING_KEYS, type KnowledgeSettings } from './settings';

export type Admin = ReturnType<typeof createAdminClient>;

/** A missing table, view or function: the Batch 24 schema has not been run. */
export function isSchemaMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (['PGRST202', 'PGRST205', '42883', '42P01', 'PGRST204'].includes(error.code ?? '')) return true;
  return /si_knowledge|si_gap|si_member_facts/.test(error.message ?? '') && /does not exist|not find|schema cache/.test(error.message ?? '');
}

// ── Settings and the global snapshot ────────────────────────────────────────

export async function readKnowledgeSettings(admin: Admin = createAdminClient()): Promise<KnowledgeSettings> {
  const { data } = await admin.from('billing_settings').select('key, value').in('key', Object.values(KNOWLEDGE_SETTING_KEYS));
  return parseKnowledgeSettings(new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value])));
}

/**
 * Every raw row a global placeholder may read, in one go. Null when any read
 * fails: answers are then shown to nobody (fail closed) and nothing is ever
 * marked stale on a read failure.
 */
export async function readGlobalSnapshot(admin: Admin = createAdminClient()): Promise<GlobalSnapshot | null> {
  try {
    const [settings, plans, units] = await Promise.all([
      admin.from('billing_settings').select('key, value'),
      admin.from('billing_plans').select('code, price_pence, interval, active'),
      admin.from('unit_costs').select('provider, unit, unit_cost_pence, markup'),
    ]);
    if (settings.error || plans.error || units.error) {
      console.error('[knowledge] snapshot read failed:', settings.error?.message ?? plans.error?.message ?? units.error?.message);
      return null;
    }
    return {
      settings: new Map(((settings.data ?? []) as { key: string; value: unknown }[]).map((r) => [String(r.key), r.value])),
      plans: ((plans.data ?? []) as Record<string, unknown>[]).map((p): PlanRow => ({ code: String(p.code), pricePence: Number(p.price_pence), interval: String(p.interval), active: p.active !== false })),
      units: new Map(((units.data ?? []) as Record<string, unknown>[]).map((u): [string, UnitRow] => [`${u.provider}:${u.unit}`, { unitCostPence: Number(u.unit_cost_pence), markup: Number(u.markup) }])),
      callsLive: callsEnabled(),
    };
  } catch (err) {
    console.error('[knowledge] snapshot read failed:', err);
    return null;
  }
}

// ── Members' reads (live only) ──────────────────────────────────────────────

/** The approved, live entries, optionally only those allowed on a channel. Null when they can't be read. */
export async function liveEntries(channel?: KbChannel, admin: Admin = createAdminClient()): Promise<LiveEntry[] | null> {
  let q = admin.from('si_knowledge_live').select(LIVE_COLUMNS).order('slug');
  if (channel) q = q.contains('channels', [channel]);
  const { data, error } = await q;
  if (error) {
    if (!isSchemaMissing(error)) console.error('[knowledge] live read failed:', error.message);
    return null;
  }
  return ((data ?? []) as Record<string, unknown>[]).map(liveFromRow).filter((e): e is LiveEntry => e !== null);
}

export interface ShownAnswer {
  entryId: string;
  slug: string;
  version: number;
  question: string;
  answer: string;
}

/**
 * Every live entry on a channel, rendered for this member (null = anyone).
 * Entries that don't apply, lack a member value or no longer resolve are
 * left out; nothing is written (staleness is flagged by the nightly job and
 * the admin page, never from a member's request).
 */
export async function renderLive(channel: KbChannel, member: MemberValues | null, admin?: Admin): Promise<ShownAnswer[]> {
  // A member's page must never fail on this: no service role (a preview) or a read error shows no answers.
  if (!admin && !hasServiceRole()) return [];
  admin ??= createAdminClient();
  const [entries, g] = await Promise.all([liveEntries(channel, admin), readGlobalSnapshot(admin)]);
  if (!entries || !g) return [];
  const out: ShownAnswer[] = [];
  for (const e of entries) {
    const r = renderEntry(e, g, member);
    if (r.kind === 'ok') out.push({ entryId: e.id, slug: e.slug, version: e.version, question: r.question, answer: r.answer });
  }
  return out;
}

/** One approved answer by its slug, rendered now, or null (not live, not on this channel, or not resolvable). */
export async function answerBySlug(slug: string, o: { channel: KbChannel; member: MemberValues | null }, admin?: Admin): Promise<ShownAnswer | null> {
  if (!admin && !hasServiceRole()) return null;
  admin ??= createAdminClient();
  const [{ data, error }, g] = await Promise.all([admin.from('si_knowledge_live').select(LIVE_COLUMNS).eq('slug', slug).contains('channels', [o.channel]).maybeSingle(), readGlobalSnapshot(admin)]);
  if (error || !data || !g) return null;
  const e = liveFromRow(data as Record<string, unknown>);
  if (!e) return null;
  const r = renderEntry(e, g, o.member);
  return r.kind === 'ok' ? { entryId: e.id, slug: e.slug, version: e.version, question: r.question, answer: r.answer } : null;
}

// ── Admin reads ─────────────────────────────────────────────────────────────

export async function allEntries(admin: Admin = createAdminClient()): Promise<KnowledgeRow[] | null> {
  const { data, error } = await admin.from('si_knowledge').select(KNOWLEDGE_COLUMNS).order('slug');
  if (error) {
    if (!isSchemaMissing(error)) console.error('[knowledge] entries read failed:', error.message);
    return null;
  }
  return (data ?? []) as unknown as KnowledgeRow[];
}

export async function entryById(id: string, admin: Admin = createAdminClient()): Promise<KnowledgeRow | null> {
  const { data } = await admin.from('si_knowledge').select(KNOWLEDGE_COLUMNS).eq('id', id).maybeSingle();
  return (data as unknown as KnowledgeRow | null) ?? null;
}

export interface HistoryRow {
  at: string;
  actor: string;
  action: string;
  version: number | null;
  before: unknown;
  after: unknown;
  note: string | null;
}

export async function historyFor(id: string, admin: Admin = createAdminClient()): Promise<HistoryRow[]> {
  const { data } = await admin.from('si_knowledge_history').select('at, actor, action, version, before, after, note').eq('entry_id', id).order('at', { ascending: false }).limit(100);
  return (data ?? []) as HistoryRow[];
}

// ── Writes ──────────────────────────────────────────────────────────────────

export type WriteResult = { ok: true; id: string; version?: number } | { ok: false; error: string };

async function addHistory(admin: Admin, entryId: string, actor: string, action: string, o: { version?: number; before?: unknown; after?: unknown; note?: string } = {}): Promise<void> {
  const { error } = await admin.from('si_knowledge_history').insert({ entry_id: entryId, actor, action, version: o.version ?? null, before: o.before ?? null, after: o.after ?? null, note: o.note ?? null });
  if (error) console.error('[knowledge] history write failed:', error.message);
}

/** A new entry, as a pending draft (nothing goes live until it is approved). */
export async function createEntry(o: { slug: string; content: EntryContent; source: KbSource; actor: string; seedHash?: string | null; note?: string | null }, admin: Admin = createAdminClient()): Promise<WriteResult> {
  const draft = draftJson(o.content);
  const { data, error } = await admin
    .from('si_knowledge')
    .insert({ slug: o.slug, source: o.source, draft, draft_state: 'pending', draft_hash: contentHash(o.content), draft_source: o.source, draft_note: o.note ?? null, draft_at: new Date().toISOString(), seed_hash: o.seedHash ?? null })
    .select('id, version')
    .single();
  if (error) return { ok: false, error: error.code === '23505' ? `"${o.slug}" is already taken.` : error.message };
  const row = data as { id: string; version: number };
  await addHistory(admin, row.id, o.actor, o.source === 'seed' ? 'seeded' : 'created', { version: row.version, after: draft, note: o.note ?? undefined });
  return { ok: true, id: row.id, version: row.version };
}

/**
 * A new or changed draft on an existing entry, if it is still the version the
 * writer read. The live answer is untouched until the draft is approved.
 */
export async function saveDraft(o: { id: string; version: number; content: EntryContent; source: KbSource; actor: string; seedHash?: string; note?: string | null }, admin: Admin = createAdminClient()): Promise<WriteResult> {
  const draft = draftJson(o.content);
  const patch: Record<string, unknown> = { draft, draft_state: 'pending', draft_hash: contentHash(o.content), draft_source: o.source, draft_note: o.note ?? null, draft_at: new Date().toISOString() };
  if (o.seedHash) patch.seed_hash = o.seedHash;
  const { data, error } = await admin.from('si_knowledge').update(patch).eq('id', o.id).eq('version', o.version).is('retired_at', null).select('id, version');
  if (error) return { ok: false, error: error.message };
  const row = (data as { id: string; version: number }[] | null)?.[0];
  if (!row) return { ok: false, error: 'This entry changed since you opened it. Reload and try again.' };
  await addHistory(admin, o.id, o.actor, o.source === 'seed' ? 'seeded' : 'edited', { version: row.version, after: draft, note: o.note ?? undefined });
  return { ok: true, id: o.id, version: row.version };
}

export interface ApproveInput {
  id: string;
  version: number;
  /** The draft hash shown (approving a draft), or null when re-approving a stale entry's live answer. */
  hash: string | null;
  actor: string;
}

/**
 * Approve the pending draft (or, for a stale entry with no draft, its live
 * answer as it stands). Checked here first (placeholders resolve now, no
 * typed figures, call rules), then made atomic by si_knowledge_approve.
 */
export async function approveEntry(o: ApproveInput, admin: Admin = createAdminClient()): Promise<WriteResult & { channels?: string[] }> {
  const row = await entryById(o.id, admin);
  if (!row) return { ok: false, error: 'No such entry.' };
  if (row.version !== o.version) return { ok: false, error: 'This entry changed since you opened it. Reload and try again.' };
  const mode = o.hash ? 'draft' : 'live';
  const content = mode === 'draft' ? (row.draft_state === 'pending' ? draftContent(row.draft) : null) : liveContent(row);
  if (!content) return { ok: false, error: mode === 'draft' ? 'There is no pending draft to approve.' : 'There is nothing live to approve again.' };
  if (mode === 'draft' && contentHash(content) !== o.hash) return { ok: false, error: 'This draft changed since you opened it. Reload and try again.' };
  const g = await readGlobalSnapshot(admin);
  if (!g) return { ok: false, error: "The settings couldn't be read, so the figures couldn't be checked. Try again." };
  const check = checkContent(content, g);
  if (check.errors.length) return { ok: false, error: check.errors.join(' ') };
  const { data, error } = await admin.rpc('si_knowledge_approve', { p: { id: o.id, version: o.version, hash: o.hash, by: o.actor, mode } });
  if (error) return { ok: false, error: error.message };
  const res = data as { id?: string; version?: number; refused?: string };
  if (res.refused) return { ok: false, error: res.refused === 'changed' ? 'This entry changed since you opened it. Reload and try again.' : `Not approved (${res.refused}).` };
  // Any gap this entry answers is covered now, wherever it was approved from (Gaps or the entry's page).
  const at = new Date().toISOString();
  const { error: gapError } = await admin.from('si_knowledge_gaps').update({ status: 'covered', match_kind: 'approved', decided_at: at, asked_since_decision: 0, updated_at: at }).eq('entry_id', o.id).neq('status', 'dismissed');
  if (gapError && !isSchemaMissing(gapError)) console.error('[knowledge] gap close failed:', gapError.message);
  return { ok: true, id: o.id, version: res.version, channels: content.channels };
}

/** Reject the pending draft. The text is kept (draft_state rejected) so the same answer is not suggested again. */
export async function rejectDraft(o: { id: string; version: number; actor: string; note?: string | null }, admin: Admin = createAdminClient()): Promise<WriteResult> {
  const { data, error } = await admin.from('si_knowledge').update({ draft_state: 'rejected', draft_note: o.note ?? null }).eq('id', o.id).eq('version', o.version).eq('draft_state', 'pending').select('id, version, draft');
  if (error) return { ok: false, error: error.message };
  const row = (data as { id: string; version: number; draft: unknown }[] | null)?.[0];
  if (!row) return { ok: false, error: 'This entry changed since you opened it, or has no pending draft.' };
  await addHistory(admin, o.id, o.actor, 'rejected', { version: row.version, before: row.draft, note: o.note ?? undefined });
  await admin.from('si_knowledge_gaps').update({ status: 'rejected', decided_at: new Date().toISOString(), asked_since_decision: 0, updated_at: new Date().toISOString() }).eq('entry_id', o.id).in('status', ['open', 'drafted']);
  return { ok: true, id: o.id, version: row.version };
}

/** Take an entry off every channel for good (kept, with its history, so it is never suggested again). */
export async function retireEntry(o: { id: string; version: number; actor: string; note?: string | null }, admin: Admin = createAdminClient()): Promise<WriteResult & { channels?: string[] }> {
  const { data, error } = await admin.from('si_knowledge').update({ retired_at: new Date().toISOString() }).eq('id', o.id).eq('version', o.version).is('retired_at', null).select('id, version, channels');
  if (error) return { ok: false, error: error.message };
  const row = (data as { id: string; version: number; channels: string[] | null }[] | null)?.[0];
  if (!row) return { ok: false, error: 'This entry changed since you opened it. Reload and try again.' };
  await addHistory(admin, o.id, o.actor, 'retired', { version: row.version, note: o.note ?? undefined });
  return { ok: true, id: o.id, version: row.version, channels: row.channels ?? [] };
}

/** Add phrasings to a live entry's variants (a gap that matched an approved answer): a pending draft, approved like any other. */
export async function proposeVariants(o: { id: string; phrasings: string[]; actor: string }, admin: Admin = createAdminClient()): Promise<WriteResult> {
  const row = await entryById(o.id, admin);
  if (!row) return { ok: false, error: 'No such entry.' };
  const live = liveContent(row);
  if (!live) return { ok: false, error: 'That entry has no approved answer yet.' };
  if (row.draft_state === 'pending') return { ok: false, error: 'That entry already has a pending draft: approve or reject it first.' };
  const have = new Set([live.question, ...live.variants].map((v) => v.trim().toLowerCase()));
  const extra = o.phrasings.map((p) => p.trim()).filter((p) => p && !/[{}]/.test(p) && !have.has(p.toLowerCase()));
  if (!extra.length) return { ok: false, error: 'Those phrasings are already on the entry.' };
  return saveDraft({ id: row.id, version: row.version, content: { ...live, variants: [...live.variants, ...extra] }, source: 'manual', actor: o.actor, note: 'New phrasings from Gaps' }, admin);
}

// ── Stale ──────────────────────────────────────────────────────────────────

export interface StaleCheck {
  checked: number;
  newlyStale: { id: string; slug: string; reason: string }[];
  /** Live entries allowed on calls whose status changed: the agent needs a re-sync. */
  callChanged: boolean;
}

/**
 * Check every live entry against the settings now; mark the ones that no
 * longer resolve as stale (hidden, flagged in admin). Conditional on the
 * version read, so it can never overwrite an approval made meanwhile. With
 * `dry`, reports only. Run by the admin pages and the nightly job — never
 * from a member's request.
 */
export async function checkStale(o: { dry: boolean; actor: string }, admin: Admin = createAdminClient()): Promise<StaleCheck | null> {
  const [rows, g] = await Promise.all([allEntries(admin), readGlobalSnapshot(admin)]);
  if (!rows || !g) return null;
  const out: StaleCheck = { checked: 0, newlyStale: [], callChanged: false };
  for (const r of rows) {
    if (!isLive(r)) continue;
    out.checked++;
    const content = liveContent(r);
    const reason = content ? staleReason(content, g) : null;
    if (!reason) continue;
    out.newlyStale.push({ id: r.id, slug: r.slug, reason });
    if ((r.channels ?? []).includes('call')) out.callChanged = true;
    if (o.dry) continue;
    const { data } = await admin.from('si_knowledge').update({ stale_reason: reason, stale_at: new Date().toISOString() }).eq('id', r.id).eq('version', r.version).is('stale_reason', null).select('version');
    const v = (data as { version: number }[] | null)?.[0]?.version;
    if (v) await addHistory(admin, r.id, o.actor, 'staled', { version: v, note: reason });
  }
  return out;
}

/** The catalogue for admin: every placeholder and condition with its current value. */
export function catalogue(g: GlobalSnapshot | null): { name: string; label: string; scope: string; reads: string; value: string | null; kind: 'placeholder' | 'condition' }[] {
  const ph = Object.entries(PLACEHOLDERS).map(([name, d]) => ({ name, label: d.label, scope: d.scope, reads: d.reads, value: g && d.scope === 'global' ? d.resolve(g, null) : null, kind: 'placeholder' as const }));
  const cs = Object.entries(CONDITIONS).map(([name, d]) => ({ name, label: d.label, scope: d.scope, reads: '', value: g && d.scope === 'global' ? String(d.resolve(g, null)) : null, kind: 'condition' as const }));
  return [...ph, ...cs];
}
