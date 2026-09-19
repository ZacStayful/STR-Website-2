import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { buildLeadPayload } from '../crm/payload.ts';
import { siteUrl } from '../url';
import type { AnalysisResult } from '../types';
import type { LeadVerdict } from '../leads/rules';

/**
 * Reading leads for the API.
 *
 * The API's lead shape is the SAME object the CRM webhook sends — built by
 * the one `buildLeadPayload`. An agent reading a lead over the API and a
 * workflow receiving one over the webhook must see identical field names, or
 * every integration has to learn two vocabularies for one thing.
 *
 * Reads go through the service role with an explicit `user_id` filter rather
 * than a member's RLS view, because an API key is not a session and there is
 * no `auth.uid()` to scope by. That makes the filter the entire boundary, so
 * it is applied in one place here and never left to a caller.
 */

export interface LeadQuery {
  funnelId: string | null;
  qualified: boolean | null;
  status: string | null;
  since: string | null;
  until: string | null;
  limit: number;
  offset: number;
}

const UUID = /^[0-9a-f-]{36}$/i;
const STATUSES = new Set(['queued', 'new', 'pushed', 'held', 'exported']);
const MAX_LIMIT = 200;

/**
 * Parses query parameters, refusing rather than guessing. An agent that
 * mistypes `qualified=yes` should be told, not quietly handed every lead —
 * a silent wrong filter is a wrong answer it will act on.
 */
export function parseLeadQuery(params: URLSearchParams): { value: LeadQuery; error?: string } {
  const base: LeadQuery = {
    funnelId: null, qualified: null, status: null, since: null, until: null, limit: 50, offset: 0,
  };

  const funnelId = params.get('funnelId');
  if (funnelId !== null) {
    if (!UUID.test(funnelId)) return { value: base, error: 'funnelId must be a UUID.' };
    base.funnelId = funnelId;
  }

  const qualified = params.get('qualified');
  if (qualified !== null) {
    if (qualified !== 'true' && qualified !== 'false') {
      return { value: base, error: 'qualified must be "true" or "false".' };
    }
    base.qualified = qualified === 'true';
  }

  const status = params.get('status');
  if (status !== null) {
    if (!STATUSES.has(status)) {
      return { value: base, error: `status must be one of ${[...STATUSES].join(', ')}.` };
    }
    base.status = status;
  }

  for (const key of ['since', 'until'] as const) {
    const raw = params.get(key);
    if (raw === null) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return { value: base, error: `${key} must be an ISO 8601 date.` };
    base[key] = d.toISOString();
  }

  const limit = params.get('limit');
  if (limit !== null) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
      return { value: base, error: `limit must be a whole number between 1 and ${MAX_LIMIT}.` };
    }
    base.limit = n;
  }

  const offset = params.get('offset');
  if (offset !== null) {
    const n = Number(offset);
    if (!Number.isInteger(n) || n < 0) return { value: base, error: 'offset must be zero or more.' };
    base.offset = n;
  }

  return { value: base };
}

export interface LeadRecord {
  id: string;
  status: string;
  crmItemId: string | null;
  crmPushedAt: string | null;
  lead: ReturnType<typeof buildLeadPayload>;
}

interface Row {
  id: string;
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
  status: string;
  crm_item_id: string | null;
  crm_pushed_at: string | null;
  created_at: string;
}

const COLUMNS =
  'id, funnel_id, name, email, phone, consent_at, address, postcode, bedrooms, result, qualification, report_token, status, crm_item_id, crm_pushed_at, created_at';

/**
 * The one place the ownership filter is applied, so no caller can forget it:
 * an API key is not a session, there is no `auth.uid()` to scope by, and
 * this `user_id` equality IS the boundary.
 *
 * The cast is deliberate. Supabase's builder type threads every chained call
 * back through itself, and a generic wrapper over it exceeds the compiler's
 * instantiation depth. The runtime shape is exactly these three methods, so
 * it is named rather than left as `any`.
 */
interface Filterable {
  eq(column: string, value: unknown): Filterable;
  gte(column: string, value: string): Filterable;
  lte(column: string, value: string): Filterable;
}

function applyFilters<T>(query: T, userId: string, q: LeadQuery): T {
  let out = (query as Filterable).eq('user_id', userId);
  if (q.funnelId !== null) out = out.eq('funnel_id', q.funnelId);
  if (q.qualified !== null) out = out.eq('qualified', q.qualified);
  if (q.status !== null) out = out.eq('status', q.status);
  if (q.since !== null) out = out.gte('created_at', q.since);
  if (q.until !== null) out = out.lte('created_at', q.until);
  return out as T;
}

