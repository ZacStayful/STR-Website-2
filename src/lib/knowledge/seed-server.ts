import 'server-only';

/**
 * Batch 24: the seed one-off. Puts src/lib/knowledge/seed.ts into the
 * knowledge base as drafts for Zac to approve; never approves anything and
 * never touches a live answer (seed.ts planSeed has the rules). `dry` reports
 * what it would insert and propose and writes nothing. Run from
 * /admin/intelligence/knowledge (Dry run / Seed) or
 * /api/internal/si-knowledge?step=seed[&dry=1].
 */
import { createAdminClient } from '../supabase/admin';
import { contentHash } from './render';
import { SEED, planSeed, type SeedRowState } from './seed';
import { createEntry, entryById, isSchemaMissing, saveDraft, type Admin } from './store-server';

export interface SeedRunResult {
  ok: boolean;
  dry: boolean;
  message: string;
  inserted: string[];
  proposed: string[];
  skipped: { slug: string; reason: string }[];
  unchanged: number;
  failed: { slug: string; error: string }[];
}

export async function runKnowledgeSeed(o: { dry: boolean; actor: string }, admin: Admin = createAdminClient()): Promise<SeedRunResult> {
  const empty = { inserted: [], proposed: [], skipped: [], unchanged: 0, failed: [] };
  const { data, error } = await admin.from('si_knowledge').select('id, slug, seed_hash, draft_state, draft_source, version');
  if (error) return { ok: false, dry: o.dry, message: isSchemaMissing(error) ? 'Run the Batch 24 section of supabase/schema.sql first.' : error.message, ...empty };
  const rows = (data ?? []) as { id: string; slug: string; seed_hash: string | null; draft_state: SeedRowState['draftState']; draft_source: string | null; version: number }[];
  const plan = planSeed(
    rows.map((r) => ({ slug: r.slug, seedHash: r.seed_hash, draftState: r.draft_state, draftSource: r.draft_source })),
    SEED,
    contentHash,
  );
  const result: SeedRunResult = { ok: true, dry: o.dry, message: '', inserted: plan.insert.map((e) => e.slug), proposed: plan.propose.map((e) => e.slug), skipped: plan.skipped, unchanged: plan.unchanged.length, failed: [] };
  if (o.dry) {
    result.message = `Dry run: would add ${plan.insert.length} draft${plan.insert.length === 1 ? '' : 's'} and propose ${plan.propose.length} change${plan.propose.length === 1 ? '' : 's'}. Nothing written.`;
    return result;
  }
  for (const e of plan.insert) {
    const r = await createEntry({ slug: e.slug, content: e, source: 'seed', actor: o.actor, seedHash: contentHash(e), note: `From ${e.from}` }, admin);
    if (!r.ok) result.failed.push({ slug: e.slug, error: r.error });
  }
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  for (const e of plan.propose) {
    const row = bySlug.get(e.slug);
    const fresh = row ? await entryById(row.id, admin) : null;
    if (!fresh) {
      result.failed.push({ slug: e.slug, error: 'gone' });
      continue;
    }
    const r = await saveDraft({ id: fresh.id, version: fresh.version, content: e, source: 'seed', actor: o.actor, seedHash: contentHash(e), note: `Seed text changed (${e.from})` }, admin);
    if (!r.ok) result.failed.push({ slug: e.slug, error: r.error });
  }
  const done = result.inserted.length + result.proposed.length - result.failed.length;
  result.ok = result.failed.length === 0;
  result.message = `Added or proposed ${done} draft${done === 1 ? '' : 's'} for approval${result.failed.length ? `; ${result.failed.length} failed` : ''}. Nothing is live until you approve it.`;
  return result;
}
