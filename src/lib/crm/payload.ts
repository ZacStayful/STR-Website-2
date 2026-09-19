/**
 * Builds the JSON a customer's CRM receives.
 *
 * Pure on purpose. The webhook body is a published contract that someone
 * else's n8n or Zapier workflow is built against, so it has to be pinned by
 * tests rather than discovered in production — and a test cannot reach a
 * database. Everything it needs is passed in.
 *
 * Two rules run through the whole file:
 *
 *   Null means "we do not know", never zero. A property with £0 projected
 *   revenue is a failed short-let lookup, not a worthless property, and a
 *   workflow routing on `annualRevenue < 20000` must not treat the two the
 *   same.
 *
 *   Fields are added, never renamed or removed. `version` is there so a
 *   shape change that cannot be made additively is at least detectable.
 */

import { averageReviewCount } from '../listing/competitors.ts';
import { saturationLevelFor } from '../market/competition.ts';
import { postcodeAreaOf } from '../listing/normalise.ts';
import type { AnalysisResult } from '../types.ts';
import type { LeadVerdict } from '../leads/rules.ts';
import type { LeadPayload } from './types.ts';

export interface PayloadInput {
  leadId: string;
  createdAt: string;
  funnel: { id: string | null; name: string | null };
  contact: { name: string | null; email: string | null; phone: string | null; consentAt: string | null };
  property: { address: string | null; postcode: string | null; bedrooms: number | null };
  /** Absent for a lead captured before its report could be run. */
  result?: AnalysisResult | null;
  verdict?: LeadVerdict | null;
  /** Public token for the prospect's copy; absent means no report yet. */
  reportToken?: string | null;
  /** Origin to build report links against, e.g. https://stayful.co.uk. */
  baseUrl?: string | null;
}

/** A finite number above zero, or null. Zero here always means "not known". */
function positive(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function round(v: number | null, dp = 0): number | null {
  if (v === null) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function trimmedOrNull(v: string | null | undefined): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length > 0 ? t : null;
}

/** Strips a trailing slash so links do not come out with a double one. */
export function normaliseBaseUrl(raw: string | null | undefined): string | null {
  const t = trimmedOrNull(raw ?? null);
  if (t === null) return null;
  if (!/^https?:\/\//i.test(t)) return null;
  return t.replace(/\/+$/, '');
}

export function buildLeadPayload(input: PayloadInput): LeadPayload {
  const r = input.result ?? null;
  const comps = r?.shortLet?.comparables ?? [];
  const avgReviews = r ? averageReviewCount(comps) : null;
  const base = normaliseBaseUrl(input.baseUrl);
  const token = trimmedOrNull(input.reportToken ?? null);

  // A report link is only meaningful with both halves. Half a URL in a CRM
  // field is worse than an empty one: it looks clickable and is not.
  const reportUrl = base !== null && token !== null ? `${base}/r/${token}` : null;

  return {
    version: 1,
    event: 'lead.created',
    leadId: input.leadId,
    createdAt: input.createdAt,
    funnel: { id: input.funnel.id, name: trimmedOrNull(input.funnel.name) },
    contact: {
      name: trimmedOrNull(input.contact.name),
      email: trimmedOrNull(input.contact.email),
      phone: trimmedOrNull(input.contact.phone),
      consentAt: input.contact.consentAt,
    },
    property: {
      address: trimmedOrNull(input.property.address),
      postcode: trimmedOrNull(input.property.postcode),
      postcodeArea: postcodeAreaOf(input.property.postcode ?? undefined),
      bedrooms: typeof input.property.bedrooms === 'number' && Number.isFinite(input.property.bedrooms)
        ? input.property.bedrooms
        : null,
    },
    metrics: {
      annualRevenue: round(positive(r?.shortLet?.annualRevenue)),
      occupancy: round(positive(r?.shortLet?.occupancyRate), 2),
      averageNightlyRate: round(positive(r?.shortLet?.averageDailyRate)),
      averageReviewCount: avgReviews,
      saturation: avgReviews === null ? null : saturationLevelFor(avgReviews),
    },
    qualification: {
      qualified: input.verdict ? input.verdict.qualified : null,
      summary: input.verdict?.summary ?? '',
      unknownChecks: input.verdict?.unknownChecks ?? 0,
      checks: (input.verdict?.checks ?? []).map((c) => ({
        rule: c.rule,
        label: c.label,
        status: c.status,
        actual: c.actual,
        threshold: c.threshold,
        reason: c.reason,
      })),
    },
    report: {
      url: reportUrl,
      pdfUrl: reportUrl === null ? null : `${reportUrl}/pdf`,
    },
  };
}

/**
 * One line for a CRM item's title. Their board shows this before anything
 * else, so it leads with the person and falls back through what we have
 * rather than ever being empty — an untitled row is a row nobody opens.
 */
export function leadItemName(payload: LeadPayload): string {
  return (
    payload.contact.name ??
    payload.contact.email ??
    payload.property.address ??
    payload.property.postcode ??
    `Lead ${payload.leadId.slice(0, 8)}`
  );
}
