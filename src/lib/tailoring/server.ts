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
import { parseMarketGoals, type MarketGoals } from '../market/goals';
import { seatKey, type SavedProfile } from '../profiles/rules';
import { propertyKind } from '../listing/suitability';
import { rentPcm } from '../listing/sourcing';
import { mergeMarks, signalSince, usesTailoring, type CriterionKey, type FilterModes, type Mode, type Signal, type TailoringProfile } from './profile';
import { modesFor } from './modes-server';
import { isAdminEmail } from '../admin';
import { payerFor } from '../team';
import { dealVisibilityFor } from '../marketplace/tier';
import { isMissingProjectColumn, rankingPool } from '../marketplace/queries';
import { DEFAULT_FILTERS } from '../marketplace/grid';
import { profilesFor } from '../profiles/server';
import { rechooseToday, type TodaySelection } from '../today/selection';
import { mustMatchCount, tailoredRows } from './today';
import { dealTypeOf, typesShown } from '../profile/deal-types';
import { goalsForType } from '../today/type-filters';
import { isPromptQuestion, type PromptQuestion, type PromptState } from './behaviour';

type Admin = ReturnType<typeof createAdminClient>;

const ID_CHUNK = 150;
/** Signal rows read a page at a time, every page, for each chunk of members. */
const SIGNAL_PAGE = 1000;
/** A backstop only: 20,000 Keeps or opens by 150 members in 60 days is far beyond any real use. */
const SIGNAL_MAX_PAGES = 20;

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

/** Every row a read returns, a page at a time, up to the backstop. The error, if any, and what was read before it. */
async function allPages<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let page = 0; page < SIGNAL_MAX_PAGES; page += 1) {
    const { data, error } = await read(page * SIGNAL_PAGE, page * SIGNAL_PAGE + SIGNAL_PAGE - 1);
    if (error) return { rows, error: error.message };
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < SIGNAL_PAGE) break;
  }
  return { rows, error: null };
}

async function signalsFor(admin: Admin, userIds: readonly string[], since: Date): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  const sinceIso = since.toISOString();
  for (const some of chunks(userIds)) {
    // Every page, in a stable order: one member who opens a great deal can never crowd the rest of the chunk out.
    const readKeeps = (columns: string) =>
      allPages<{ user_id: string; deal_id: string; profile_id?: string | null; updated_at: string }>((from, to) =>
        admin.from('deal_reactions').select(columns).in('user_id', some).eq('reaction', 'keep').gte('updated_at', sinceIso).order('updated_at', { ascending: false }).order('user_id', { ascending: true }).order('deal_id', { ascending: true }).range(from, to),
      );
    let keeps = await readKeeps('user_id, deal_id, profile_id, updated_at');
    // Before Batch 13's schema: every Keep is the member's one profile's.
    if (keeps.error) keeps = await readKeeps('user_id, deal_id, updated_at');
    if (keeps.error) warn(`keeps unreadable: ${keeps.error}`);
    for (const r of keeps.rows) out.push({ userId: r.user_id, profileId: r.profile_id ?? null, dealId: r.deal_id, source: 'keep', at: r.updated_at });

    const acts = await allPages<{ user_id: string; kind: string; deal_id: string; profile_id: string | null; occurred_at: string }>((from, to) =>
      admin
        .from('activity_events')
        .select('user_id, kind, deal_id, profile_id, occurred_at')
        .in('user_id', some)
        .in('kind', ['deal_open', 'full_analysis'])
        .not('deal_id', 'is', null)
        .gte('occurred_at', sinceIso)
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    );
    if (acts.error) warn(`activity unreadable: ${acts.error}`);
    for (const r of acts.rows) out.push({ userId: r.user_id, profileId: r.profile_id ?? null, dealId: r.deal_id, source: r.kind === 'full_analysis' ? 'analysis' : 'open', at: r.occurred_at });
  }
  return out;
}

