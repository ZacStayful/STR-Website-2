import 'server-only';

/**
 * Moving a deal between stages (Kept → Contacted → Viewing → Offer →
 * Secured, and Passed), for My deals and the deal page.
 *
 * Where the stage is stored:
 *   - a listing with a pipeline row: checked_listings.status
 *   - a marketplace deal nobody on the team has opened: Keep / Pass in
 *     deal_reactions, and nothing else. It can only be Kept or Passed, because
 *     contacting the agent needs the address, and an unopened deal must never
 *     get a pipeline row (the row's snapshot holds the address).
 *   - an opened deal with no row: Kept / Passed stay a reaction; any later
 *     stage creates the person's own row at that stage.
 *
 * Every stage change on a marketplace deal also sets the person's Keep / Pass
 * to match (Passed = pass, anything else = keep), so the Kept and Passed
 * filters on /deals agree with My deals. That pass carries no reasons, so it
 * hides the deal from the grid and the picks without training them.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { payerFor } from '../team';
import { getBillingSettings } from '../credit/unit-costs';
import { loadDealById, loadDealsByUrls } from '../marketplace/server';
import { openPricePence } from '../marketplace/ladder';
import { setDealReaction } from '../marketplace/reactions-server';
import { dealVisibilityFor } from '../marketplace/tier';
import { dealVisible } from '../marketplace/visibility';
import { saveOpenedDealToPipeline } from '../marketplace/open';
import { stageNeedsOpen, type PipelineStatus } from './pipeline';

type Admin = ReturnType<typeof createAdminClient>;

export type StageOutcome =
  | { ok: true; stage: PipelineStatus; checkedListingId: string | null }
  | { ok: false; code: 'missing' | 'gone' | 'failed' }
  /** The stage needs the deal opened first; `openPence` is what opening costs this member. */
  | { ok: false; code: 'needs_open'; openPence: number };

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Writes the person's Keep / Pass directly. Only for a deal they may see the
 * whole of (their team opened it) or already have a reaction on: that is what
 * lets a kept deal that has since gone still be moved to Passed, which the
 * card's own setter refuses for a deal no longer live.
 */
async function writeReaction(admin: Admin, userId: string, dealId: string, stage: PipelineStatus): Promise<boolean> {
  const target = stage === 'passed' ? 'pass' : 'keep';
  const row: Record<string, unknown> = { user_id: userId, deal_id: dealId, reaction: target, updated_at: new Date().toISOString() };
  // A keep never carries pass reasons (they would go on training the picks).
  if (target === 'keep') row.reasons = [];
  const { error } = await admin.from('deal_reactions').upsert(row, { onConflict: 'user_id,deal_id' });
  if (error) console.warn('[stage] reaction write failed:', error.message);
  return !error;
}

async function hasReaction(admin: Admin, userId: string, dealId: string): Promise<boolean> {
  const { data } = await admin.from('deal_reactions').select('deal_id').eq('user_id', userId).eq('deal_id', dealId).maybeSingle();
  return Boolean(data);
}

