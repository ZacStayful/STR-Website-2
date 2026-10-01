import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getFunnel } from '../funnels';
import { renderReportPdf, pdfBrandForFunnel } from '../pdf/render';
import { buildLeadPayload } from './payload.ts';
import { providerFor } from './providers/index.ts';
import { activeConnectionFor, resolveConnection, recordConnectionResult } from './connections';
import { nextAttemptAt } from './backoff.ts';
import type { CrmResult, LeadPayload } from './types.ts';
import type { AnalysisResult } from '../types';
import type { LeadVerdict } from '../leads/rules';

/**
 * Getting a lead into the customer's CRM.
 *
 * A push is never made inline with the prospect's request. Their CRM being
 * slow or down must not leave a stranger staring at a spinner, and it must
 * never cost the customer the lead — so the delivery is written to a queue
 * and a cron drains it with backoff. The lead is already safely on our side
 * by then; this is only the copy.
 *
 * Retries are bounded and the backoff is exponential, but the real decision
 * is `retryable` on the provider's result: a 500 is worth another go, a
 * revoked token or a deleted board will fail identically for ever and
 * retrying only buries the error the customer needs to read.
 */

/**
 * Queues a delivery. Called after a lead's report completes, and after a
 * customer promotes a held lead by hand.
 *
 * Returns null when the customer has no CRM connected, which is not an
 * error: plenty of customers will read their leads in Stayful and never
 * connect anything.
 */
export async function enqueueDelivery(input: {
  leadId: string;
  /** Skip the queue and try immediately; used by "send now" in the UI. */
  immediate?: boolean;
}): Promise<{ queued: boolean; delivered?: CrmResult }> {
  if (!hasServiceRole()) return { queued: false };

  const admin = createAdminClient();

  // The owner is read off the lead rather than passed in. A caller handing
  // over the wrong user id would deliver one customer's prospect into
  // another customer's CRM, and there is no way to take that back.
  const { data: lead } = await admin.from('leads').select('user_id').eq('id', input.leadId).maybeSingle();
  if (!lead) return { queued: false };

  const connection = await activeConnectionFor((lead as { user_id: string }).user_id);
  if (!connection) return { queued: false };

  const { data, error } = await admin
    .from('crm_deliveries')
    .insert({
      lead_id: input.leadId,
      connection_id: connection.id,
      status: 'pending',
      next_attempt_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[crm] enqueue failed:', error?.message);
    return { queued: false };
  }

  if (input.immediate) {
    const result = await runDelivery(data.id as string);
    return { queued: true, delivered: result ?? undefined };
  }
  return { queued: true };
}

interface DeliveryRow {
  id: string;
  lead_id: string;
  connection_id: string;
  attempts: number;
}

/**
 * Batch 21 (D12): how long a claimed delivery is held before it may be
 * claimed again. A push that dies mid-way (a function killed at its limit)
 * frees the row when this runs out; `finish()` sets the real next attempt.
 */
const LEASE_MS = 5 * 60 * 1000;

interface LeadRow {
  id: string;
  user_id: string;
  funnel_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  consent_at: string | null;
  address: string | null;
  postcode: string | null;
  bedrooms: number | null;
  result: AnalysisResult | null;
  qualification: LeadVerdict | null;
  report_token: string | null;
  created_at: string;
}

/**
 * The origin report links are built against. A link into the wrong host is
 * worse than no link, so an unset variable produces no link rather than a
 * guess — see `buildLeadPayload`.
 */
function baseUrl(): string | null {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
  );
}

/**
 * Runs one queued delivery, recording whatever happened.
 *
 * Batch 21 (D12): the row is claimed first. The every-ten-minutes cron and a
 * "send now" (or two crons that overlap) used to both pick up the same
 * pending row and push the same lead to the customer's CRM twice; now only
 * the caller whose claim lands runs it, and the other gets null.
 */
export async function runDelivery(deliveryId: string): Promise<CrmResult | null> {
  if (!hasServiceRole()) return null;
  const admin = createAdminClient();

  const now = new Date();
  const { data: claimed, error: claimError } = await admin
    .from('crm_deliveries')
    .update({ next_attempt_at: new Date(now.getTime() + LEASE_MS).toISOString(), updated_at: now.toISOString() })
    .eq('id', deliveryId)
    .eq('status', 'pending')
    .lte('next_attempt_at', now.toISOString())
    .select('id, lead_id, connection_id, attempts')
    .maybeSingle();
  if (claimError) {
    console.error('[crm] claim failed:', claimError.message);
    return null;
  }
  if (!claimed) return null;
  const row = claimed as DeliveryRow;

  const { data: leadData } = await admin
    .from('leads')
    .select('id, user_id, funnel_id, name, email, phone, consent_at, address, postcode, bedrooms, result, qualification, report_token, created_at, archived_at')
    .eq('id', row.lead_id)
    .maybeSingle();
  if (!leadData) {
    // The lead was erased — a GDPR deletion, most likely. Nothing to send,
    // and the delivery must not keep retrying against a row that is gone.
    await finish(row, { ok: false, error: 'The lead no longer exists.', retryable: false });
    return null;
  }
  if ((leadData as { archived_at: string | null }).archived_at) {
    // The customer binned it (or it went unused) while a retry was pending.
    // Sending it now would put a lead they chose to drop into their CRM.
    await finish(row, { ok: false, error: 'The lead was archived before it could be sent.', retryable: false });
    return null;
  }
  const lead = leadData as LeadRow;

  const conn = await resolveConnection(row.connection_id, lead.user_id);
  if (!conn) {
    await finish(row, { ok: false, error: 'That CRM connection was removed.', retryable: false });
    return null;
  }
  const provider = providerFor(conn.provider);
  if (!provider) {
    await finish(row, { ok: false, error: 'That provider is no longer supported.', retryable: false });
    return null;
  }

  const funnel = lead.funnel_id ? await getFunnel(lead.user_id, lead.funnel_id) : null;
  const payload = buildLeadPayload({
    leadId: lead.id,
    createdAt: lead.created_at,
    funnel: { id: lead.funnel_id, name: funnel?.name ?? null },
    contact: { name: lead.name, email: lead.email, phone: lead.phone, consentAt: lead.consent_at },
    property: { address: lead.address, postcode: lead.postcode, bedrooms: lead.bedrooms },
    result: lead.result,
    verdict: lead.qualification,
    reportToken: lead.report_token,
    baseUrl: baseUrl(),
  });

  const pdf = await pdfFor(provider.id, lead, funnel);
  const result = await provider.pushLead(conn, payload, pdf);

  await finish(row, result);
  await recordConnectionResult(conn.id, result);
  if (result.ok) await markLeadPushed(lead.id, result.externalId ?? null);
  return result;
}

