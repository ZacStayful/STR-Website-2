import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { teamOf } from '../team';
import { getAreaCardsWithin } from '../market/cached';
import { AREA_META } from '../market/areas';
import { parseMarketGoals } from '../market/goals';
import { welcomeDue, skipsFrom } from './status';
import type { WelcomeArea } from './answers';

export interface WelcomeStatus {
  due: boolean;
  hasGoals: boolean;
  skips: number;
}

/**
 * Whether /welcome should show for this member. Null when the profile could
 * not be read — no row yet, or the Batch 2 schema section not run — and the
 * caller then simply sends the member on: the questions are a nicety, never
 * a wall.
 */
export async function welcomeStatusFor(supabase: SupabaseClient, userId: string): Promise<WelcomeStatus | null> {
  const { data, error } = await supabase.from('profiles').select('market_goals, onboarding_skips').eq('id', userId).maybeSingle();
  if (error) {
    console.error('[welcome] profile read failed (schema behind?):', error.message);
    return null;
  }
  if (!data) return null;
  const row = data as { market_goals: unknown; onboarding_skips: unknown };
  const hasGoals = parseMarketGoals(row.market_goals) !== null;
  const skips = skipsFrom(row.onboarding_skips);
  const team = await teamOf(userId);
  return { due: welcomeDue({ hasGoals, skips, teamRole: team.role }), hasGoals, skips };
}

/** How long the area picker waits for the market snapshot before falling back to the plain list. */
const AREAS_WAIT_MS = 5_000;

/**
 * Every postcode area for the picker: the ranked ones first, in the
 * explorer's order (data confidence, then score), then the rest by name so
 * all 124 stay selectable even when the snapshot is cold.
 */
export async function rankedAreasForWelcome(): Promise<WelcomeArea[]> {
  const cards = (await getAreaCardsWithin(AREAS_WAIT_MS).catch((err) => {
    console.error('[welcome] area cards failed:', (err as Error)?.message ?? err);
    return null;
  })) ?? [];
  const out: WelcomeArea[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    out.push({ code: c.code, name: c.name, score: c.score?.score ?? null });
  }
  const rest = AREA_META.filter((a) => !seen.has(a.code)).sort((a, b) => a.name.localeCompare(b.name));
  for (const a of rest) out.push({ code: a.code, name: a.name, score: null });
  return out;
}
