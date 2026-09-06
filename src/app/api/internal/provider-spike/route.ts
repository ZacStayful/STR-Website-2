import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminEmail } from '@/lib/admin';
import { findNearbyListings } from '@/lib/apis/airbtics';
import { pmiAccount, pmiConfigured, pmiListings, pmiStrEstimate, pmiStrMarket } from '@/lib/broker/providers/pmi';
import { resolveListing } from '@/lib/listing/server';
import { gridCell } from '@/lib/listing/competitors';
import { detectListingUrl } from '@/lib/listing/detect';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Admin-only provider spike. Runs where the keys live so no secret is ever
 * pasted anywhere. Measures, with a hard cost ceiling:
 *   - parsers against one live listing per fetchable site (free);
 *   - Airbtics coverage: how many comps from recent reports show up in a
 *     bounds search around the report's own point (≤ 10 calls, 5p each);
 *   - PMI: account/credits (free), one str/market call (3 credits), one
 *     listings call (1 credit), and — only with ?estimate=1 — one
 *     str-estimate (50 credits).
 * ?dry=1 lists what would run without calling anything paid.
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) return Response.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';
  const wantEstimate = url.searchParams.get('estimate') === '1';
  const maxReports = Math.min(10, Math.max(1, Number(url.searchParams.get('reports') ?? 6)));
  const outcode = (url.searchParams.get('outcode') ?? 'NG1').toUpperCase();
  const started = Date.now();
  const out: Record<string, unknown> = { ranAt: new Date().toISOString(), dry };

  // 1. Parsers against live pages.
  const urls = {
    rightmove: url.searchParams.get('rm') ?? 'https://www.rightmove.co.uk/properties/91877934',
    onthemarket: url.searchParams.get('otm') ?? 'https://www.onthemarket.com/details/19535441/',
    airbnb: url.searchParams.get('ab') ?? 'https://www.airbnb.co.uk/rooms/1115704756752582530',
  };
  if (dry) {
    out.parsers = urls;
  } else {
    const parsers: Record<string, unknown> = {};
    for (const [source, u] of Object.entries(urls)) {
      if (!detectListingUrl(u)) {
        parsers[source] = { ok: false, error: 'bad url' };
        continue;
      }
      const r = await resolveListing(u, { refresh: true });
      parsers[source] = r.ok
        ? { ok: true, postcode: r.snapshot.postcode ?? null, outcode: r.snapshot.outcode ?? null, beds: r.snapshot.bedrooms ?? null, price: r.snapshot.price ?? null, lat: r.snapshot.lat ?? null, location: r.snapshot.locationConfidence, warnings: r.warnings }
        : { ok: false, code: r.code, message: r.message };
    }
    out.parsers = parsers;
  }

  // 2. Airbtics coverage over recent reports.
  const coverage: Record<string, unknown> = { enabled: Boolean(process.env.AIRBTICS_API_KEY) };
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const { data } = await admin
      .from('analyser_reports')
      .select('postcode, lat, lng, raw_response, created_at')
      .eq('source', 'analyser')
      .not('raw_response', 'is', null)
      .order('created_at', { ascending: false })
      .limit(40);
    type Row = { postcode: string; lat: number | null; lng: number | null; raw_response: { coordinates?: { lat: number; lng: number }; shortLet?: { comparables?: { url: string }[] } } };
    const rows = ((data ?? []) as Row[])
      .map((r) => ({ postcode: r.postcode, lat: r.lat ?? r.raw_response?.coordinates?.lat ?? null, lng: r.lng ?? r.raw_response?.coordinates?.lng ?? null, comps: (r.raw_response?.shortLet?.comparables ?? []).map((c) => c.url.match(/\/rooms\/(\d+)/)?.[1]).filter((x): x is string => Boolean(x)) }))
      .filter((r) => r.lat !== null && r.lng !== null && r.comps.length > 0);
    const seenCells = new Set<string>();
    const sample = rows.filter((r) => {
      const cell = gridCell(r.lat!, r.lng!);
      if (seenCells.has(cell)) return false;
      seenCells.add(cell);
      return true;
    }).slice(0, maxReports);
    coverage.candidateReports = rows.length;
    coverage.sampled = sample.map((s) => ({ postcode: s.postcode, comps: s.comps.length }));
    if (!dry && process.env.AIRBTICS_API_KEY) {
      let matched = 0;
      let total = 0;
      let calls = 0;
      const perReport: unknown[] = [];
      for (const s of sample) {
        const list = await findNearbyListings(s.lat!, s.lng!, 1);
        calls++;
        if (!list) {
          perReport.push({ postcode: s.postcode, error: 'no result' });
          continue;
        }
        const ids = new Set(list.map((l) => l.listingId));
        const hit = s.comps.filter((c) => ids.has(c)).length;
        matched += hit;
        total += s.comps.length;
        perReport.push({ postcode: s.postcode, comps: s.comps.length, matched: hit, listingsInBox: list.length, earning: list.filter((l) => l.annualRevenue > 0).length });
      }
      coverage.calls = calls;
      coverage.costPence = calls * 5;
      coverage.matchRate = total ? Math.round((matched / total) * 100) : null;
      coverage.perReport = perReport;
    }
  }
  out.airbtics = coverage;

  // 3. PMI.
  const pmi: Record<string, unknown> = { enabled: pmiConfigured() };
  if (pmiConfigured() && !dry) {
    try {
      pmi.account = await pmiAccount();
      const market = await pmiStrMarket({ outcode }, { include: ['summary', 'supply', 'by_bedrooms', 'grade'] });
      pmi.strMarket = market ? { location: market.location, summary: market.summary, supply: market.supply, grade: market.grade, byBedrooms: market.by_bedrooms?.length ?? 0 } : null;
      const listings = await pmiListings({ outcode }, { type: 'sale', maxPrice: 250_000, minBedrooms: 2, perPage: 5 });
      pmi.listings = listings ? { total: listings.total_count ?? null, sample: (listings.listings ?? []).slice(0, 3) } : null;
      if (wantEstimate) {
        const est = await pmiStrEstimate({ postcode: url.searchParams.get('postcode') ?? 'NG1 1GH', bedrooms: 2, includeComparables: true });
        pmi.strEstimate = est ? { annual_revenue: est.annual_revenue, adr: est.average_daily_rate, occupancy: est.occupancy_rate, confidence: est.confidence, comps: (est.comparables ?? []).length, compUrls: (est.comparables ?? []).slice(0, 3).map((c) => c.listing_url) } : null;
      }
      pmi.creditsSpent = 3 + 1 + (wantEstimate ? 50 : 0);
    } catch (err) {
      pmi.error = String(err);
    }
  } else if (pmiConfigured()) {
    pmi.wouldSpendCredits = 3 + 1 + (wantEstimate ? 50 : 0);
  }
  out.pmi = pmi;
  out.ms = Date.now() - started;
  return Response.json(out);
}
