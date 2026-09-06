'use client';

import { ExternalLink, MapPin, BedDouble, Bath, Star, TrendingUp, TrendingDown, Minus, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SOURCE_LABELS } from '@/lib/listing/detect';
import type { ListingSnapshot } from '@/lib/listing/types';
import type { QuickEstimate } from '@/lib/listing/quick-types';
import { gbp, pct0 } from './format';
import { formatListingPrice } from '@/lib/listing/format';

const STATUS_LABEL: Record<string, string> = { under_offer: 'Under offer', let_agreed: 'Let agreed', sold: 'Sold', removed: 'Removed' };

/**
 * The listing a member pasted: photo, price, address and a free quick view
 * (estimate, area score, competition, tracked performance for Airbnbs,
 * deal one-liner). Shown on the form before the full report, and in a
 * compact form at the top of the report.
 */
export function SourceListingCard({ snapshot, quick, warnings, onChange, compact }: { snapshot: ListingSnapshot; quick: QuickEstimate | null; warnings?: string[]; onChange?: () => void; compact?: boolean }) {
  const price = snapshot.price ? formatListingPrice(snapshot.price) : null;
  const status = snapshot.status && snapshot.status !== 'available' ? STATUS_LABEL[snapshot.status] : null;
  const est = quick?.estimate ?? null;
  const area = quick?.area ?? null;
  const tracked = quick?.tracked ?? null;
  const deal = quick?.deal ?? null;
  const Trend = area?.trend?.direction === 'up' ? TrendingUp : area?.trend?.direction === 'down' ? TrendingDown : Minus;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex gap-3">
        {snapshot.photos[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={snapshot.photos[0]} alt="" className="h-20 w-28 shrink-0 rounded-md object-cover" loading="lazy" referrerPolicy="no-referrer" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{snapshot.title}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{snapshot.displayAddress ?? snapshot.postcode ?? 'Location on listing'}</span>
                {snapshot.postcode && snapshot.locationConfidence === 'reverse-geocoded' && <span className="shrink-0">· approx. {snapshot.postcode}</span>}
              </p>
            </div>
            {onChange && (
              <Button type="button" variant="outline" size="sm" onClick={onChange}>
                Change
              </Button>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {price && <span className="font-semibold text-foreground">{price}</span>}
            {snapshot.bedrooms !== undefined && (
              <span className="flex items-center gap-1"><BedDouble className="h-3 w-3" aria-hidden="true" />{snapshot.bedrooms} bed</span>
            )}
            {snapshot.bathrooms !== undefined && (
              <span className="flex items-center gap-1"><Bath className="h-3 w-3" aria-hidden="true" />{snapshot.bathrooms} bath</span>
            )}
            {snapshot.str?.rating !== undefined && (
              <span className="flex items-center gap-1"><Star className="h-3 w-3" aria-hidden="true" />{snapshot.str.rating.toFixed(2)}{snapshot.str.reviewCount ? ` (${snapshot.str.reviewCount})` : ''}</span>
            )}
            {status && <span className="rounded bg-warning/20 px-1.5 py-0.5 font-medium text-warning-foreground">{status}</span>}
            <a href={snapshot.canonicalUrl} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 font-medium text-primary hover:underline">
              View on {SOURCE_LABELS[snapshot.source]} <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>

      {!compact && quick && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 sm:grid-cols-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Est. revenue / yr</p>
            <p className="text-base font-bold text-foreground">{est ? gbp(est.grossRevenue) : '—'}</p>
            {est && <p className="text-[10px] text-muted-foreground">{est.adr ? `${gbp(est.adr)} / night` : ''}{est.occupancy !== null ? ` · ${pct0(est.occupancy)} occ.` : ''}</p>}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Area score</p>
            <p className="text-base font-bold text-foreground">{area?.score !== null && area?.score !== undefined ? `${area.score} · ${area.grade}` : '—'}</p>
            {area && <p className="text-[10px] text-muted-foreground">{area.name}{area.competition ? ` · ${area.competition.label} competition` : ''}</p>}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{tracked ? 'This listing earns' : 'Trend'}</p>
            {tracked ? (
              <>
                <p className="text-base font-bold text-foreground">{gbp(tracked.annualRevenue)}</p>
                <p className="text-[10px] text-muted-foreground">{gbp(tracked.adr)} / night · {pct0(tracked.occupancy * 100)} occ. · {tracked.reviewCount} reviews</p>
              </>
            ) : (
              <>
                <p className="flex items-center gap-1 text-base font-bold text-foreground"><Trend className="h-4 w-4" aria-hidden="true" />{area?.trend?.label ?? '—'}</p>
                <p className="text-[10px] text-muted-foreground">{quick.trackedMissing ? 'Listing not tracked by our data partner' : area?.directBooking ? `${area.directBooking.label} direct-booking potential` : ''}</p>
              </>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{deal?.kind === 'rent-to-rent' ? 'Rent-to-rent margin' : 'Yield on asking'}</p>
            <p className="text-base font-bold text-foreground">{deal?.kind === 'rent-to-rent' ? `${deal.monthlyMargin < 0 ? '−' : ''}${gbp(Math.abs(deal.monthlyMargin))} / mo` : deal?.kind === 'purchase' ? `${deal.grossYieldPct}%` : '—'}</p>
            {deal?.kind === 'purchase' && <p className="text-[10px] text-muted-foreground">Max price for {deal.targetYieldPct}%: {gbp(deal.maxPriceForTargetYield)}</p>}
            {deal?.kind === 'rent-to-rent' && <p className="text-[10px] text-muted-foreground">Max rent for {gbp(deal.targetMarginPcm)} margin: {gbp(deal.maxRentForTargetMargin)}</p>}
          </div>
        </div>
      )}

      {!compact && quick && (est || area) && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {est ? `${est.note}. ` : ''}
          {area?.licensing && (
            <span className="inline-flex items-center gap-1">
              {area.licensing.status === 'confirmed-licensed' ? <AlertTriangle className="h-3 w-3 text-warning" aria-hidden="true" /> : <ShieldCheck className="h-3 w-3 text-success" aria-hidden="true" />}
              {area.licensing.headline}
            </span>
          )}
          {quick.limited && ' Some lookups were paused for today.'}
        </p>
      )}

      {warnings && warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-[11px] text-warning-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
