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
