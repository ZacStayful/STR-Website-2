/**
 * Row shapes for the deals marketplace tables (see supabase/schema.sql,
 * "Deals marketplace"). Pure types only.
 */
import type { SourcingKind } from '../listing/sourcing.ts';
import type { ListingSource } from '../listing/types.ts';

/** pending_verify: qualified on the feed, waiting for its first page fetch (photo + live status). */
export type DealStatus = 'pending_verify' | 'live' | 'retired';

export type RetiredReason =
  | 'sold'
  | 'under_offer'
  | 'let_agreed'
  | 'removed'
  | 'unqualified'
  | 'unsuitable'
  | 'stale_listed'
  | 'stale_unseen'
  | 'unverifiable'
  | 'admin';

/** Retirements the sweep may undo when the listing is back in the feed and qualifies again. */
export const REACTIVATABLE_REASONS: ReadonlySet<RetiredReason> = new Set<RetiredReason>(['unqualified', 'stale_listed', 'stale_unseen', 'unverifiable']);

export type ConfirmedVia = 'feed' | 'live';

export interface DealRow {
  canonical_url: string;
  id: string;
  source: ListingSource;
  kind: SourcingKind;
  postcode_area: string | null;
  outcode: string | null;
  town: string | null;
  bedrooms: number | null;
  price_amount: number | null;
  price_period: string | null;
  raw_type: string | null;
  tenure: string | null;
  photo: string | null;
  photos: string[] | null;
  band: string;
  screening: unknown;
  deal: unknown;
  suitability: string | null;
  motivation: unknown;
  annual_profit: number | null;
  uplift_pct: number | null;
  price_history: unknown;
  reduced_at: string | null;
  listed_date: string | null;
  status: DealStatus;
  retired_reason: RetiredReason | null;
  retired_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_checked_live_at: string | null;
  last_confirmed_at: string;
  last_confirmed_via: ConfirmedVia;
  next_check_due_at: string | null;
  check_requested_at: string | null;
  last_shown_at: string | null;
  check_failures: number;
  created_at: string;
  updated_at: string;
}

export type OpenStatus = 'pending' | 'open';
export type VerifiedVia = 'live' | 'recent_live' | 'recent_confirm' | 'pick' | 'admin';

export interface DealOpenRow {
  id: string;
  user_id: string;
  canonical_url: string;
  deal_id: string;
  status: OpenStatus;
  opened_at: string;
  charged_base_pence: number;
  transaction_id: number | null;
  verified_via: VerifiedVia | null;
  status_at_open: string | null;
  band_at_open: string | null;
  annual_profit_at_open: number | null;
  checked_listing_id: string | null;
  saved_at: string | null;
  fetched: boolean;
}