function toRecord(row: Row, funnelNames: Map<string, string>): LeadRecord {
  return {
    id: row.id,
    status: row.status,
    crmItemId: row.crm_item_id,
    crmPushedAt: row.crm_pushed_at,
    lead: buildLeadPayload({
      leadId: row.id,
      createdAt: row.created_at,
      funnel: { id: row.funnel_id, name: row.funnel_id ? funnelNames.get(row.funnel_id) ?? null : null },
      contact: { name: row.name, email: row.email, phone: row.phone, consentAt: row.consent_at },
      property: { address: row.address, postcode: row.postcode, bedrooms: row.bedrooms },
      result: row.result,
      verdict: row.qualification,
      reportToken: row.report_token,
      baseUrl: siteUrl(),
    }),
  };
}

async function funnelNamesFor(userId: string): Promise<Map<string, string>> {
  const { data } = await createAdminClient().from('funnels').select('id, name').eq('user_id', userId);
  const out = new Map<string, string>();
  for (const f of (data ?? []) as Array<{ id: string; name: string | null }>) {
    if (f.name) out.set(f.id, f.name);
  }
  return out;
}

export async function listLeads(userId: string, q: LeadQuery): Promise<{ leads: LeadRecord[]; total: number; limit: number; offset: number }> {
  if (!hasServiceRole()) return { leads: [], total: 0, limit: q.limit, offset: q.offset };

  const admin = createAdminClient();
  const query = applyFilters(admin.from('leads').select(COLUMNS, { count: 'exact' }), userId, q)
    .order('created_at', { ascending: false })
    .range(q.offset, q.offset + q.limit - 1);

  const [{ data, count, error }, names] = await Promise.all([query, funnelNamesFor(userId)]);
  if (error) {
    console.error('[api] lead list failed:', error.message);
    return { leads: [], total: 0, limit: q.limit, offset: q.offset };
  }
  return {
    leads: ((data ?? []) as unknown as Row[]).map((r) => toRecord(r, names)),
    total: count ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}

export async function getLead(userId: string, leadId: string): Promise<LeadRecord | null> {
  if (!hasServiceRole()) return null;
  const { data } = await createAdminClient()
    .from('leads')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('id', leadId)
    .maybeSingle();
  if (!data) return null;
  return toRecord(data as unknown as Row, await funnelNamesFor(userId));
}

export interface LeadStats {
  total: number;
  qualified: number;
  unqualified: number;
  queued: number;
  held: number;
  pushed: number;
  /** Qualified as a share of the leads actually assessed. Null with none. */
  qualificationRate: number | null;
  byFunnel: Array<{ funnelId: string; name: string | null; total: number; qualified: number; unqualified: number }>;
}

/**
 * The counts behind "how many of my leads are worth having".
 *
 * Queued leads are excluded from the rate rather than counted as failures:
 * their report has not run, so they have not been judged, and folding them
 * into the denominator would make a customer's funnel look worse the more
 * often they ran out of credit.
 */
export async function leadStats(userId: string, q: LeadQuery): Promise<LeadStats> {
  const empty: LeadStats = { total: 0, qualified: 0, unqualified: 0, queued: 0, held: 0, pushed: 0, qualificationRate: null, byFunnel: [] };
  if (!hasServiceRole()) return empty;

  const { data, error } = await applyFilters(
    createAdminClient().from('leads').select('funnel_id, qualified, status'),
    userId,
    q,
  );
  if (error) {
    console.error('[api] lead stats failed:', error.message);
    return empty;
  }

  const rows = (data ?? []) as Array<{ funnel_id: string | null; qualified: boolean | null; status: string }>;
  const names = await funnelNamesFor(userId);
  const perFunnel = new Map<string, { total: number; qualified: number; unqualified: number }>();

  const stats = { ...empty, byFunnel: [] as LeadStats['byFunnel'] };
  for (const r of rows) {
    stats.total += 1;
    if (r.status === 'queued') stats.queued += 1;
    if (r.status === 'held') stats.held += 1;
    if (r.status === 'pushed') stats.pushed += 1;
    if (r.qualified === true) stats.qualified += 1;
    if (r.qualified === false) stats.unqualified += 1;

    const key = r.funnel_id ?? '';
    const bucket = perFunnel.get(key) ?? { total: 0, qualified: 0, unqualified: 0 };
    bucket.total += 1;
    if (r.qualified === true) bucket.qualified += 1;
    if (r.qualified === false) bucket.unqualified += 1;
    perFunnel.set(key, bucket);
  }

  const assessed = stats.qualified + stats.unqualified;
  stats.qualificationRate = assessed > 0 ? Math.round((stats.qualified / assessed) * 100) / 100 : null;
  stats.byFunnel = [...perFunnel.entries()]
    .filter(([id]) => id !== '')
    .map(([id, b]) => ({ funnelId: id, name: names.get(id) ?? null, ...b }))
    .sort((a, b) => b.total - a.total);

  return stats;
}
