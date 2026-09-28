import 'server-only';

/**
 * Tailoring's reads: one loader for every place a Today list is chosen (the
 * Today page, the daily picks passes and the digest), so a list the 07:00
 * run stores is chosen on exactly what the page would have used.
 *
 * For each seat (a member's saved profile, or the member when they have no
 * profile row yet) it reads, in bulk:
 *   - the member's "About you" (profiles.about_you) and quiz marks
 *     (profile_quiz.answered; the shared About-you marks are the member's)
 *   - the profile's must-have / nice-to-have overrides
 *     (search_profiles.filter_modes, Batch 14's schema section), in a query
 *     of its own: until that section is run it reads as "no overrides" and
 *     nothing else is lost
 *   - what the member showed they liked in the last 60 days: Keeps
 *     (deal_reactions, per profile since Batch 13) and their own opens and
 *     Full analyses (activity_events deal_open / full_analysis, which record
 *     the member who acted; a pick's auto-open is not logged there)
 *   - Batch 10's profit range widths
 *
 * Nothing read here leaves the server except as the member's own
 * preferences: no address, postcode or listing URL is selected.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getBillingSettings } from '../credit/unit-costs';
import { DEFAULT_ABOUT, parseAboutYou, type AboutYou } from '../profile/about';
import { parseAnswered, type AnsweredMap } from '../profile/state';
import type { MarketGoals } from '../market/goals';
import { seatKey, type SavedProfile } from '../profiles/rules';
import { propertyKind } from '../listing/suitability';
import { rentPcm } from '../listing/sourcing';
import { mergeMarks, parseFilterModes, signalSince, type FilterModes, type Signal, type TailoringProfile } from './profile';

type Admin = ReturnType<typeof createAdminClient>;

const ID_CHUNK = 150;
/** Signal rows read per chunk of members, newest first: far more than any member makes in 60 days. */
const SIGNAL_ROWS = 1000;

export interface SeatInput {
  userId: string;
  /** The saved profile (Batch 13); null for a member with no profile row. */
  profile: Pick<SavedProfile, 'id' | 'isActive' | 'answered'> | null;
  goals: MarketGoals | null;
  savedAreas: readonly string[];
}

// One warning a minute per message: an un-run schema section must not fill the logs.
const warnedAt = new Map<string, number>();
function warn(message: string): void {
  const now = Date.now();
  if (now - (warnedAt.get(message) ?? 0) < 60_000) return;
  warnedAt.set(message, now);
  console.warn('[tailoring]', message);
}

const chunks = <T,>(xs: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += ID_CHUNK) out.push(xs.slice(i, i + ID_CHUNK));
  return out;
};

interface RawSignal {
  userId: string;
  profileId: string | null;
  dealId: string;
  source: Signal['source'];
  at: string;
}

/** The overrides of each profile. Empty for all of them when the column is not there yet. */
async function modesFor(admin: Admin, profileIds: readonly string[]): Promise<Map<string, FilterModes>> {
  const out = new Map<string, FilterModes>();
  for (const some of chunks(profileIds)) {
    const { data, error } = await admin.from('search_profiles').select('id, filter_modes').in('id', some);
    if (error) {
      warn(`filter_modes unreadable (Batch 14 schema not run?): ${error.message}`);
      return out;
    }
    for (const r of (data ?? []) as { id: string; filter_modes: unknown }[]) out.set(r.id, parseFilterModes(r.filter_modes));
  }
  return out;
}

async function signalsFor(admin: Admin, userIds: readonly string[], since: Date): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  const sinceIso = since.toISOString();
  for (const some of chunks(userIds)) {
    const readKeeps = (columns: string) => admin.from('deal_reactions').select(columns).in('user_id', some).eq('reaction', 'keep').gte('updated_at', sinceIso).order('updated_at', { ascending: false }).limit(SIGNAL_ROWS);
    let keeps = await readKeeps('user_id, deal_id, profile_id, updated_at');
    // Before Batch 13's schema: every Keep is the member's one profile's.
    if (keeps.error) keeps = await readKeeps('user_id, deal_id, updated_at');
    if (keeps.error) warn(`keeps unreadable: ${keeps.error.message}`);
    for (const r of (keeps.data ?? []) as unknown as { user_id: string; deal_id: string; profile_id?: string | null; updated_at: string }[]) out.push({ userId: r.user_id, profileId: r.profile_id ?? null, dealId: r.deal_id, source: 'keep', at: r.updated_at });

    const acts = await admin
      .from('activity_events')
      .select('user_id, kind, deal_id, profile_id, occurred_at')
      .in('user_id', some)
      .in('kind', ['deal_open', 'full_analysis'])
      .not('deal_id', 'is', null)
      .gte('occurred_at', sinceIso)
      .order('occurred_at', { ascending: false })
      .limit(SIGNAL_ROWS);
    if (acts.error) warn(`activity unreadable: ${acts.error.message}`);
    for (const r of (acts.data ?? []) as { user_id: string; kind: string; deal_id: string; profile_id: string | null; occurred_at: string }[]) {
      out.push({ userId: r.user_id, profileId: r.profile_id ?? null, dealId: r.deal_id, source: r.kind === 'full_analysis' ? 'analysis' : 'open', at: r.occurred_at });
    }
  }
  return out;
}

