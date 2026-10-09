import 'server-only';

/**
 * Batch 25: the daily email's "Saved for you" — standouts Stayful
 * Intelligence saved for a member and did not ring them about (the third and
 * later in a month, members without calls on, a call that could not be
 * placed). One line each, in the next daily email, then marked emailed so a
 * deal is told once. Gone, opened, moved or turned-down deals are left out. Every
 * read is tolerant: before the schema is run nothing is added.
 */
import { createAdminClient } from '../supabase/admin';
import { propertyKind } from '../listing/suitability';
import type { DealType } from '../profile/deal-types';
import type { SavedForYouItem } from '../notify/message';
import { savedForYouLine } from './copy';
import type { ProfitBasis } from './rules';

type Admin = ReturnType<typeof createAdminClient>;

const CHUNK = 150;

/** Each member's "Saved for you" lines, newest last; at most five each (the rest wait for the next email). */
export async function savedForYouFor(admin: Admin, userIds: readonly string[], siteUrl: string): Promise<Map<string, SavedForYouItem[]>> {
  const out = new Map<string, SavedForYouItem[]>();
  const base = siteUrl.replace(/\/$/, '');
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const some = userIds.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from('standout_decisions')
      .select('user_id, deal_id, deal_type, profit_low_pcm, profit_high_pcm, profit_basis, saved_at')
      .in('user_id', some)
      .eq('notify', 'email')
      .not('saved_at', 'is', null)
      .is('emailed_at', null)
      .is('not_for_me_at', null)
      .is('opened_at', null)
      .is('stage_moved_at', null)
      .not('deal_id', 'is', null)
      .order('saved_at', { ascending: true })
      .limit(1000);
    if (error) return out;
    const rows = (data ?? []) as { user_id: string; deal_id: string; deal_type: string | null; profit_low_pcm: number | null; profit_high_pcm: number | null; profit_basis: string | null }[];
    if (rows.length === 0) continue;
    const { data: deals, error: dErr } = await admin.from('marketplace_deals').select('id, status, town, postcode_area, bedrooms, raw_type').in('id', [...new Set(rows.map((r) => r.deal_id))]);
    if (dErr) return out;
    const dealBy = new Map(((deals ?? []) as { id: string; status: string; town: string | null; postcode_area: string | null; bedrooms: number | null; raw_type: string | null }[]).map((d) => [d.id, d]));
    for (const r of rows) {
      const d = dealBy.get(r.deal_id);
      if (!d || d.status !== 'live') continue;
      const list = out.get(r.user_id) ?? [];
      if (list.length >= 5) continue;
      list.push({
        dealId: r.deal_id,
        line: savedForYouLine({
          bedrooms: d.bedrooms,
          propertyKind: propertyKind(d.raw_type, null),
          dealType: (r.deal_type as DealType | null) ?? 'buy_str',
          town: d.town,
          postcodeArea: d.postcode_area,
          range: r.profit_low_pcm !== null && r.profit_high_pcm !== null ? { lowPcm: r.profit_low_pcm, highPcm: r.profit_high_pcm } : null,
          basis: (r.profit_basis as ProfitBasis | null) ?? 'range',
        }),
        url: `${base}/deals/${r.deal_id}?via=email`,
      });
      out.set(r.user_id, list);
    }
  }
  return out;
}

/** The email went: these deals are told. */
export async function markSavedEmailed(admin: Admin, userId: string, dealIds: readonly string[], at: Date = new Date()): Promise<void> {
  if (dealIds.length === 0) return;
  const { error } = await admin.from('standout_decisions').update({ emailed_at: at.toISOString(), updated_at: at.toISOString() }).eq('user_id', userId).in('deal_id', [...dealIds]).is('emailed_at', null);
  if (error) console.error('[standout] emailed mark failed:', error.message);
}
