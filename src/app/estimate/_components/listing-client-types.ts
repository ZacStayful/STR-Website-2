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