/** The deal behind each signal: kind, type, size, area and price only. A deal that has since gone still counts. */
async function signalFacts(admin: Admin, dealIds: readonly string[]): Promise<Map<string, Omit<Signal, 'dealId' | 'source' | 'at'>>> {
  const out = new Map<string, Omit<Signal, 'dealId' | 'source' | 'at'>>();
  // Batch 17: the project column tells a BRRR deal; until the schema section is run, every sale is Short-let.
  let withProject = true;
  for (const some of chunks(dealIds)) {
    const read = () => admin.from('marketplace_deals').select(`id, kind, raw_type, bedrooms, postcode_area, price_amount, price_period${withProject ? ', project' : ''}`).in('id', some);
    let { data, error } = await read();
    if (error && withProject && isMissingProjectColumn(error)) {
      withProject = false;
      ({ data, error } = await read());
    }
    if (error) {
      warn(`signal deals unreadable: ${error.message}`);
      continue;
    }
    for (const r of (data ?? []) as unknown as { id: string; kind: string; raw_type: string | null; bedrooms: number | null; postcode_area: string | null; price_amount: number | string | null; price_period: string | null; project?: unknown }[]) {
      if (r.kind !== 'sale' && r.kind !== 'rent') continue;
      const n = r.price_amount === null ? NaN : Number(r.price_amount);
      const period = r.price_period === 'pw' || r.price_period === 'pcm' || r.price_period === 'total' ? r.price_period : r.kind === 'rent' ? 'pcm' : 'total';
      const amount = !Number.isFinite(n) || n <= 0 ? null : r.kind === 'rent' ? rentPcm({ amount: n, period }) : period === 'total' ? n : null;
      out.set(r.id, { kind: r.kind, propertyKind: propertyKind(r.raw_type, null), bedrooms: r.bedrooms, area: r.postcode_area ? r.postcode_area.toUpperCase() : null, amount, dealType: dealTypeOf({ kind: r.kind, project: r.project }) });
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

/**
 * One member's tailoring for the profile they are on (the Today page, the
 * profile page). `fresh`: answers saved in this same request, which a
 * cached read of the profile could miss (for the active profile, the live
 * quiz marks are its marks). Null without the service role.
 */
export async function tailoringForMember(userId: string, profile: SeatInput['profile'], goals: MarketGoals | null, savedAreas: readonly string[], now: Date = new Date(), fresh: { answered?: AnsweredMap; about?: AboutYou } = {}): Promise<TailoringProfile | null> {
  if (!hasServiceRole()) return null;
  try {
    const map = await tailoringForSeats(createAdminClient(), [{ userId, profile, goals, savedAreas }], now);
    const t = map.get(seatKey(userId, profile?.id ?? null)) ?? null;
    if (!t) return null;
    return { ...t, ...(fresh.answered ? { answered: fresh.answered } : {}), ...(fresh.about ? { about: fresh.about } : {}) };
  } catch (err) {
    warn(`tailoring failed: ${(err as Error)?.message ?? err}`);
    return null;
  }
}

/** The active profile's tailoring for answers the quiz holds right now: its live count. */
export async function tailoringPreview(userId: string, answers: { goals: MarketGoals; about: AboutYou; savedAreas: readonly string[] }, answered?: AnsweredMap): Promise<TailoringProfile | null> {
  const view = await profilesFor(userId);
  return tailoringForMember(userId, view.readable ? view.active : null, answers.goals, answers.savedAreas, new Date(), { answered, about: answers.about });
}

// ── Writes ──

export type ModeOutcome = { ok: true; profileId: string } | { ok: false; error: string };

/**
 * One must-have / nice-to-have switch on the member's active profile. The
 * mode is stored even when it is the default, so a profile a member has
 * set stays tailored and flipping a switch back and forth settles on the
 * same list. The caller has checked the session; `key` is checked here.
 */
export async function saveFilterMode(userId: string, key: CriterionKey, mode: Mode): Promise<ModeOutcome> {
  if (!hasServiceRole()) return { ok: false, error: 'Your settings can’t be saved right now.' };
  const view = await profilesFor(userId);
  const profile = view.readable ? view.active : null;
  if (!profile) return { ok: false, error: 'Your settings can’t be saved right now.' };
  const admin = createAdminClient();
  const current = await modesFor(admin, [profile.id]);
  if (!current.has(profile.id)) return { ok: false, error: 'Must-have switches aren’t available yet. Please try again later.' };
  const next: FilterModes = { ...current.get(profile.id), [key]: mode };
  const { error } = await admin.from('search_profiles').update({ filter_modes: next, updated_at: new Date().toISOString() }).eq('id', profile.id).eq('user_id', userId);
  if (error) {
    console.error('[tailoring] filter mode save failed:', error.message);
    return { ok: false, error: 'Could not save that. Please try again.' };
  }
  return { ok: true, profileId: profile.id };
}

/**
 * Today's list for the member's active profile, chosen again with what they
 * want now (selection.ts rechooseToday). `goals` / `savedAreas`: answers
 * saved in this same request, which a cached read could miss. Never charges.
 * Null when there is nothing to re-choose (no list yet today, not tailored).
 */
export async function rechooseForMember(input: { userId: string; email: string | null; goals?: MarketGoals | null; savedAreas?: readonly string[]; answered?: AnsweredMap; now?: Date }): Promise<TodaySelection | null> {
  if (!hasServiceRole()) return null;
  try {
    const now = input.now ?? new Date();
    const view = await profilesFor(input.userId);
    const active = view.readable ? view.active : null;
    if (!active) return null;
    const goals = input.goals !== undefined ? input.goals : active.goals;
    const savedAreas = [...(input.savedAreas ?? active.areas)];
    const [payer, visibility, tailoring] = await Promise.all([
      payerFor(input.userId),
      dealVisibilityFor(input.userId, isAdminEmail(input.email)),
      tailoringForMember(input.userId, active, goals, savedAreas, now, { answered: input.answered }),
    ]);
    if (!usesTailoring(tailoring)) return null;
    return await rechooseToday({ userId: input.userId, payerId: payer.payerId, goals, savedAreas, visibility, profileId: active.id, profileActive: true, tailoring }, now);
  } catch (err) {
    console.error('[tailoring] re-choose failed:', (err as Error)?.message ?? err);
    return null;
  }
}

/**
 * "N deals match you" for a tailored profile: the member's visible pool
 * (passes left out, the grid's own visibility rule) that meets every
 * must-have. Null when the profile is not tailored (the caller keeps the
 * grid's head count) or the pool cannot be read.
 */
export async function mustHaveCountFor(input: { userId: string; email: string | null; tailoring: TailoringProfile | null; now?: Date }): Promise<number | null> {
  if (!hasServiceRole() || !usesTailoring(input.tailoring)) return null;
  const visibility = await dealVisibilityFor(input.userId, isAdminEmail(input.email));
  // Batch 17: each deal type the profile is shown, judged on its own answers, summed (as Today counts).
  const p = input.tailoring;
  let total = 0;
  for (const t of typesShown({ goals: p.goals, about: p.about })) {
    const goals = p.goals ? goalsForType(p.goals, t) : null;
    const typed = { ...p, goals };
    const { rows } = await tailoredRows({ pool: (f, limit) => rankingPool({ ...f, types: [t] }, visibility, { userId: input.userId }, limit) }, typed, { ...DEFAULT_FILTERS, kind: goals?.sourcingKind ?? 'both' });
    total += mustMatchCount(rows, typed, input.now ?? new Date());
  }
  return total;
}

// ── Behaviour prompts (behaviour.ts) ──

const scopeOf = (profileId: string | null) => profileId ?? 'member';

/**
 * When each prompt was last shown and answered for this profile. Null when
 * the table cannot be read (Batch 14's schema not run): then no prompt is
 * shown at all, since how often it has been asked cannot be kept.
 */
export async function promptStatesFor(userId: string, profileId: string | null): Promise<PromptState[] | null> {
  if (!hasServiceRole()) return null;
  const { data, error } = await createAdminClient().from('tailoring_prompts').select('question, last_shown_at, answered_at, answer').eq('user_id', userId).eq('scope', scopeOf(profileId));
  if (error) {
    warn(`prompts unreadable (Batch 14 schema not run?): ${error.message}`);
    return null;
  }
  return ((data ?? []) as { question: string; last_shown_at: string | null; answered_at: string | null; answer: string | null }[])
    .filter((r) => isPromptQuestion(r.question))
    .map((r) => ({ question: r.question as PromptQuestion, lastShownAt: r.last_shown_at, answeredAt: r.answered_at, answer: r.answer === 'accepted' || r.answer === 'dismissed' ? r.answer : null }));
}

/** A prompt was put in front of the member: the first showing of the day starts its week. */
export async function markPromptShown(userId: string, profileId: string | null, question: PromptQuestion, shownAt: Date, alreadyShownToday: boolean): Promise<void> {
  if (!hasServiceRole() || alreadyShownToday) return;
  const { error } = await createAdminClient()
    .from('tailoring_prompts')
    .upsert({ user_id: userId, scope: scopeOf(profileId), question, last_shown_at: shownAt.toISOString(), updated_at: shownAt.toISOString() }, { onConflict: 'user_id,scope,question' });
  if (error) warn(`prompt shown not recorded: ${error.message}`);
}

export async function answerPrompt(userId: string, profileId: string | null, question: PromptQuestion, answer: 'accepted' | 'dismissed', at: Date = new Date()): Promise<void> {
  if (!hasServiceRole()) return;
  const { error } = await createAdminClient()
    .from('tailoring_prompts')
    .upsert({ user_id: userId, scope: scopeOf(profileId), question, answered_at: at.toISOString(), answer, updated_at: at.toISOString() }, { onConflict: 'user_id,scope,question' });
  if (error) warn(`prompt answer not recorded: ${error.message}`);
}

/**
 * The member's tailoring for the profile they are on, read fresh (an action
 * that is about to change it). The active profile's answers are the live
 * copies; a member with no profile row yet is read from those directly.
 */
export async function currentTailoring(userId: string, now: Date = new Date()): Promise<{ tailoring: TailoringProfile; profileId: string | null } | null> {
  if (!hasServiceRole()) return null;
  const view = await profilesFor(userId);
  const active = view.readable ? view.active : null;
  if (active) {
    const t = await tailoringForMember(userId, active, active.goals, active.areas, now);
    return t ? { tailoring: t, profileId: active.id } : null;
  }
  const admin = createAdminClient();
  const [goalsRes, areasRes] = await Promise.all([admin.from('profiles').select('market_goals').eq('id', userId).maybeSingle(), admin.from('saved_areas').select('postcode_area').eq('user_id', userId)]);
  const goals = parseMarketGoals((goalsRes.data as { market_goals?: unknown } | null)?.market_goals ?? null);
  const areas = ((areasRes.data ?? []) as { postcode_area: string }[]).map((r) => r.postcode_area.toUpperCase());
  const t = await tailoringForMember(userId, null, goals, areas, now);
  return t ? { tailoring: t, profileId: null } : null;
}