/** The deal behind each signal: kind, type, size, area and price only. A deal that has since gone still counts. */
async function signalFacts(admin: Admin, dealIds: readonly string[]): Promise<Map<string, Omit<Signal, 'dealId' | 'source' | 'at'>>> {
  const out = new Map<string, Omit<Signal, 'dealId' | 'source' | 'at'>>();
  for (const some of chunks(dealIds)) {
    const { data, error } = await admin.from('marketplace_deals').select('id, kind, raw_type, bedrooms, postcode_area, price_amount, price_period').in('id', some);
    if (error) {
      warn(`signal deals unreadable: ${error.message}`);
      continue;
    }
    for (const r of (data ?? []) as { id: string; kind: string; raw_type: string | null; bedrooms: number | null; postcode_area: string | null; price_amount: number | string | null; price_period: string | null }[]) {
      if (r.kind !== 'sale' && r.kind !== 'rent') continue;
      const n = r.price_amount === null ? NaN : Number(r.price_amount);
      const period = r.price_period === 'pw' || r.price_period === 'pcm' || r.price_period === 'total' ? r.price_period : r.kind === 'rent' ? 'pcm' : 'total';
      const amount = !Number.isFinite(n) || n <= 0 ? null : r.kind === 'rent' ? rentPcm({ amount: n, period }) : period === 'total' ? n : null;
      out.set(r.id, { kind: r.kind, propertyKind: propertyKind(r.raw_type, null), bedrooms: r.bedrooms, area: r.postcode_area ? r.postcode_area.toUpperCase() : null, amount });
    }
  }
  return out;
}

/**
 * Each seat's tailoring, keyed by seatKey (src/lib/profiles/rules.ts): the
 * key the runs keep a seat's list and charge under. Reads that fail cost
 * only what they would have added (no overrides, no signals, no About-you),
 * never the seat: its Today is then chosen as it was before this batch.
 */
export async function tailoringForSeats(admin: Admin, seats: readonly SeatInput[], now: Date = new Date()): Promise<Map<string, TailoringProfile>> {
  const out = new Map<string, TailoringProfile>();
  if (seats.length === 0) return out;
  const userIds = [...new Set(seats.map((s) => s.userId))];
  const profileIds = [...new Set(seats.flatMap((s) => (s.profile ? [s.profile.id] : [])))];
  const since = signalSince(now);

  const about = new Map<string, AboutYou>();
  const marks = new Map<string, AnsweredMap>();
  const [settings, modes, raw] = await Promise.all([
    getBillingSettings(),
    modesFor(admin, profileIds),
    signalsFor(admin, userIds, since),
    (async () => {
      for (const some of chunks(userIds)) {
        const [aboutRes, quizRes] = await Promise.all([admin.from('profiles').select('id, about_you').in('id', some), admin.from('profile_quiz').select('user_id, answered').in('user_id', some)]);
        if (aboutRes.error) warn(`about_you unreadable: ${aboutRes.error.message}`);
        for (const r of (aboutRes.data ?? []) as { id: string; about_you: unknown }[]) about.set(r.id, parseAboutYou(r.about_you) ?? DEFAULT_ABOUT);
        if (quizRes.error) warn(`quiz marks unreadable: ${quizRes.error.message}`);
        for (const r of (quizRes.data ?? []) as { user_id: string; answered: unknown }[]) marks.set(r.user_id, parseAnswered(r.answered));
      }
    })(),
  ]);
  const facts = await signalFacts(admin, [...new Set(raw.map((s) => s.dealId))]);

  for (const seat of seats) {
    const memberMarks = marks.get(seat.userId) ?? {};
    const profile = seat.profile;
    // A seat's signals: those tagged with its profile, and untagged ones for the
    // active profile (the one the member was using), or all of them with no profile.
    const own = raw.filter((s) => s.userId === seat.userId && (!profile || s.profileId === profile.id || (s.profileId === null && profile.isActive)));
    const seen = new Set<string>();
    const signals: Signal[] = [];
    for (const s of own.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
      const f = facts.get(s.dealId);
      const key = `${s.source}|${s.dealId}`;
      if (!f || seen.has(key)) continue;
      seen.add(key);
      signals.push({ dealId: s.dealId, source: s.source, at: s.at, ...f });
    }
    out.set(seatKey(seat.userId, profile?.id ?? null), {
      profileId: profile?.id ?? null,
      goals: seat.goals,
      savedAreas: [...seat.savedAreas],
      about: about.get(seat.userId) ?? DEFAULT_ABOUT,
      answered: profile ? mergeMarks(profile.answered, memberMarks) : memberMarks,
      modes: profile ? modes.get(profile.id) ?? {} : {},
      signals,
      widths: settings.dealPricing.profitRangePct,
    });
  }
  return out;
}

/** One member's tailoring for the profile they are on (the Today page). Null without the service role. */
export async function tailoringForMember(userId: string, profile: SeatInput['profile'], goals: MarketGoals | null, savedAreas: readonly string[], now: Date = new Date()): Promise<TailoringProfile | null> {
  if (!hasServiceRole()) return null;
  try {
    const map = await tailoringForSeats(createAdminClient(), [{ userId, profile, goals, savedAreas }], now);
    return map.get(seatKey(userId, profile?.id ?? null)) ?? null;
  } catch (err) {
    warn(`tailoring failed: ${(err as Error)?.message ?? err}`);
    return null;
  }
}
