/**
 * What a public funnel page hands the analyser so the same component can
 * serve a prospect under someone else's branding.
 *
 * Pure and plain-serialisable on purpose: the funnel page is a server
 * component and the analyser is a client component, so everything crossing
 * that boundary has to survive serialisation — no functions, no classes.
 */

import type { FunnelBrand } from './brand.ts';

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
