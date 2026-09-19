import 'server-only';

import { randomBytes } from 'node:crypto';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { postcodeAreaOf } from '../listing/normalise';
import { evaluateLead, type LeadRules, type LeadVerdict } from './rules';
import { enqueueDelivery } from '../crm/deliver';
import type { AnalysisResult } from '../types';

/**
 * Writing down a lead. Every write is service-role: `leads` is RLS-on with a
 * select-own policy and nothing user-writable, and the prospect filling in
 * the form has no session at all.
 *
 * The analysis is stored HERE, on the lead, and never in `saved_searches` —
 * that table is the member's own analyser history and is pruned to the newest
 * 200 rows per member, so funnel leads saving into it would evict a
 * customer's own reports within weeks.
 */

export type LeadStatus = 'queued' | 'new' | 'pushed' | 'held' | 'exported';

export interface LeadContact {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** When the prospect ticked the customer's consent box. */
  consentAt: string | null;
}

export interface LeadProperty {
  address: string | null;
  postcode: string | null;
  bedrooms: number | null;
}

/** Same shape as the other public tokens here (picks, deal shares). */
export function mintReportToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Records a lead BEFORE anything is spent. Called first on every submission,
 * including when the customer is out of credit — capturing the enquiry is
 * free, and losing a real prospect because a balance ran dry is the one
 * outcome worth designing against.
 */
export async function captureLead(input: {
  userId: string;
  funnelId: string;
  contact: LeadContact;
  property: LeadProperty;
  status: LeadStatus;
}): Promise<string | null> {
  if (!hasServiceRole()) return null;
  const { data, error } = await createAdminClient()
    .from('leads')
    .insert({
      user_id: input.userId,
      funnel_id: input.funnelId,
      name: input.contact.name,
      email: input.contact.email,
      phone: input.contact.phone,
      consent_at: input.contact.consentAt,
      address: input.property.address,
      postcode: input.property.postcode,
      postcode_area: postcodeAreaOf(input.property.postcode),
      bedrooms: input.property.bedrooms,
      status: input.status,
      report_token: mintReportToken(),
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[leads] capture failed:', error?.message);
    return null;
  }
  return data.id as string;
}

/**
 * Attaches the finished report and the qualification verdict.
 *
 * `unqualifiedPolicy` decides where a lead that missed the filter goes:
 * 'hold' keeps it here for the customer to review, export or promote later;
 * 'crm_flagged' still sends it on, marked. Either way the prospect gets
 * their report — they did nothing wrong by not matching a filter they
 * cannot see.
 */
export async function completeLead(input: {
  leadId: string;
  result: AnalysisResult;
  rules: LeadRules;
  unqualifiedPolicy: 'crm_flagged' | 'hold';
}): Promise<LeadVerdict | null> {
  if (!hasServiceRole()) return null;
  const verdict = evaluateLead(input.result, input.rules);
  const status: LeadStatus = verdict.qualified ? 'new' : input.unqualifiedPolicy === 'hold' ? 'held' : 'new';

  const { error } = await createAdminClient()
    .from('leads')
    .update({
      result: input.result,
      qualified: verdict.qualified,
      qualification: verdict,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.leadId);
  if (error) {
    console.error('[leads] complete failed:', error.message);
    return null;
  }

  // Delivery is queued HERE rather than in each caller, so the funnel route
  // and the queue drain cannot drift apart on a customer's policy — and a
  // future third caller gets it for free.
  //
  // A held lead is deliberately not delivered. The customer chose to review
  // leads that missed their filter themselves; sending them on anyway would
  // make the setting a lie. They can still promote one by hand, and it is
  // readable, exportable and reportable here in the meantime.
  const deliver = verdict.qualified || input.unqualifiedPolicy === 'crm_flagged';
  if (deliver) {
    // Never allowed to fail the lead: the report is saved and the customer
    // can see it. A delivery that cannot be queued is a delivery problem.
    await enqueueDelivery({ leadId: input.leadId }).catch((err) => {
      console.error('[leads] could not queue CRM delivery:', err);
      return { queued: false };
    });
  }

  return verdict;
}

/** Marks a queued lead as failed-to-run so the drain cron can retry it. */
export async function releaseQueuedLead(leadId: string): Promise<void> {
  if (!hasServiceRole()) return;
  const { error } = await createAdminClient()
    .from('leads')
    .update({ status: 'queued', updated_at: new Date().toISOString() })
    .eq('id', leadId);
  if (error) console.error('[leads] release failed:', error.message);
}
