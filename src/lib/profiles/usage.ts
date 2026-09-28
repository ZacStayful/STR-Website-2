/**
 * Usage split by saved profile (Batch 13), for the Usage page: what left the
 * balance this period for each of the member's profiles. A debit names its
 * profile in metadata.profile_id (the daily charge, a pick, an open, a Full
 * analysis); a refund comes off the profile of the charge it refunded.
 * Anything a team member spent is theirs ("Team members"), and anything not
 * tied to a profile (top-ups aside: those are not debits) is "Account".
 *
 * Pure: relative `.ts` imports only.
 */
import { percentages, type LedgerLine } from '../credit/usage-breakdown.ts';
import { profileLabel, type SavedProfile } from './rules.ts';

export interface ProfileUsageRow {
  /** The profile's id, 'team' or 'account'. */
  key: string;
  label: string;
  facePence: number;
  pct: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function usageByProfile(lines: readonly LedgerLine[], profiles: readonly Pick<SavedProfile, 'id' | 'name' | 'deletedAt'>[]): ProfileUsageRow[] {
  const own = new Set(profiles.map((p) => p.id));
  // Whose each charge was, by its action id, so a refund follows its charge.
  const owner = new Map<string, string>();
  const keyOf = (l: LedgerLine): string => {
    if (str(l.metadata?.member_id)) return 'team';
    const id = str(l.metadata?.profile_id);
    if (id) return own.has(id) ? id : 'account';
    return 'account';
  };
  for (const l of lines) if (l.kind === 'debit' && l.actionId) owner.set(l.actionId, keyOf(l));
  const totals = new Map<string, number>();
  for (const l of lines) {
    const key = l.kind === 'refund' && l.actionId && owner.has(l.actionId) && !str(l.metadata?.profile_id) ? owner.get(l.actionId)! : keyOf(l);
    const amount = Math.abs(Number(l.facePence) || 0);
    totals.set(key, (totals.get(key) ?? 0) + (l.kind === 'refund' ? -amount : amount));
  }
  const rows = [
    ...profiles.map((p) => ({ key: p.id, label: profileLabel(p) })),
    { key: 'team', label: 'Team members' },
    { key: 'account', label: 'Account (not for one profile)' },
  ]
    .map((r) => ({ ...r, facePence: Math.max(0, Math.round((totals.get(r.key) ?? 0) * 100) / 100) }))
    .filter((r) => r.facePence > 0);
  const pcts = percentages(rows.map((r) => r.facePence));
  return rows.map((r, i) => ({ ...r, pct: pcts[i] }));
}
