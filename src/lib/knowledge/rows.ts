/**
 * Batch 24: the si_knowledge row as read, and what it means.
 *
 * Pure: no network, no database, no server-only.
 */
import { draftContent, type EntryContent, type LiveEntry } from './render.ts';

/** The columns admin pages read (members read si_knowledge_live, which has no draft). */
export const KNOWLEDGE_COLUMNS =
  'id, slug, question, variants, answer, category, channels, show_when, draft, draft_state, draft_hash, draft_source, draft_note, draft_at, version, approved_at, approved_by, stale_reason, stale_at, retired_at, source, seed_hash, created_at, updated_at';

/** The view members' code reads: live columns only. */
export const LIVE_COLUMNS = 'id, slug, version, question, variants, answer, category, channels, show_when';

export interface KnowledgeRow {
  id: string;
  slug: string;
  question: string | null;
  variants: string[] | null;
  answer: string | null;
  category: string | null;
  channels: string[] | null;
  show_when: string | null;
  draft: unknown;
  draft_state: 'none' | 'pending' | 'rejected';
  draft_hash: string | null;
  draft_source: string | null;
  draft_note: string | null;
  draft_at: string | null;
  version: number;
  approved_at: string | null;
  approved_by: string | null;
  stale_reason: string | null;
  stale_at: string | null;
  retired_at: string | null;
  source: string;
  seed_hash: string | null;
  created_at: string;
  updated_at: string;
}

export type EntryStatus = 'draft' | 'approved' | 'rejected' | 'stale' | 'retired';

export const STATUS_LABEL: Record<EntryStatus, string> = { draft: 'Draft', approved: 'Approved', rejected: 'Rejected', stale: 'Stale', retired: 'Retired' };

export function isLive(r: Pick<KnowledgeRow, 'answer' | 'question' | 'category' | 'stale_reason' | 'retired_at'>): boolean {
  return r.answer !== null && r.question !== null && r.category !== null && r.stale_reason === null && r.retired_at === null;
}

/** Retired, then stale, then live; otherwise a draft that was never approved (pending or rejected). */
export function entryStatus(r: KnowledgeRow): EntryStatus {
  if (r.retired_at) return 'retired';
  if (r.stale_reason && r.answer !== null) return 'stale';
  if (isLive(r)) return 'approved';
  return r.draft_state === 'rejected' ? 'rejected' : 'draft';
}

/** The live columns as content, or null when the entry has never been approved. */
export function liveContent(r: Pick<KnowledgeRow, 'question' | 'variants' | 'answer' | 'category' | 'channels' | 'show_when'>): EntryContent | null {
  if (r.question === null || r.answer === null || r.category === null) return null;
  return { question: r.question, variants: r.variants ?? [], answer: r.answer, category: r.category, channels: r.channels ?? [], showWhen: r.show_when };
}

/** A pending (or rejected) draft's content. */
export function pendingContent(r: Pick<KnowledgeRow, 'draft'>): EntryContent | null {
  return draftContent(r.draft);
}

/** A si_knowledge_live row → a LiveEntry. Anything malformed is dropped by the caller (null). */
export function liveFromRow(r: Record<string, unknown>): LiveEntry | null {
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const id = str(r.id);
  const slug = str(r.slug);
  const question = str(r.question);
  const answer = str(r.answer);
  const category = str(r.category);
  const version = Number(r.version);
  if (!id || !slug || question === null || answer === null || category === null || !Number.isInteger(version)) return null;
  return { id, slug, version, question, answer, category, variants: strs(r.variants), channels: strs(r.channels), showWhen: str(r.show_when) || null };
}
