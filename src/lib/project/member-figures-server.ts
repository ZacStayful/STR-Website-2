import 'server-only';

/**
 * A member's own working on a Project deal, kept (Part G): every save is a
 * new version, and at most one version a member a deal is locked (the
 * partial unique index project_member_figures_locked_uidx). Everything is
 * scoped to the member's own user id: another member, teammates included,
 * never reads it. Editing, saving and locking cost nothing.
 */
import type { createAdminClient } from '../supabase/admin';
import type { WorksLine } from './costing';
import type { MemberFigures } from './member-figures';

type Admin = ReturnType<typeof createAdminClient>;

export interface SavedWorking {
  version: number;
  lines: WorksLine[];
  figures: MemberFigures | null;
  locked: boolean;
  createdAt: string;
}

function parseRow(r: { version: number; lines: unknown; figures: unknown; locked: boolean; created_at: string }): SavedWorking | null {
  if (!Array.isArray(r.lines)) return null;
  return { version: Number(r.version), lines: r.lines as WorksLine[], figures: r.figures && typeof r.figures === 'object' ? (r.figures as MemberFigures) : null, locked: r.locked === true, createdAt: r.created_at };
}

/** The member's latest version and their locked one (often the same), or nulls. */
export async function memberWorkingFor(admin: Admin, userId: string, dealId: string): Promise<{ latest: SavedWorking | null; locked: SavedWorking | null }> {
  const { data, error } = await admin.from('project_member_figures').select('version, lines, figures, locked, created_at').eq('user_id', userId).eq('deal_id', dealId).order('version', { ascending: false }).limit(20);
  if (error) {
    if (!/does not exist|could not find/i.test(error.message ?? '')) console.warn('[project] member figures unreadable:', error.message);
    return { latest: null, locked: null };
  }
  const rows = ((data ?? []) as { version: number; lines: unknown; figures: unknown; locked: boolean; created_at: string }[]).map(parseRow).filter((r): r is SavedWorking => r !== null);
  return { latest: rows[0] ?? null, locked: rows.find((r) => r.locked) ?? null };
}

/** A member's locked figures on these deals, by deal id (the Full analysis reads them). */
export async function lockedFiguresFor(admin: Admin, userId: string, dealIds: readonly string[]): Promise<Map<string, SavedWorking>> {
  const out = new Map<string, SavedWorking>();
  if (dealIds.length === 0) return out;
  const { data, error } = await admin.from('project_member_figures').select('deal_id, version, lines, figures, locked, created_at').eq('user_id', userId).eq('locked', true).in('deal_id', [...dealIds]);
  if (error) return out;
  for (const r of (data ?? []) as { deal_id: string; version: number; lines: unknown; figures: unknown; locked: boolean; created_at: string }[]) {
    const w = parseRow(r);
    if (w) out.set(r.deal_id, w);
  }
  return out;
}

export type SaveOutcome = { ok: true; version: number } | { ok: false; error: 'storage' };

/** A new version of the member's working; locked when asked, which unlocks any version locked before it. */
export async function saveMemberWorking(admin: Admin, input: { userId: string; dealId: string; lines: WorksLine[]; figures: MemberFigures; lock: boolean }): Promise<SaveOutcome> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: top, error: topErr } = await admin.from('project_member_figures').select('version').eq('user_id', input.userId).eq('deal_id', input.dealId).order('version', { ascending: false }).limit(1).maybeSingle();
    if (topErr) {
      console.error('[project] member figures read failed:', topErr.message);
      return { ok: false, error: 'storage' };
    }
    const version = Number((top as { version?: number } | null)?.version ?? 0) + 1;
    if (input.lock) {
      const { error: unlockErr } = await admin.from('project_member_figures').update({ locked: false }).eq('user_id', input.userId).eq('deal_id', input.dealId).eq('locked', true);
      if (unlockErr) {
        console.error('[project] member figures unlock failed:', unlockErr.message);
        return { ok: false, error: 'storage' };
      }
    }
    const { error } = await admin.from('project_member_figures').insert({ user_id: input.userId, deal_id: input.dealId, version, lines: input.lines, figures: input.figures, locked: input.lock });
    if (!error) return { ok: true, version };
    // Two saves at once took the same version: once more, on the next one.
    if (error.code !== '23505') {
      console.error('[project] member figures write failed:', error.message);
      return { ok: false, error: 'storage' };
    }
  }
  return { ok: false, error: 'storage' };
}

/** Unlocks the member's locked version, if any; the version it was, or null. */
export async function unlockMemberWorking(admin: Admin, userId: string, dealId: string): Promise<number | null> {
  const { data, error } = await admin.from('project_member_figures').update({ locked: false }).eq('user_id', userId).eq('deal_id', dealId).eq('locked', true).select('version');
  if (error) {
    console.error('[project] member figures unlock failed:', error.message);
    return null;
  }
  const rows = (data ?? []) as { version: number }[];
  return rows.length > 0 ? Number(rows[0].version) : null;
}
