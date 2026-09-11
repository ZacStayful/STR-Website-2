import type { ListingSnapshot } from '@/lib/listing/types';
import type { AnalyserPrefill } from '@/lib/listing/normalise';
import type { QuickEstimate } from '@/lib/listing/quick-types';

/** Shape returned by POST /api/listing/resolve. */
export interface ResolvedListing {
  snapshot: ListingSnapshot;
  prefill: AnalyserPrefill;
  warnings: string[];
  quick: QuickEstimate;
  checkedListingId: string | null;
  fromCache: boolean;
}

/**
 * Reads a /api/listing/resolve response. The route always answers JSON, so
 * anything else is the platform in the way (a gateway timeout page, a
 * proxy error) and gets a message that says so instead of "could not
 * reach the server".
 */
export async function readResolvedListing(res: Response): Promise<{ ok: true; listing: ResolvedListing } | { ok: false; error: string }> {
  let data: Record<string, unknown> | null = null;
  try {
    const parsed = await res.json();
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
  } catch {
    data = null;
  }
  if (!data) {
    return {
      ok: false,
      error: res.status === 504 || res.status === 502 ? 'Stayful took too long reading that listing. Please try again in a moment.' : `Something went wrong on our side (HTTP ${res.status}). Please try again.`,
    };
  }
  if (!res.ok || data.error) return { ok: false, error: typeof data.error === 'string' ? data.error : 'Could not read that listing.' };
  return { ok: true, listing: data as unknown as ResolvedListing };
}

/** The message for a fetch that never got an answer at all. */
export const RESOLVE_NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';