async function setRowStage(admin: Admin, userId: string, id: string, stage: PipelineStatus): Promise<{ id: string; canonical_url: string } | null> {
  const { data, error } = await admin.from('checked_listings').update({ status: stage, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId).select('id, canonical_url');
  if (error) {
    console.error('[stage] row update failed:', error.message);
    return null;
  }
  return ((data ?? []) as { id: string; canonical_url: string }[])[0] ?? null;
}

/**
 * After an open with a stage asked for (the "Open this deal to contact the
 * agent" button): the person's own row at that stage, and their Keep to match.
 * Never throws.
 */
export async function applyStageAfterOpen(input: { userId: string; adminUser: boolean; dealId: string; payerId: string; stage: PipelineStatus }): Promise<boolean> {
  try {
    if (!hasServiceRole()) return false;
    const admin = createAdminClient();
    if (stageNeedsOpen(input.stage)) {
      const saved = await saveOpenedDealToPipeline(input.userId, input.dealId, input.adminUser, input.payerId, input.stage);
      if (!saved.ok) return false;
    } else {
      // Kept or Passed on an opened deal with no row stay a reaction; a row, if any, moves too.
      const deal = await loadDealById(admin, input.dealId);
      if (!deal) return false;
      const { data: own } = await admin.from('checked_listings').select('id').eq('user_id', input.userId).eq('canonical_url', deal.canonical_url).maybeSingle();
      if (own && !(await setRowStage(admin, input.userId, String(own.id), input.stage))) return false;
    }
    return await writeReaction(admin, input.userId, input.dealId, input.stage);
  } catch (err) {
    console.error('[stage] after open failed:', err);
    return false;
  }
}

/**
 * Sets the stage of one item on My deals, for the signed-in person. `key` is
 * the item's key: `l-<checkedListingId>` or `d-<dealId>`. Only ever touches
 * the person's own records: a teammate's row does not match.
 */
export async function setStageForMember(input: { userId: string; adminUser: boolean; key: string; stage: PipelineStatus }): Promise<StageOutcome> {
  if (!hasServiceRole()) return { ok: false, code: 'failed' };
  const admin = createAdminClient();
  const { userId, stage } = input;
  const kind = input.key.slice(0, 2);
  const id = input.key.slice(2);
  if ((kind !== 'l-' && kind !== 'd-') || !UUID.test(id)) return { ok: false, code: 'missing' };

  if (kind === 'l-') {
    const row = await setRowStage(admin, userId, id, stage);
    if (!row) return { ok: false, code: 'missing' };
    // A row that is a marketplace deal keeps the person's Keep / Pass in step.
    const deal = (await loadDealsByUrls(admin, [row.canonical_url])).get(row.canonical_url);
    if (deal) await writeReaction(admin, userId, deal.id, stage);
    return { ok: true, stage, checkedListingId: row.id };
  }

  const deal = await loadDealById(admin, id);
  if (!deal) return { ok: false, code: 'missing' };
  // Their own row for this listing, however it got there, holds the stage.
  const { data: own } = await admin.from('checked_listings').select('id').eq('user_id', userId).eq('canonical_url', deal.canonical_url).maybeSingle();
  if (own) {
    const row = await setRowStage(admin, userId, String(own.id), stage);
    if (!row) return { ok: false, code: 'failed' };
    await writeReaction(admin, userId, deal.id, stage);
    return { ok: true, stage, checkedListingId: row.id };
  }

  // Opens are the team's: the owner's account holds them.
  const payer = await payerFor(userId);
  const { data: open } = await admin.from('deal_opens').select('id').eq('user_id', payer.payerId).eq('canonical_url', deal.canonical_url).eq('status', 'open').maybeSingle();
  const opened = Boolean(open) || input.adminUser;

  if (!opened) {
    const reacted = await hasReaction(admin, userId, deal.id);
    // Inside its early-access window a deal does not exist for an account that
    // has never paid, by id or otherwise: not its price, not whether it is
    // live. A deal they already kept or passed is one they saw.
    const visibility = await dealVisibilityFor(userId, input.adminUser);
    if (!reacted && !dealVisible(deal.live_since, visibility.cutoffIso)) return { ok: false, code: 'missing' };
    if (stageNeedsOpen(stage)) {
      // Refused here, not just in the dropdown: past Kept needs the address.
      if (deal.status !== 'live') return { ok: false, code: 'gone' };
      const settings = await getBillingSettings();
      return { ok: false, code: 'needs_open', openPence: openPricePence(deal.annual_profit === null ? null : Number(deal.annual_profit), settings.dealOpenLadder) };
    }
    if (reacted) {
      return (await writeReaction(admin, userId, deal.id, stage)) ? { ok: true, stage, checkedListingId: null } : { ok: false, code: 'failed' };
    }
    // A first reaction goes through the card's own rules: live, and visible to this account.
    const res = await setDealReaction(userId, deal.id, stage === 'passed' ? 'pass' : 'keep', visibility);
    return res.ok ? { ok: true, stage, checkedListingId: null } : { ok: false, code: res.code };
  }

  if (stageNeedsOpen(stage)) {
    const saved = await saveOpenedDealToPipeline(userId, deal.id, input.adminUser, payer.payerId, stage);
    if (!saved.ok) return { ok: false, code: saved.code === 'missing' ? 'missing' : 'failed' };
    await writeReaction(admin, userId, deal.id, stage);
    return { ok: true, stage, checkedListingId: saved.checkedListingId };
  }
  return (await writeReaction(admin, userId, deal.id, stage)) ? { ok: true, stage, checkedListingId: null } : { ok: false, code: 'failed' };
}
