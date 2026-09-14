/**
 * The content of the market page's data-driven tabs, as plain data: a
 * title and description, KPI tiles, an optional monthly line chart, a
 * table and a key/value list. Everything comes from the explorer card (or
 * one of its districts) — nothing is estimated here — and the UI just
 * renders the model, so the tabs stay testable without React.
 */

import type { AreaCardData, LevelFigures } from './explorer.ts';
import type { AreaTrend } from './trend.ts';
import type { MarketGoals } from './goals.ts';
import { deltaTag } from './delta.ts';
import { formatMonth } from './trend.ts';
import { gbp, gbpCompact, pct } from './format.ts';
import { MONTH_SHORT, MIN_SEASONALITY_REPORTS } from './seasonality.ts';
import { COMPETITION_LABELS, MIN_RATED_REPORTS, competitionMeaning } from './competition.ts';
import { MIN_DISTRICT_SAMPLES } from './confidence.ts';
import { districtLabel } from './labels.ts';

export const TAB_KEYS = ['overview', 'submarkets', 'listings', 'occupancy', 'revenue', 'rates', 'seasonality', 'competition', 'licensing', 'longlet', 'deals'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABELS: Record<TabKey, string> = {
  overview: 'Overview',
  submarkets: 'Sub-markets',
  listings: 'Listings',
  occupancy: 'Occupancy',
  revenue: 'Revenue',
  rates: 'Rates',
  seasonality: 'Seasonality',
  competition: 'Competition',
  licensing: 'Licensing & regulation',
  longlet: 'Long-let vs short-let',
  deals: 'Your deals',
};

export function isTabKey(v: unknown): v is TabKey {
  return typeof v === 'string' && (TAB_KEYS as readonly string[]).includes(v);
}

/** Months with fewer reports than this are left out of "highest / lowest month". */
export const MIN_MONTH_REPORTS = 3;

export interface TabKpi {
  label: string;
  value: string;
  sub?: string;
  tone?: 'works' | 'muted';
}

export interface TabTableRow {
  key: string;
  cells: string[];
  muted?: boolean;
  highlight?: boolean;
  /** Set when the row opens a district. */
  district?: string;
}

export interface TabLine {
  title: string;
  metric: 'avg_gross_revenue' | 'avg_adr' | 'avg_occupancy';
  format: 'gbp' | 'gbpCompact' | 'pct';
  delta: 'revenue' | 'adr' | 'occupancy';
  legend: string;
}

export interface TabModel {
  title: string;
  desc: string;
  kpis: TabKpi[];
  line?: TabLine;
  table?: { title: string; cols: string[]; rows: TabTableRow[] };
  kv?: { title: string; rows: { k: string; v: string }[]; note?: string };
  links?: { label: string; href: string }[];
  /** Existing chart components the UI slots in under the KPIs. */
  extra?: 'seasonality' | 'competition' | 'bedrooms' | 'reports';
  /** Shown instead of the figures when the scope has none. */
  empty?: string;
}

export interface TabContext {
  area: AreaCardData;
  /** The area itself, or the district in view. */
  scope: LevelFigures;
  scopeName: string;
  isDistrict: boolean;
  bedroom: number | null;
  trend: AreaTrend | null;
  goals: MarketGoals | null;
}

const DISTRICT_NOTE = 'Licensing, the long-let comparison and the market score follow the postcode area; districts do not carry their own.';

function bedroomTable(ctx: TabContext, title: string): TabModel['table'] {
  const rows = ctx.scope.byBedrooms.map((b) => ({
    key: String(b.bedrooms),
    highlight: ctx.bedroom === b.bedrooms,
    cells: [`${b.bedrooms}-bed`, String(b.samples), gbp(b.grossRevenue), pct(b.occupancy, 0), gbp(b.adr), b.propertyValueMid !== null ? gbp(b.propertyValueMid) : '—', b.grossYieldPct !== null ? pct(b.grossYieldPct, 1) : '—'],
  }));
  return { title, cols: ['Bedrooms', 'Reports', 'Revenue / yr', 'Occupancy', 'Daily rate', 'Property value', 'Gross yield'], rows };
}

function revpar(adr: number | null, occ: number | null): number | null {
  return adr === null || occ === null ? null : (adr * occ) / 100;
}

function monthExtreme(ctx: TabContext, pick: 'max' | 'min'): { month: string; adr: number } | null {
  const usable = ctx.scope.series.filter((b) => b.reports >= MIN_MONTH_REPORTS && b.avg_adr !== null);
  if (usable.length < 2) return null;
  const best = usable.reduce((a, b) => (pick === 'max' ? (b.avg_adr! > a.avg_adr! ? b : a) : b.avg_adr! < a.avg_adr! ? b : a));
  return { month: formatMonth(best.month), adr: best.avg_adr! };
}

export function buildTabModel(tab: TabKey, ctx: TabContext): TabModel {
  const { area, scope, scopeName, trend } = ctx;
  const h = scope.headline;
  const s = scope.seasonality;
  const c = scope.competition;
  const v = area.verdict;

  switch (tab) {
    case 'submarkets': {
      const ready = area.districts.filter((d) => d.ready);
      const byRev = [...ready].sort((a, b) => (b.headline.grossRevenue ?? -1) - (a.headline.grossRevenue ?? -1));
      const top = byRev[0];
      const bottom = byRev[byRev.length - 1];
      return {
        title: `Sub-markets in ${area.name}`,
        desc: `Postcode districts inside the ${area.code} area, from the reports run there. A district needs ${MIN_DISTRICT_SAMPLES} reports before its own figures show; until then the area as a whole is the guide.`,
        kpis: [
          { label: 'Districts with figures', value: `${ready.length} of ${area.districts.length}`, sub: 'ready' },
          { label: 'Best district', value: top ? districtLabel(top) : '—', sub: top ? `${gbpCompact(top.headline.grossRevenue)} avg revenue` : 'none yet' },
          { label: 'Spread', value: byRev.length > 1 && top.headline.grossRevenue !== null && bottom.headline.grossRevenue !== null ? gbpCompact(top.headline.grossRevenue - bottom.headline.grossRevenue) : '—', sub: 'top to bottom district' },
        ],
        table: {
          title: 'All districts',
          cols: ['District', 'Reports', 'Confidence', 'Revenue / yr', 'Occupancy', 'RevPAR', 'Daily rate', 'Competition', 'Seasonality', 'Status'],
          rows: [...area.districts]
            .sort((a, b) => Number(b.ready) - Number(a.ready) || (b.headline.grossRevenue ?? -1) - (a.headline.grossRevenue ?? -1))
            .map((d) => {
              const missing = MIN_DISTRICT_SAMPLES - d.headline.totalSamples;
              return d.ready
                ? { key: d.code, district: d.code, cells: [districtLabel(d), String(d.headline.totalSamples), d.confidence.label, gbp(d.headline.grossRevenue), pct(d.headline.occupancy, 0), gbp(revpar(d.headline.adr, d.headline.occupancy)), gbp(d.headline.adr), d.competition?.label ?? '—', d.seasonality?.label ?? '—', 'Ready'] }
                : { key: d.code, district: d.code, muted: true, cells: [districtLabel(d), String(d.headline.totalSamples), d.confidence.label, '—', '—', '—', '—', '—', '—', `Early — ${missing} more report${missing === 1 ? '' : 's'} needed`] };
            }),
        },
        empty: area.districts.length === 0 ? `Reports for ${area.name} do not carry a full postcode yet, so it cannot be split into districts. New analyser reports add one automatically.` : undefined,
      };
    }
    case 'listings':
      return {
        title: 'Listings',
        desc: `The comparables our analyser reports pulled around addresses in ${scopeName}, by size. There is no live inventory count; density is listings per km² around the analysed addresses.`,
        kpis: [
          { label: 'Listing density', value: scope.listingDensity === null ? '—' : `${scope.listingDensity.toFixed(1)} / km²`, sub: scope.listingDensity === null ? 'no density data yet' : 'around the analysed addresses' },
          { label: 'Average reviews', value: c?.reviews !== null && c?.reviews !== undefined ? String(c.reviews) : '—', sub: 'per comparable' },
          { label: 'Average rating', value: c?.rating !== null && c?.rating !== undefined ? `${c.rating.toFixed(2)}★` : '—', sub: 'of comparables' },
          { label: 'Reports analysed', value: String(h.totalSamples), sub: scope.confidence.label },
        ],
        extra: 'reports',
        table: bedroomTable(ctx, 'Comparables by bedroom count'),
      };
    case 'occupancy':
      return {
        title: 'Occupancy',
        desc: 'Share of available nights booked, averaged across the comparables in each report.',
        kpis: [
          { label: 'Occupancy', value: pct(h.occupancy, 0), sub: deltaTag(trend?.occupancy).text },
          { label: 'Peak revenue month', value: s ? MONTH_SHORT[s.peakMonth] : '—', sub: s ? `${Math.round(s.peakShare * 100)}% of the year's revenue` : 'needs monthly figures' },
          { label: 'Quietest month', value: s ? MONTH_SHORT[s.lowMonth] : '—', sub: s ? `${Math.round(s.lowShare * 100)}% of the year's revenue` : 'needs monthly figures' },
          { label: 'Break-even occupancy', value: v ? `${v.breakEvenOccupancyPct}%` : '—', sub: v ? `to match long-let net${ctx.isDistrict ? ' (area figure)' : ''}` : 'no long-let comparator yet' },
        ],
        line: { title: 'Occupancy by month', metric: 'avg_occupancy', format: 'pct', delta: 'occupancy', legend: 'Occupancy' },
        table: bedroomTable(ctx, 'Occupancy by bedroom count'),
      };
    case 'revenue': {
      const best = [...scope.byBedrooms].filter((b) => b.grossRevenue !== null).sort((a, b) => b.grossRevenue! - a.grossRevenue!)[0];
      return {
        title: 'Revenue',
        desc: 'Average gross revenue a listing earns in a year, before management, cleaning and bills.',
        kpis: [
          { label: 'Annual revenue', value: gbp(h.grossRevenue), sub: deltaTag(trend?.revenue).text },
          { label: 'RevPAR', value: gbp(revpar(h.adr, h.occupancy)), sub: 'revenue per available night' },
          { label: 'Gross yield', value: scope.yieldOnCost ? pct(scope.yieldOnCost.grossYieldPct, 1) : '—', sub: scope.yieldOnCost ? `on a ${gbpCompact(scope.yieldOnCost.propertyValueMid)} average price` : 'no property-value data', tone: scope.yieldOnCost ? 'works' : 'muted' },
          { label: 'Best size', value: best ? `${best.bedrooms}-bed` : '—', sub: best ? `${gbpCompact(best.grossRevenue)} a year` : 'no bedroom split yet' },
        ],
        line: { title: 'Average listing revenue by month', metric: 'avg_gross_revenue', format: 'gbpCompact', delta: 'revenue', legend: 'Monthly revenue' },
        extra: 'bedrooms',
        table: bedroomTable(ctx, 'Revenue by bedroom count'),
      };
    }
    case 'rates': {
      const hi = monthExtreme(ctx, 'max');
      const lo = monthExtreme(ctx, 'min');
      const bestAdr = [...scope.byBedrooms].filter((b) => b.adr !== null).sort((a, b) => b.adr! - a.adr!)[0];
      return {
        title: 'Rates',
        desc: 'Average daily rate per booked night, from the comparables in each report. Months are the months reports were run, not a seasonal price curve.',
        kpis: [
          { label: 'Average daily rate', value: gbp(h.adr), sub: deltaTag(trend?.adr).text },
          { label: 'Highest month', value: hi ? gbp(hi.adr) : '—', sub: hi ? `${hi.month}, last 12 months` : `needs ${MIN_MONTH_REPORTS}+ reports in two months` },
          { label: 'Lowest month', value: lo ? gbp(lo.adr) : '—', sub: lo ? `${lo.month}, last 12 months` : `needs ${MIN_MONTH_REPORTS}+ reports in two months` },
          { label: 'Best size', value: bestAdr ? `${bestAdr.bedrooms}-bed` : '—', sub: bestAdr ? `${gbp(bestAdr.adr)} a night` : 'no bedroom split yet' },
        ],
        line: { title: 'Average daily rate by month', metric: 'avg_adr', format: 'gbp', delta: 'adr', legend: 'Avg rate' },
        table: bedroomTable(ctx, 'Daily rate by bedroom count'),
      };
    }
    case 'seasonality':
      return {
        title: 'Seasonality',
        desc: s
          ? `${s.explanation} A score of 100 is a perfectly even year; the lower it goes, the more the income bunches into a few months.`
          : `Needs ${MIN_SEASONALITY_REPORTS} reports with a month-by-month breakdown before a seasonality score is shown (${scope.monthlyReports} so far). Every full analyser report adds one.`,
        kpis: [
          { label: 'Consistency score', value: s ? `${s.score} / 100` : '—', sub: s ? s.label : 'needs monthly figures' },
          { label: 'Peak month', value: s ? MONTH_SHORT[s.peakMonth] : '—', sub: s ? `${Math.round(s.peakShare * 100)}% of the year` : 'needs monthly figures' },
          { label: 'Quietest month', value: s ? MONTH_SHORT[s.lowMonth] : '—', sub: s ? `${Math.round(s.lowShare * 100)}% of the year` : 'needs monthly figures' },
          { label: 'Reports with monthly data', value: String(scope.monthlyReports), sub: 'behind this profile' },
        ],
        extra: s ? 'seasonality' : undefined,
      };
    case 'competition':
      return {
        title: 'Competition',
        desc: 'From the reviews of the comparables our reports analysed: how established the hosts are and how well guests are served. Absolute bands, so a label only changes when the market itself does.',
        kpis: [
          { label: 'Competition', value: c ? c.label : '—', sub: c ? `intensity ${c.intensity} / 100` : `needs ${MIN_RATED_REPORTS} rated reports (${scope.ratedReports} so far)` },
          { label: 'Average rating', value: c?.rating !== null && c?.rating !== undefined ? `${c.rating.toFixed(2)}★` : '—', sub: 'of comparables' },
          { label: 'Average reviews', value: c?.reviews !== null && c?.reviews !== undefined ? String(c.reviews) : '—', sub: 'per comparable' },
          { label: 'Direct booking', value: scope.directBooking ? `${scope.directBooking.score} / 100` : '—', sub: scope.directBooking ? `${scope.directBooking.label.toLowerCase()} potential` : 'no demand-driver data yet' },
        ],
        extra: 'competition',
        kv: {
          title: 'What the bands mean',
          rows: COMPETITION_LABELS.map((l) => ({ k: l, v: competitionMeaning(l) })),
          note: '100+ reviews on average marks an established market; a rating of 4.8★ or better with fewer reviews is the opening.',
        },
      };
    case 'licensing': {
      const lic = area.licensing;
      const reg = area.score?.components.find((k) => k.key === 'regulatory');
      return {
        title: 'Licensing & regulation',
        desc: `${lic.detail} Rules are set per local authority, not per postcode, so confirm with the council before buying.${ctx.isDistrict ? ` ${DISTRICT_NOTE}` : ''}`,
        kpis: [
          { label: 'Status', value: lic.headline, sub: lic.regionLabel, tone: lic.status === 'confirmed-unrestricted' ? 'works' : undefined },
          { label: 'Regulation score', value: reg && reg.earned !== null ? `${Math.round(reg.earned * 10) / 10} / ${reg.weight}` : '—', sub: 'feeds the market score' },
          { label: 'Nation', value: lic.nation, sub: lic.straddle ? 'straddles a boundary' : 'single jurisdiction' },
          { label: 'Last verified', value: lic.lastVerified, sub: 'against council sources' },
        ],
        kv: {
          title: 'The rules that apply',
          rows: [
            { k: 'Licence or registration', v: lic.status === 'confirmed-licensed' ? 'Required' : lic.status === 'confirmed-unrestricted' ? 'Not required' : 'Unconfirmed — check locally' },
            { k: 'Incoming changes', v: lic.changeIncoming ?? 'None noted' },
            { k: 'Boundary', v: lic.straddle ? 'This postcode area crosses a jurisdiction boundary; rules can differ within it' : 'One local authority regime' },
          ],
          note: 'Licensing is a general guide from published council sources; it is not legal advice.',
        },
        links: lic.sources.map((href) => ({ label: new URL(href).hostname, href })),
      };
    }
    case 'longlet': {
      if (!v) {
        return {
          title: 'Long-let vs short-let',
          desc: `No area long-let comparator for ${area.name} yet, so the two strategies cannot be set against each other. It appears once a long-let rent estimate is available for the area.`,
          kpis: [],
        };
      }
      const f = v.financials;
      const winner = v.winner === 'short-let' ? 'Short-let ahead' : v.winner === 'long-let' ? 'Long-let ahead' : 'Close call';
      return {
        title: 'Long-let vs short-let',
        desc: `Net income after costs for a typical ${area.name} property let short-term against the same home on a standard tenancy at the area's average rent. Costs follow the analyser's standard assumptions; mortgage costs are the same either way and are left out of both sides.${ctx.isDistrict ? ` ${DISTRICT_NOTE}` : ''}`,
        kpis: [
          { label: 'Verdict', value: winner, sub: `by ${gbp(v.annualAdvantage)} a year`, tone: v.winner === 'short-let' ? 'works' : undefined },
          { label: 'Short-let net / yr', value: gbp(f.shortLetNetAnnual), sub: 'after management, cleaning, bills' },
          { label: 'Long-let net / yr', value: gbp(f.longLetNetAnnual), sub: `${gbp(v.longLetMonthlyRent)} pcm before costs` },
          { label: 'Break-even occupancy', value: `${v.breakEvenOccupancyPct}%`, sub: 'to match long-let net' },
        ],
        kv: {
          title: 'The working',
          rows: [
            { k: 'Gross short-let revenue', v: gbp(f.shortLetGrossAnnual) },
            { k: 'Short-let net', v: gbp(f.shortLetNetAnnual) },
            { k: 'Long-let rent × 12', v: gbp(f.longLetGrossAnnual) },
            { k: 'Long-let net', v: gbp(f.longLetNetAnnual) },
            { k: 'Difference per month', v: gbp(f.monthlyDifference) },
          ],
        },
      };
    }
    case 'overview':
    case 'deals':
      return { title: TAB_LABELS[tab], desc: '', kpis: [] };
  }
}
