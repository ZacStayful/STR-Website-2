import 'server-only';

/**
 * Batch 17's reads of marketplace_deals columns that are deliberately NOT in
 * DEAL_COLUMNS or CARD_COLUMNS (stream, needs_work, project): each a separate
 * select, so the site keeps working on a database the Batch 16 and 17
 * sections have not reached yet. A read that fails for a missing column is
 * simply "none"; any other failure is logged and also "none" (a Project deal
 * then shows as an ordinary one for that read, never an error page).
 */
import type { createAdminClient } from '../supabase/admin';
import type { DealStatus } from '../marketplace/types';
import { parseProjectCard, type ProjectCardData } from './headline';
import { parseNeedsWork, type NeedsWork } from './needs-work';
import { parseStoredEstimate, type ProjectEstimate } from './estimate';

type Admin = ReturnType<typeof createAdminClient>;

const URL_CHUNK = 150;

/** PostgREST's answer for a column the table does not have (the section not run yet). */
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message ?? '');
}

/** The rows with these statuses held in the Project stream, by canonical URL. */
export async function projectStreamUrls(admin: Admin, statuses: readonly DealStatus[] = ['pending_check']): Promise<Set<string>> {
  const { data, error } = await admin.from('marketplace_deals').select('canonical_url').in('status', [...statuses]).eq('stream', 'project').limit(5000);
  if (error) {
    if (!isMissingColumn(error)) console.warn('[project] stream read failed:', error.message);
    return new Set();
  }
  return new Set(((data ?? []) as { canonical_url: string }[]).map((r) => r.canonical_url));
}

/** Whether one deal waiting on the shortlist is held for its Project check (the sheet's message). */
export async function isHeldForProject(admin: Admin, dealId: string): Promise<boolean> {
  const { data, error } = await admin.from('marketplace_deals').select('stream').eq('id', dealId).eq('status', 'pending_check').maybeSingle();
  if (error) {
    if (!isMissingColumn(error)) console.warn('[project] stream read failed:', error.message);
    return false;
  }
  return (data as { stream?: unknown } | null)?.stream === 'project';
}

export interface ProjectColumns {
  needsWork: NeedsWork | null;
  project: ProjectCardData | null;
}

/** needs_work and project for these rows, by canonical URL; an empty map when the columns are missing. */
export async function projectColumnsFor(admin: Admin, urls: readonly string[]): Promise<Map<string, ProjectColumns>> {
  const out = new Map<string, ProjectColumns>();
  for (let i = 0; i < urls.length; i += URL_CHUNK) {
    const some = urls.slice(i, i + URL_CHUNK);
    const { data, error } = await admin.from('marketplace_deals').select('canonical_url, needs_work, project').in('canonical_url', some);
    if (error) {
      if (!isMissingColumn(error)) console.warn('[project] project columns read failed:', error.message);
      return out;
    }
    for (const r of (data ?? []) as { canonical_url: string; needs_work: unknown; project: unknown }[]) out.set(r.canonical_url, { needsWork: parseNeedsWork(r.needs_work), project: parseProjectCard(r.project) });
  }
  return out;
}

/**
 * Of these listings, the ones the Project check let go into the ordinary
 * flow: an auction lot (Q10), or released because its page no longer says it
 * needs work or its photos say it is ready to go. Their wording no longer
 * keeps them out of the picks, and they are never held again by the
 * live-deal backfill. Empty when unreadable (the table not there yet).
 */
export async function projectClearedUrls(admin: Admin, urls: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < urls.length; i += URL_CHUNK) {
    const { data, error } = await admin.from('project_prep').select('canonical_url').in('canonical_url', urls.slice(i, i + URL_CHUNK)).in('outcome', ['released', 'auction']);
    if (error) {
      if (!/does not exist|could not find/i.test(error.message ?? '')) console.warn('[project] prep outcomes unreadable:', error.message);
      return out;
    }
    for (const r of (data ?? []) as { canonical_url: string }[]) out.add(r.canonical_url);
  }
  return out;
}

export interface StoredEstimate {
  estimate: ProjectEstimate;
  /** The photos and floorplan the check looked at, in order: the working's photo numbers refer to these. */
  photos: string[];
  price: number;
  estimatedAt: string;
}

/**
 * A Project deal's full estimate, with its reasons and photo numbers. Only
 * for a viewer who has opened the deal: the caller decides (the deal sheet
 * reads it under `priv`, never before).
 */
export async function projectEstimateFor(admin: Admin, dealId: string): Promise<StoredEstimate | null> {
  const { data, error } = await admin.from('project_estimates').select('estimate, photos, price, estimated_at').eq('deal_id', dealId).maybeSingle();
  if (error) {
    if (!/does not exist|could not find/i.test(error.message ?? '')) console.warn('[project] estimate read failed:', error.message);
    return null;
  }
  if (!data) return null;
  const row = data as { estimate: unknown; photos: unknown; price: unknown; estimated_at: string };
  const estimate = parseStoredEstimate(row.estimate);
  if (!estimate) return null;
  const photos = Array.isArray(row.photos) ? row.photos.filter((p): p is string => typeof p === 'string' && /^https:\/\//i.test(p)) : [];
  const price = Number(row.price);
  return { estimate, photos, price: Number.isFinite(price) ? price : estimate.finance.price, estimatedAt: row.estimated_at };
}
