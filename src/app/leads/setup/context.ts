import 'server-only';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { ownerIdOrNull } from '@/lib/leads/scope';
import { listFunnels, notifyNewLeadOf, type Funnel } from '@/lib/funnels';
import { starterPackStateFor, type PackState } from '@/lib/starter-pack/server';
import { getBillingSettings } from '@/lib/credit/unit-costs';
import { getFunnelTierSettings } from '@/lib/funnels/tiers-server';
import type { FunnelTierSettings } from '@/lib/funnels/tiers';
import type { SetupFacts } from '@/lib/management/setup';

/**
 * Batch 22f: what every step of /leads/setup reads. The setup works on the
 * owner's newest funnel (an existing customer arriving from Account picks up
 * where their latest one is); a team member is sent to Leads, as from every
 * owner-only page.
 */
export interface SetupContext {
  userId: string;
  email: string | null;
  funnel: Funnel | null;
  notifyNewLead: boolean;
  pack: PackState;
  facts: SetupFacts;
  tiers: FunnelTierSettings;
  topupRate: number;
}

async function stepDone(userId: string, step: number): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { data, error } = await createAdminClient().from('activity_events').select('id').eq('user_id', userId).eq('dedupe_key', `funnel_setup_step:${step}`).limit(1);
  return !error && (data?.length ?? 0) > 0;
}

export async function setupContext(): Promise<SetupContext> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/leads/setup');
  const ownerId = await ownerIdOrNull(user);
  if (!ownerId) redirect('/leads');

  const [funnels, pack, tiers, settings, deliveryDone] = await Promise.all([
    listFunnels(user.id),
    starterPackStateFor(user.id),
    getFunnelTierSettings(),
    getBillingSettings(),
    stepDone(user.id, 3),
  ]);
  const funnel = funnels[0] ?? null;
  const notifyNewLead = funnel ? await notifyNewLeadOf(user.id, funnel.id) : true;
  const snoozed = Boolean(pack.snoozedUntil && Date.parse(pack.snoozedUntil) > Date.now());
  return {
    userId: user.id,
    email: user.email ?? null,
    funnel,
    notifyNewLead,
    pack,
    tiers,
    topupRate: settings.spendRates.topup,
    facts: {
      packOffered: pack.offer.eligible && !snoozed,
      hasFunnel: Boolean(funnel),
      detailsSaved: Boolean(funnel?.brand.replyToEmail),
      deliveryDone,
      live: Boolean(funnel?.active),
    },
  };
}
