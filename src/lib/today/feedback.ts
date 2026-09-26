import 'server-only';

/**
 * One member's answers, as the daily picks run reads them for everyone: their
 * replies to emailed picks (sourcing_sent), each joined to the listing it was
 * about and the screening it was sent on, merged with their Keep / Pass on the
 * grid (deal_reactions) so each listing counts once, at its latest answer.
 * Same window, same mapping (toPickFeedback), same merge (mergeFeedback) — so
 * a "too expensive" on this morning's email shapes this morning's Today.
 */
import { createAdminClient } from '../supabase/admin';
import { FEEDBACK_WINDOW_MS, toPickFeedback } from '../listing/rank';
import { parseScreening, type Screening } from '../listing/screen';
import type { SourcedListing } from '../listing/sourcing';
import type { PickFeedback } from '../listing/picks';
import { mergeFeedback, type FeedbackEntry } from '../marketplace/reactions';
import { dealFeedbackFor } from '../marketplace/reactions-server';

type Admin = ReturnType<typeof createAdminClient>;

const URL_CHUNK = 150;

export async function feedbackForMember(admin: Admin, userId: string, now: Date = new Date()): Promise<PickFeedback[]> {
  const since = new Date(now.getTime() - FEEDBACK_WINDOW_MS).toISOString();
  type Row = { canonical_url: string; reaction: unknown; reaction_source: unknown; reasons: unknown; kind: unknown; postcode_area: unknown; responded_at: unknown };
  const { data, error } = await admin
    .from('sourcing_sent')
    .select('canonical_url, reaction, reaction_source, reasons, kind, postcode_area, responded_at')
    .eq('user_id', userId)
    .not('reaction', 'is', null)
    .gte('responded_at', since);
  if (error) console.warn('[today] pick feedback read failed:', error.message);
  const rows = (data ?? []) as Row[];

  // Read apart from the answers, as the run does: a missing column here can
  // only cost the "return too low" floor, never every rule.
  const screening = new Map<string, Screening | null>();
  if (rows.length > 0) {
    const { data: sc, error: scErr } = await admin.from('sourcing_sent').select('canonical_url, screening').eq('user_id', userId).not('reaction', 'is', null).gte('responded_at', since);
    if (scErr) console.warn('[today] screening feedback read failed:', scErr.message);
    for (const r of (sc ?? []) as { canonical_url: string; screening: unknown }[]) screening.set(r.canonical_url, parseScreening(r.screening));
  }

  const listings = new Map<string, SourcedListing>();
  const urls = [...new Set(rows.map((r) => r.canonical_url))];
  for (let i = 0; i < urls.length; i += URL_CHUNK) {
    const { data: snaps } = await admin.from('sourced_listings').select('canonical_url, snapshot').in('canonical_url', urls.slice(i, i + URL_CHUNK));
    for (const r of (snaps ?? []) as { canonical_url: string; snapshot: SourcedListing }[]) listings.set(r.canonical_url, r.snapshot);
  }

  const pickEntries: FeedbackEntry[] = rows.map((r) => ({
    url: r.canonical_url,
    at: typeof r.responded_at === 'string' ? r.responded_at : null,
    feedback: toPickFeedback(r, listings.get(r.canonical_url) ?? null, screening.get(r.canonical_url) ?? null),
  }));
  const grid = await dealFeedbackFor(admin, [userId], since);
  return mergeFeedback(pickEntries, grid.entries.get(userId) ?? []);
}
