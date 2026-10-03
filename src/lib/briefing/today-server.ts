import 'server-only';

/**
 * Batch 23b: the briefing card on Today, for members who did not come in
 * from the email. Shown when today's briefing exists and the member has no
 * email_click this UK day (and this visit is not itself from the email: the
 * click is recorded by the heartbeat after the page renders). Showing it is
 * free; Play reads it aloud through /api/speak at the speak price, shown on
 * the button.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getUnitCostTable } from '../credit/unit-costs';
import { priceFor } from '../credit/pricing';
import { formatPence } from '../credit/deal-pricing';
import { ukDay } from '../activity/week';
import { londonDayStart } from '../leads/search';
import { briefingFor, type StoredBriefing } from './store';
import { greetingLine } from './greeting';

export interface BriefingCardData {
  id: string;
  greeting: string;
  opener: string;
  /** What Play reads aloud: the greeting and the opener. */
  spoken: string;
  nudges: { text: string; nextStep: string; href: string }[];
  /** Open on the page (not dismissed). */
  open: boolean;
  /** The first time it is shown: stamp it. */
  firstShow: boolean;
  /** "Play · 31p": the speak price for this text. Null: no voice price row. */
  playLabel: string | null;
  feedback: 'useful' | 'not_for_me' | null;
}

function londonHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(now));
}

async function emailClickToday(userId: string, now: Date): Promise<boolean> {
  const start = londonDayStart(ukDay(now));
  if (!start) return false;
  const { data, error } = await createAdminClient().from('activity_events').select('id').eq('user_id', userId).eq('kind', 'email_click').gte('occurred_at', start.toISOString()).limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

export function cardFrom(b: StoredBriefing, fullName: string | null, userId: string, now: Date, speakBasePence: (chars: number) => number | null): BriefingCardData {
  const greeting = greetingLine(b.ukDay, userId, fullName, londonHour(now) < 12);
  const spoken = `${greeting} ${b.opener}`;
  const price = speakBasePence(spoken.length);
  return {
    id: b.id,
    greeting,
    opener: b.opener,
    spoken,
    nudges: b.nudges.map((n) => ({ text: n.text, nextStep: n.nextStep, href: n.path })),
    open: !b.dismissedAt,
    firstShow: !b.shownInAppAt,
    playLabel: price !== null ? `Play · ${formatPence(price)}` : null,
    feedback: b.feedback,
  };
}

export async function briefingCardFor(userId: string, fullName: string | null, now: Date, viaEmail: boolean): Promise<BriefingCardData | null> {
  if (viaEmail || !hasServiceRole()) return null;
  try {
    const [b, clicked, table] = await Promise.all([briefingFor(userId, ukDay(now)), emailClickToday(userId, now), getUnitCostTable()]);
    if (!b || clicked) return null;
    const speak = (chars: number) => (table.has('elevenlabs:character') ? priceFor(table, 'elevenlabs', 'character', chars).basePence : null);
    return cardFrom(b, fullName, userId, now, speak);
  } catch (err) {
    console.warn('[briefing] card not loaded:', (err as Error)?.message ?? err);
    return null;
  }
}
