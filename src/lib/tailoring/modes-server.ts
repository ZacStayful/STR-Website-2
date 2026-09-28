import 'server-only';

/**
 * The must-have / nice-to-have switches as stored (search_profiles.filter_modes,
 * Batch 14's schema section), read in queries of their own so a database
 * without the column costs only the switches. Kept apart from server.ts so
 * Batch 13's profile writes can copy a profile's switches without importing
 * the rest of tailoring.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { parseFilterModes, type FilterModes } from './profile';

type Admin = ReturnType<typeof createAdminClient>;

const ID_CHUNK = 150;

let warnedAt = 0;
function warn(message: string): void {
  if (Date.now() - warnedAt < 60_000) return;
  warnedAt = Date.now();
  console.warn('[tailoring]', message);
}

/** The switches of each profile. A profile missing from the map could not be read (the column is not there yet). */
export async function modesFor(admin: Admin, profileIds: readonly string[]): Promise<Map<string, FilterModes>> {
  const out = new Map<string, FilterModes>();
  for (let i = 0; i < profileIds.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('search_profiles').select('id, filter_modes').in('id', profileIds.slice(i, i + ID_CHUNK));
    if (error) {
      warn(`filter_modes unreadable (Batch 14 schema not run?): ${error.message}`);
      return new Map();
    }
    for (const r of (data ?? []) as { id: string; filter_modes: unknown }[]) out.set(r.id, parseFilterModes(r.filter_modes));
  }
  return out;
}

/** A new profile starts from the one it was copied from: its switches too (Batch 13's create copies the rest). */
export async function copyFilterModes(fromProfileId: string, toProfileId: string): Promise<void> {
  if (!hasServiceRole()) return;
  const admin = createAdminClient();
  const modes = (await modesFor(admin, [fromProfileId])).get(fromProfileId);
  if (!modes || Object.keys(modes).length === 0) return;
  const { error } = await admin.from('search_profiles').update({ filter_modes: modes }).eq('id', toProfileId);
  if (error) warn(`copying switches failed: ${error.message}`);
}
