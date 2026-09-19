import { requireScope, isResponse, apiJson, apiError } from '@/lib/api/auth';
import { getAreaCards } from '@/lib/market/cached';
import { saturationBand } from '@/lib/market/competition';

export const dynamic = 'force-dynamic';

/**
 * A market snapshot for one postcode area.
 *
 * Reads the same cached explorer data the Market Explorer page does, so an
 * agent and the UI can never quote different numbers for the same area —
 * which is the whole reason this does not build its own query.
 *
 * Free: it spends nothing and runs no provider call. The `markets:read`
 * scope exists so a key can be minted that reads market data and nothing
 * about the customer's own leads.
 */
export async function GET(request: Request, { params }: { params: Promise<{ area: string }> }) {
  const auth = await requireScope(request, 'markets:read');
  if (isResponse(auth)) return auth;

  const { area } = await params;
  const code = area.trim().toUpperCase();
  if (!/^[A-Z]{1,2}$/.test(code)) {
    return apiError('invalid_request', 'Give a UK postcode area — the letters only, like YO or SW.');
  }

  const cards = await getAreaCards();
  const card = cards.find((c) => c.code === code);
  if (!card) {
    return apiError('not_found', `No market data for ${code} yet. Coverage grows as reports are run.`);
  }

  // The saturation band is surfaced alongside the competition band on
  // purpose: the band is what a customer's lead rules are written against,
  // and an agent asked "is this market worth entering" needs the same
  // vocabulary the rules use.
  const reviews = card.competition?.reviews ?? null;
  const saturation = saturationBand(reviews);

  return apiJson({
    area: { code: card.code, name: card.name, slug: card.slug, region: card.region?.name ?? null },
    headline: card.headline,
    byBedrooms: card.byBedrooms,
    yieldOnCost: card.yieldOnCost,
    confidence: card.confidence,
    competition: card.competition,
    saturation: saturation
      ? { level: saturation.level, averageReviews: reviews, headline: saturation.headline, meaning: saturation.meaning }
      : null,
    seasonality: card.seasonality,
    listingDensity: card.listingDensity,
    listingAge: card.listingAge,
    verdict: card.verdict,
    licensing: card.licensing,
  });
}
