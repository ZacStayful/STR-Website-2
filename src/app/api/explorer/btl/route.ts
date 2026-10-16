import { unstable_cache } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { readAllRegionKeyStats } from '@/lib/market/key-stats-cache';
import { btlDistrictRows, type BtlDistrictRow } from '@/lib/btl/explorer';
import { readBtlSettingsCached } from '@/lib/btl/settings-server';
import { logActivity } from '@/lib/activity/log';
import { ukDay } from '@/lib/activity/week';

/**
 * Batch 28, Part H: the Market Explorer's "Buy to let" view: every district
 * the cached region key stats hold (src/lib/btl/explorer.ts). Free: cache
 * reads only, never a provider call. Read once when the member switches the
 * view on, which is recorded (record only).
 */
const rowsCached = unstable_cache(
  async (): Promise<BtlDistrictRow[]> => {
    const buyingCosts = hasServiceRole() ? (await readBtlSettingsCached(createAdminClient())).buyingCosts : 2_500;
    const rows = [...(await readAllRegionKeyStats()).values()].flatMap((s) => s.rows);
    return btlDistrictRows(rows, buyingCosts);
  },
  ['explorer-btl-districts'],
  { revalidate: 3600 },
);

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  logActivity(user.id, 'explorer_btl_toggle', { dedupeKey: `explorer_btl_toggle:${ukDay(new Date())}` });
  const rows = await rowsCached().catch((err) => {
    console.error('[explorer-btl] key stats unreadable:', (err as Error)?.message ?? err);
    return null;
  });
  if (!rows) return Response.json({ error: 'The district figures aren’t available just now.' }, { status: 503 });
  return Response.json({ rows }, { headers: { 'Cache-Control': 'private, max-age=600' } });
}
