/**
 * What a public funnel page hands the analyser so the same component can
 * serve a prospect under someone else's branding.
 *
 * Pure and plain-serialisable on purpose: the funnel page is a server
 * component and the analyser is a client component, so everything crossing
 * that boundary has to survive serialisation — no functions, no classes.
 */

import { parseEmail, type FunnelBrand } from './brand.ts';

export interface FunnelMode {
  /** The public token, used to address the funnel's own analyse route. */
  token: string;
  brand: FunnelBrand;
  /** Chosen by the customer on the funnel, never by the prospect. */
  reportDepth: 'standard' | 'enhanced';
  /**
   * Renders the branded page against demo data and spends nothing, so a
   * customer can check their own branding without paying for a lead.
   */
  preview?: boolean;
  /**
   * Set when this is one lead's finished report (the prospect's /r page, or
   * the customer's own lead page). The report's Download PDF then goes
   * through the lead's own token rather than the funnel's, so it keeps
   * working after the funnel is paused or deleted — the funnel token only
   * authorises a live funnel.
   */
  reportToken?: string;
}

/** Where the report's Download PDF posts to. */
export function reportPdfUrl(funnel: FunnelMode | undefined): string {
  if (!funnel) return '/api/generate-pdf';
  if (funnel.reportToken) return `/api/generate-pdf?r=${encodeURIComponent(funnel.reportToken)}`;
  return `/api/generate-pdf?f=${encodeURIComponent(funnel.token)}`;
}

/** Where a funnel's submissions go. */
export function funnelAnalyseUrl(token: string): string {
  return `/api/f/${encodeURIComponent(token)}/analyse`;
}

/** The name to show, falling back to something neutral rather than to ours. */
export function funnelLabel(funnel: FunnelMode): string {
  return funnel.brand.companyName ?? 'Property income analysis';
}

export type PreviewMode = 'none' | 'form' | 'report';

/**
 * Which preview a `?preview=` value asks for.
 *
 * `1` is the branded FORM — what a prospect meets first, and where the logo,
 * colours and consent wording live. `report` is the finished report against
 * demo data. Anything else is not a preview at all, and that default matters:
 * a preview renders a PAUSED funnel for its owner, so a value this function
 * does not recognise must never be treated as a request for one.
 *
 * Takes `string[]` because `?preview=1&preview=1` reaches a page as an array.
 */
export function previewMode(raw: string | string[] | undefined): PreviewMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === 'report') return 'report';
  if (v === '1') return 'form';
  return 'none';
}

/**
 * Details a customer already holds, passed into their own funnel link so the
 * prospect does not re-type them: `?name=&email=&phone=`.
 *
 * The settings page has documented this since the feature shipped and nothing
 * ever read it, so anyone who wired their website's enquiry form to pass these
 * got a blank form and a prospect keying in what they had just given.
 *
 * Everything is treated as hostile, because anyone can craft the URL: values
 * are trimmed, length-capped, and the email has to survive the same parse the
 * branding fields use. An unusable value is simply dropped — the prospect
 * types that one field themselves, which is better than a form carrying
 * something they did not write.
 *
 * Consent is absent on purpose and must stay absent. It is the prospect's to
 * give, the customer is the data controller, and a URL parameter must never be
 * able to assert that a box was ticked.
 */
export interface FunnelPrefill {
  name?: string;
  email?: string;
  phone?: string;
}

const PREFILL_MAX = 120;

function prefillText(raw: string | string[] | undefined): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return undefined;
  // Newlines would let one parameter pose as several lines of a form.
  const t = v.replace(/[\r\n\t]/g, ' ').trim().slice(0, PREFILL_MAX);
  return t.length > 0 ? t : undefined;
}

export function parseFunnelPrefill(query: {
  name?: string | string[];
  email?: string | string[];
  phone?: string | string[];
}): FunnelPrefill {
  const prefill: FunnelPrefill = {};
  const name = prefillText(query.name);
  if (name) prefill.name = name;
  const email = parseEmail(prefillText(query.email));
  if (email) prefill.email = email;
  const phone = prefillText(query.phone);
  // Digits and the handful of separators a written phone number uses. Anything
  // else is not a phone number, and a free-text field is not worth the risk.
  if (phone && /^[+()\d][\d\s()+.-]*$/.test(phone)) prefill.phone = phone;
  return prefill;
}
