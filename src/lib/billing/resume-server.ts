import 'server-only';

/**
 * Batch 22, Part H: resuming after payment. A member short of credit for the
 * reports they ticked tops up; the intent (resume_intents) holds what they
 * ticked, the prices they saw and where to come back to. On return
 * everything is quoted again (resume-rules.ts decideResume): the reports
 * start only if every price still matches; otherwise the member confirms the
 * new total. Used once, within RESUME_INTENT_MS.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { payerFor } from '../team';
import { dealCardsByIds } from '../marketplace/queries';
import { dealVisibilityFor } from '../marketplace/tier';
import { cardViewsFor } from '../marketplace/card-state';
import { quoterFor } from '../credit/quote-server';
import { offerPricingFor } from '../analysis/offers-server';
import { RESUME_INTENT_MS } from '../intelligence/config';
import { decideResume, parseResumeItems, resumeReturnPath, type Requote, type ResumeDecision, type ResumeItem } from './resume-rules';

export async function createResumeIntent(userId: string, items: readonly ResumeItem[], returnPath: string, now: Date = new Date()): Promise<string | null> {
  if (!hasServiceRole() || items.length === 0) return null;
  const { data, error } = await createAdminClient()
    .from('resume_intents')
    .insert({ user_id: userId, kind: 'analyses', items: items.slice(0, 3), return_path: resumeReturnPath(returnPath), status: 'open', expires_at: new Date(now.getTime() + RESUME_INTENT_MS).toISOString() })
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[resume] intent not saved:', error.message);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

/** The member's own open intent's return path (the top-up route sends Checkout back there). */
export async function resumeReturnFor(userId: string, id: string): Promise<string | null> {
  if (!hasServiceRole() || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await createAdminClient().from('resume_intents').select('return_path, status').eq('id', id).eq('user_id', userId).maybeSingle();
  const r = data as { return_path?: string; status?: string } | null;
  return r && r.status === 'open' && r.return_path ? resumeReturnPath(r.return_path) : null;
}

/** Every ticked report priced again now, exactly as the cards price them (offers included). */
async function requote(userId: string, supabase: SupabaseClient, adminUser: boolean, items: readonly ResumeItem[]): Promise<Requote[]> {
  const ids = [...new Set(items.map((i) => i.dealId))];
  const visibility = await dealVisibilityFor(userId, adminUser);
  const cards = await dealCardsByIds(ids, visibility);
  const payer = await payerFor(userId);
  const [views, offers, quoter] = await Promise.all([cardViewsFor({ supabase: supabase as never, userId, adminUser, cards }), offerPricingFor(userId, adminUser), quoterFor(payer.payerId, adminUser)]);
  return items.map((it) => {
    const v = views.get(it.dealId);
    if (!v || v.analysed) return { dealId: it.dealId, withPmi: it.withPmi, basePence: 0, facePence: 0, affordable: false, available: false };
    const full = offers.pricing(it.dealId, false);
    const deep = offers.pricing(it.dealId, true);
    const base = it.withPmi ? Math.max(0, v.fullAnalysisBasePence - full.fullAnalysisPence + deep.fullAnalysisPence + deep.pmiAddonPence) : v.fullAnalysisBasePence;
    const label = quoter.label(base);
    return { dealId: it.dealId, withPmi: it.withPmi, basePence: label.basePence, facePence: label.facePence, affordable: label.state !== 'short', available: true };
  });
}

/** What to do with an intent now; a 'start' marks it used. */
export async function resumeDecisionFor(userId: string, supabase: SupabaseClient, adminUser: boolean, id: string, now: Date = new Date()): Promise<ResumeDecision> {
  if (!hasServiceRole() || !/^[0-9a-f-]{36}$/i.test(id)) return { kind: 'expired' };
  const admin = createAdminClient();
  const { data } = await admin.from('resume_intents').select('items, status, expires_at').eq('id', id).eq('user_id', userId).maybeSingle();
  const row = data as { items?: unknown; status?: string; expires_at?: string } | null;
  if (!row) return { kind: 'expired' };
  const items = parseResumeItems(row.items);
  const decision = decideResume({ status: row.status ?? 'expired', expiresAt: row.expires_at ?? '', now, items, requotes: await requote(userId, supabase, adminUser, items) });
  if (decision.kind === 'start' || decision.kind === 'confirm' || decision.kind === 'nothing' || decision.kind === 'expired') {
    // Used once: a confirm is the member's to make on the page, never re-offered by a reload.
    await admin.from('resume_intents').update({ status: decision.kind === 'expired' ? 'expired' : 'done' }).eq('id', id).eq('status', 'open');
  }
  return decision;
}
