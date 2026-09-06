'use client';

import { ExternalLink, Star } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { CompetitorsResult } from '@/lib/types';
import type { TrackedListing } from '@/lib/listing/competitors';
import { gbp, pct0, num0 } from './format';

/** Relative-position dot map: the subject at the centre, competitors around it. */
function DotMap({ centre, listings, highlightId }: { centre: { lat: number; lng: number }; listings: TrackedListing[]; highlightId?: string | null }) {
  const size = 180;
  const pts = listings.filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng) && l.lat !== 0);
  if (pts.length === 0) return null;
  const maxD = Math.max(0.3, ...pts.map((l) => Math.hypot((l.lat - centre.lat) * 111, (l.lng - centre.lng) * 65)));
  const scale = (size / 2 - 12) / maxD;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-44 w-44 shrink-0" role="img" aria-label="Competitors around this property">
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 4} fill="#f3f5ee" stroke="#d0d6ba" />
      <circle cx={size / 2} cy={size / 2} r={(size / 2 - 12) / 2} fill="none" stroke="#d0d6ba" strokeDasharray="3 3" />
      {pts.map((l) => {
        const x = size / 2 + (l.lng - centre.lng) * 65 * scale;
        const y = size / 2 - (l.lat - centre.lat) * 111 * scale;
        const hot = l.listingId === highlightId;
        return <circle key={l.listingId} cx={x} cy={y} r={hot ? 6 : 4} fill={hot ? '#9a7b2e' : l.annualRevenue > 0 ? '#5d8156' : '#b8bcbc'} opacity={0.9}><title>{`${l.name}: ${gbp(l.annualRevenue)}/yr`}</title></circle>;
      })}
      <circle cx={size / 2} cy={size / 2} r={5} fill="#2e3d2b" />
      <text x={size / 2} y={size - 6} textAnchor="middle" fontSize={9} fill="#5b615f">{`≈${Math.round(maxD * 10) / 10} km radius`}</text>
    </svg>
  );
}

/**
 * Tracked Airbnbs within about a kilometre, with real trailing-12-month
 * figures, plus the pasted listing's own row when a provider tracks it.
 */
export function CompetitorsPanel({ competitors, centre, bedrooms }: { competitors: CompetitorsResult; centre: { lat: number; lng: number }; bedrooms: number }) {
  const s = competitors.summary;
  const t = competitors.tracked;
  return (
    <Card className="mt-6">
      <CardContent className="pt-5">
        <div className="mb-3">
          <p className="text-sm font-semibold text-foreground">Competitors nearby</p>
          <p className="text-xs text-muted-foreground">
            {s.count} tracked listings within about a kilometre, {s.earning} with bookings in the last year{s.sameSize ? `, ${s.sameSize} with ${bedrooms} bedrooms` : ''}.
            {competitors.updatedAt ? ` Data ${new Date(competitors.updatedAt).toLocaleDateString('en-GB')}.` : ''}
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <DotMap centre={centre} listings={competitors.top} highlightId={t?.listingId} />
          <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Median revenue</p><p className="text-lg font-bold">{s.medianRevenue === null ? '—' : gbp(s.medianRevenue)}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Top quartile</p><p className="text-lg font-bold">{s.topQuartileRevenue === null ? '—' : gbp(s.topQuartileRevenue)}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Median nightly</p><p className="text-lg font-bold">{s.medianAdr === null ? '—' : gbp(s.medianAdr)}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Median occupancy</p><p className="text-lg font-bold">{s.medianOccupancy === null ? '—' : pct0(s.medianOccupancy * 100)}</p></div>
            {t && (
              <div className="col-span-2 rounded-lg border border-[#9a7b2e]/40 bg-[#9a7b2e]/5 p-3 sm:col-span-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">This listing (tracked)</p>
                <p className="text-sm font-semibold">{gbp(t.annualRevenue)} / yr · {gbp(t.adr)} / night · {pct0(t.occupancy * 100)} occupancy · {t.reviewCount} reviews · {t.rating.toFixed(2)} ★</p>
                <p className="text-[11px] text-muted-foreground">Trailing 12 months from {competitors.provider === 'internal' ? 'a recent Stayful report' : 'Airbtics'}{t.activeDays ? `, live ${t.activeDays} days` : ''}.</p>
              </div>
            )}
            {competitors.trackedMissing && (
              <p className="col-span-2 text-[11px] text-muted-foreground sm:col-span-4">This Airbnb is not tracked by our data partner yet, so the figures above are for similar properties nearby, not this listing.</p>
            )}
          </div>
        </div>
        {competitors.top.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Listing</th>
                  <th className="py-1 pr-3 font-medium">Beds</th>
                  <th className="py-1 pr-3 font-medium">Revenue / yr</th>
                  <th className="py-1 pr-3 font-medium">Nightly</th>
                  <th className="py-1 pr-3 font-medium">Occ.</th>
                  <th className="py-1 pr-3 font-medium">Reviews</th>
                  <th className="py-1 font-medium">Distance</th>
                </tr>
              </thead>
              <tbody>
                {competitors.top.map((l) => (
                  <tr key={l.listingId} className={`border-t border-border ${l.listingId === t?.listingId ? 'bg-[#9a7b2e]/5 font-semibold' : ''}`}>
                    <td className="max-w-[220px] truncate py-1.5 pr-3">
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                        {l.name}
                        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </a>
                    </td>
                    <td className="py-1.5 pr-3">{l.bedrooms}</td>
                    <td className="py-1.5 pr-3">{l.annualRevenue > 0 ? gbp(l.annualRevenue) : '—'}</td>
                    <td className="py-1.5 pr-3">{l.adr > 0 ? gbp(l.adr) : '—'}</td>
                    <td className="py-1.5 pr-3">{l.occupancy > 0 ? pct0(l.occupancy * 100) : '—'}</td>
                    <td className="py-1.5 pr-3"><span className="inline-flex items-center gap-1">{num0(l.reviewCount)}{l.rating > 0 && <><Star className="h-3 w-3 text-warning" aria-hidden="true" />{l.rating.toFixed(1)}</>}</span></td>
                    <td className="py-1.5">{l.distanceKm !== undefined ? `${l.distanceKm} km` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