/**
 * Renders the report PDF, but only when the provider will actually use it.
 * A webhook carries a link rather than an attachment, and rendering a PDF
 * nobody reads would spend a second of function time on every delivery.
 */
async function pdfFor(
  providerId: string,
  lead: LeadRow,
  funnel: Awaited<ReturnType<typeof getFunnel>>,
): Promise<Uint8Array | null> {
  if (providerId !== 'monday' || !lead.result) return null;
  try {
    const brand = funnel ? await pdfBrandForFunnel(funnel.brand) : undefined;
    return await renderReportPdf(lead.result, { brand, preparedFor: lead.email ?? undefined });
  } catch (err) {
    // A failed render must not cost the customer the lead itself: the item
    // still goes, without its attachment.
    console.error('[crm] PDF render failed for lead', lead.id, err);
    return null;
  }
}

async function markLeadPushed(leadId: string, externalId: string | null): Promise<void> {
  await createAdminClient()
    .from('leads')
    .update({
      status: 'pushed',
      crm_item_id: externalId,
      crm_pushed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Landing in the CRM is the lead being used (leads/activity.ts).
      last_activity_at: new Date().toISOString(),
      archive_warned_at: null,
    })
    .eq('id', leadId);
}

/** Writes the outcome, scheduling the next attempt or closing the delivery. */
async function finish(row: DeliveryRow, result: CrmResult): Promise<void> {
  const attempts = row.attempts + 1;
  const admin = createAdminClient();

  if (result.ok) {
    await admin
      .from('crm_deliveries')
      .update({
        status: 'sent',
        attempts,
        // A warning survives a success — this is where "the lead landed but
        // the PDF did not attach" is recorded.
        last_error: result.error ? result.error.slice(0, 500) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    return;
  }

  const next = nextAttemptAt(attempts, result.retryable);
  await admin
    .from('crm_deliveries')
    .update({
      status: next === null ? 'failed' : 'pending',
      attempts,
      last_error: (result.error ?? 'Unknown error').slice(0, 500),
      // A failed delivery keeps its timestamp where it is rather than being
      // pushed into the future: it is out of the cron's query on status
      // alone, and a stale due-time would be confusing to read.
      next_attempt_at: next ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);
}

export interface DrainSummary {
  attempted: number;
  sent: number;
  failed: number;
  /** Batch 21 (D12): due rows left for the next run because the time budget ran out. */
  skipped: number;
  /** Batch 21 (C31): what a dry run would have attempted (ids only). */
  due?: DeliveryRow[];
}

/**
 * Drains what is due. Bounded per run because each Monday delivery renders
 * a PDF, and the cron has sixty seconds: Batch 21 (D12) stops starting new
 * rows once `budgetMs` has gone, and Batch 21 (C31) lists the due rows
 * without touching them when `dry` is set.
 */
export async function drainDeliveries(limit = 10, opts: { dry?: boolean; budgetMs?: number } = {}): Promise<DrainSummary> {
  const none: DrainSummary = { attempted: 0, sent: 0, failed: 0, skipped: 0 };
  if (!hasServiceRole()) return none;

  const started = Date.now();
  const { data, error } = await createAdminClient()
    .from('crm_deliveries')
    .select('id, lead_id, connection_id, attempts')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limit);
  if (error) {
    console.error('[crm] drain query failed:', error.message);
    return none;
  }
  const due = (data ?? []) as DeliveryRow[];
  if (opts.dry) return { ...none, due };

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const d of due) {
    if (Date.now() - started > (opts.budgetMs ?? 40_000)) {
      skipped += 1;
      continue;
    }
    // Sequential on purpose: a customer with a backlog would otherwise fire
    // ten PDF renders at once inside one function.
    const result = await runDelivery(d.id);
    if (result?.ok) sent += 1;
    else failed += 1;
  }
  return { attempted: due.length - skipped, sent, failed, skipped };
}

export type { LeadPayload };
