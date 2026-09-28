import 'server-only';

/**
 * Part F's reads and writes (the rules are in ./email-answers.ts). The send
 * is found by its own token; the deal must be one of its teasers; the answer
 * goes through the grid's own Keep and Pass for the send's member, at their
 * own access now, stamped with the profile the teaser was sent for.
 *
 * Nothing here returns an address, a postcode, a photo or a listing link:
 * the card is the grid's public columns (CARD_COLUMNS), as the teaser was.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { isAdminEmail } from '../admin';
import { isSendToken } from '../notify/cap';
import type { DealCard } from '../marketplace/grid';
import { dealCardsByIds } from '../marketplace/queries';
import { reactionsFor, setDealReaction, setPassReasons } from '../marketplace/reactions-server';
import { cleanPassReasons, type DealReaction } from '../marketplace/reactions';
import { dealVisibilityFor } from '../marketplace/tier';
import { parseMarketGoals, type MarketGoals } from '../market/goals';
import { activeProfileFor } from '../profiles/server';
import { logActivity } from '../activity/log';
import { isDealId, teaserInSend, type EmailAnswer } from './email-answers';

export interface TeaserAnswerContext {
  userId: string;
  /** The profile whose part of the email the deal was in; else the member's active one. */
  profileId: string | null;
  /** Null: the deal has left the market (or their access) since the email. */
  card: DealCard | null;
  /** Their answer on it now, from anywhere (the grid, Today, an earlier email). */
  reaction: DealReaction | null;
  /** For the card's figure at their own finance, as the teaser showed it. */
  goals: MarketGoals | null;
}

/** Null when the link answers nothing: not a send's token, the send not sent, or the deal not one of its teasers. */
export async function teaserAnswerContext(token: string, dealId: string): Promise<TeaserAnswerContext | null> {
  if (!isSendToken(token) || !isDealId(dealId) || !hasServiceRole()) return null;
  const admin = createAdminClient();
  const { data: send, error } = await admin.from('notification_sends').select('user_id, status, summary').eq('unsubscribe_token', token).maybeSingle();
  if (error) {
    console.error('[email-answers] send read failed:', error.message);
    return null;
  }
  const row = send as { user_id: string; status: string; summary: unknown } | null;
  if (!row || row.status !== 'sent') return null;
  const inSend = teaserInSend(row.summary, dealId);
  if (!inSend) return null;
  const { data: member } = await admin.from('profiles').select('email, market_goals').eq('id', row.user_id).maybeSingle();
  const m = member as { email: string | null; market_goals: unknown } | null;
  const visibility = await dealVisibilityFor(row.user_id, isAdminEmail(m?.email ?? null));
  const [cards, reactions, active] = await Promise.all([dealCardsByIds([dealId], visibility), reactionsFor(row.user_id, [dealId]), inSend.profileId ? Promise.resolve(null) : activeProfileFor(row.user_id)]);
  return { userId: row.user_id, profileId: inSend.profileId ?? active?.id ?? null, card: cards[0] ?? null, reaction: reactions.get(dealId) ?? null, goals: parseMarketGoals(m?.market_goals ?? null) };
}

export type AnswerOutcome = { ok: true } | { ok: false; code: 'invalid' | 'gone' | 'failed' };

/**
 * The confirmed answer. Yes is a Keep, No a Pass (with the reasons given),
 * exactly as on the grid, so it is free, idempotent and seen by everything
 * that reads Keeps and Passes. Logged as the email answer it is.
 */
export async function answerTeaser(token: string, dealId: string, answer: EmailAnswer, reasons: unknown): Promise<AnswerOutcome> {
  const ctx = await teaserAnswerContext(token, dealId);
  if (!ctx) return { ok: false, code: 'invalid' };
  const admin = createAdminClient();
  const { data: member } = await admin.from('profiles').select('email').eq('id', ctx.userId).maybeSingle();
  const visibility = await dealVisibilityFor(ctx.userId, isAdminEmail((member as { email: string | null } | null)?.email ?? null));
  const outcome = await setDealReaction(ctx.userId, dealId, answer === 'yes' ? 'keep' : 'pass', visibility, ctx.profileId);
  if (!outcome.ok) return { ok: false, code: outcome.code === 'failed' ? 'failed' : 'gone' };
  const given = answer === 'no' && Array.isArray(reasons) ? cleanPassReasons(reasons.slice(0, 20)) : [];
  if (given.length > 0) await setPassReasons(ctx.userId, dealId, given);
  logActivity(ctx.userId, 'email_feedback', { source: 'email_link', dealId, profileId: ctx.profileId, extras: { answer, via: 'form', part: 'teaser', ...(given.length > 0 ? { reasons: given } : {}) } });
  return { ok: true };
}
