/**
 * The one-line answer the explorer leads with: does this listing (or area)
 * work for this member? Pure functions over figures the quick view and the
 * deal maths already produce, so the card, the row chip, the map pin and
 * the emails all say the same thing.
 */
import type { Deal } from './deal.ts';
import type { ListingKind } from './types.ts';
import type { QuickEstimate } from './quick-types.ts';
import { gradeFor } from '../market/score.ts';
import { trendLabel, type Direction } from '../market/trend.ts';

export type VerdictTone = 'works' | 'tight' | 'no' | 'info' | 'unknown';

export const VERDICT_COLOURS: Record<VerdictTone, string> = { works: '#3f7a4a', tight: '#9a7b2e', no: '#b3452f', info: '#4e6f8f', unknown: '#9aa39b' };
export const VERDICT_CHIPS: Record<VerdictTone, string> = { works: 'Works', tight: 'Tight', no: 'Doesn’t work', info: 'Benchmark', unknown: 'No estimate yet' };

/** A target bar: where the member's number sits against their target. */
export interface VerdictTrack {
  min: number;
  max: number;
  target: number;
  me: number;
  unit: 'pct' | 'gbp' | 'gbpk';
  targetLabel: string;
}

export interface VerdictKey {
  label: string;
  value: string;
  sub: string;
  tone?: VerdictTone;
}

export interface Verdict {
  tone: VerdictTone;
  chip: string;
  headline: string;
  sentence: string;
  track: VerdictTrack | null;
  keys: VerdictKey[];
  /** One line under the tiles: the ceiling price or rent, or the caveat that matters most. */
  ceiling: string | null;
  /** The single number a list row shows, with its label. */
  number: string;
  numberLabel: string;
}

export interface DealVerdictInput {
  kind: ListingKind;
  price: { amount: number; period: string } | null;
  bedrooms: number | null;
  deal: Deal | null;
  quick: QuickEstimate | null;
}

/** Magnitude only; callers add the sign where it matters. */
const absGbp = (n: number): string => `£${Math.round(Math.abs(n)).toLocaleString('en-GB')}`;
/** Always signed: +£89, −£374. */
export const signedGbp = (n: number): string => `${n < 0 ? '−' : '+'}${absGbp(n)}`;
const gbpK = (n: number): string => (Math.abs(n) >= 1000 ? `£${Math.round(n / 1000)}k` : absGbp(n));
const pct = (n: number, dp = 0): string => `${n.toFixed(dp)}%`;

export function formatTrackValue(v: number, unit: VerdictTrack['unit']): string {
  if (unit === 'pct') return pct(v, Number.isInteger(v) ? 0 : 1);
  if (unit === 'gbpk') return gbpK(v);
  return `${v < 0 ? '−' : ''}${absGbp(v)}`;
}

function licensingKey(quick: QuickEstimate | null): VerdictKey {
  const area = quick?.area;
  if (!area) return { label: 'Licensing', value: 'Unknown', sub: 'No area data for this postcode yet' };
  const value = area.licensing.status === 'confirmed-unrestricted' ? 'None required' : area.licensing.status === 'confirmed-licensed' ? 'Licence needed' : 'Unconfirmed';
  return { label: 'Licensing', value, sub: `${area.name}, ${area.licensing.status === 'unconfirmed' ? 'check locally' : 'confirmed'}`, tone: area.licensing.status === 'confirmed-licensed' ? 'tight' : undefined };
}

function rateLine(quick: QuickEstimate | null): string {
  const e = quick?.estimate;
  if (!e) return '';
  const parts: string[] = [];
  if (e.adr) parts.push(`${absGbp(e.adr)} a night`);
  if (e.occupancy !== null) parts.push(`${Math.round(e.occupancy)}% occupied`);
  return parts.join(' · ');
}

function limitedNote(quick: QuickEstimate | null): string {
  return quick?.limited ? ' Some lookups were skipped this time; check again later for the rest.' : '';
}

function purchaseVerdict(input: DealVerdictInput, deal: Extract<Deal, { kind: 'purchase' }>): Verdict {
  const ratio = deal.targetYieldPct > 0 ? deal.grossYieldPct / deal.targetYieldPct : 0;
  const tone: VerdictTone = ratio >= 1 ? 'works' : ratio >= 0.8 ? 'tight' : 'no';
  const price = absGbp(deal.askingPrice);
  const cash = deal.cashflowMonthly;
  const cashText = cash >= 0 ? `with ${absGbp(cash)} a month left after the mortgage` : `and ${absGbp(cash)} a month short after the mortgage`;
  const yieldText = `${pct(deal.grossYieldPct, 1)} gross yield`;
  const headline = tone === 'works' ? `Works at ${price}` : tone === 'tight' ? `Tight at ${price}` : `Doesn’t work at ${price}`;
  let sentence =
    tone === 'works'
      ? `${yieldText} against your ${pct(deal.targetYieldPct)} target, ${cashText}.`
      : tone === 'tight'
        ? `${yieldText}, just under your ${pct(deal.targetYieldPct)} target, ${cashText}. It works at ${absGbp(deal.maxPriceForTargetYield)} or below.`
        : `${yieldText} against your ${pct(deal.targetYieldPct)} target, ${cashText}. It would need to be ${absGbp(deal.maxPriceForTargetYield)} or below.`;
  sentence += limitedNote(input.quick);
  const max = Math.max(20, Math.ceil((Math.max(deal.grossYieldPct, deal.targetYieldPct) * 1.25) / 5) * 5);
  return {
    tone,
    chip: VERDICT_CHIPS[tone],
    headline,
    sentence,
    track: { min: 0, max, target: deal.targetYieldPct, me: deal.grossYieldPct, unit: 'pct', targetLabel: `Your target ${pct(deal.targetYieldPct)}` },
    keys: [
      { label: 'Est. revenue', value: absGbp(deal.grossRevenue), sub: rateLine(input.quick) || 'a year, gross' },
      { label: 'Cash needed', value: absGbp(deal.cashRequired), sub: `${gbpK(deal.askingPrice * (deal.depositPct / 100))} deposit · ${gbpK(deal.stampDuty)} stamp duty · ${gbpK(deal.setupCost)} setup` },
      { label: 'Monthly cashflow', value: signedGbp(cash), sub: `after a ${absGbp(deal.mortgageMonthly)} mortgage`, tone: cash >= 0 ? 'works' : 'no' },
      licensingKey(input.quick),
    ],
    ceiling: tone === 'works' ? `You could pay up to ${absGbp(deal.maxPriceForTargetYield)} and still hit your ${pct(deal.targetYieldPct)} target.` : `Offer ${absGbp(deal.maxPriceForTargetYield)} or less to reach your ${pct(deal.targetYieldPct)} target.`,
    number: pct(deal.grossYieldPct, 1),
    numberLabel: 'yield',
  };
}

function rentVerdict(input: DealVerdictInput, deal: Extract<Deal, { kind: 'rent-to-rent' }>): Verdict {
  const m = deal.monthlyMargin;
  const tone: VerdictTone = m >= deal.targetMarginPcm ? 'works' : m >= 0 ? 'tight' : 'no';
  const rent = `${absGbp(deal.advertisedRentPcm)} a month`;
  const headline = tone === 'works' ? `Works at ${rent}` : tone === 'tight' ? `Tight at ${rent}` : `Doesn’t work at ${rent}`;
  const ceilingRent = absGbp(deal.maxRentForTargetMargin);
  const sentence =
    (tone === 'works'
      ? `${absGbp(m)} a month left after rent, bills and management, against your ${absGbp(deal.targetMarginPcm)} target.`
      : tone === 'tight'
        ? `Clears ${absGbp(m)} a month after rent, bills and management, under your ${absGbp(deal.targetMarginPcm)} target. The rent would need to be ${ceilingRent} or below.`
        : `Loses ${absGbp(m)} a month after rent, bills and management. The rent would need to be ${ceilingRent} or below for your ${absGbp(deal.targetMarginPcm)} margin.`) + limitedNote(input.quick);
  const occ = input.quick?.estimate?.occupancy ?? null;
  const min = Math.min(-300, Math.floor(m / 100) * 100);
  const max = Math.max(1000, Math.ceil((Math.max(m, deal.targetMarginPcm) * 1.5) / 100) * 100);
  return {
    tone,
    chip: VERDICT_CHIPS[tone],
    headline,
    sentence,
    track: { min, max, target: deal.targetMarginPcm, me: m, unit: 'gbp', targetLabel: `Your target ${absGbp(deal.targetMarginPcm)}` },
    keys: [
      { label: 'Monthly margin', value: `${m < 0 ? '−' : ''}${absGbp(m)}`, sub: `after ${absGbp(deal.advertisedRentPcm)} rent and ${absGbp(deal.monthlyOperating)} running costs`, tone: m >= deal.targetMarginPcm ? 'works' : m >= 0 ? 'tight' : 'no' },
      { label: 'Breakeven occupancy', value: deal.breakevenOccupancyPct === null ? '—' : pct(deal.breakevenOccupancyPct), sub: occ === null ? 'of nights, to cover rent and bills' : `area runs at ${Math.round(occ)}%`, tone: deal.breakevenOccupancyPct !== null && occ !== null ? (deal.breakevenOccupancyPct <= occ ? 'works' : 'no') : undefined },
      { label: 'Rent ceiling', value: ceilingRent, sub: `for a ${absGbp(deal.targetMarginPcm)} monthly margin` },
      licensingKey(input.quick),
    ],
    ceiling: 'Landlord consent and a company let are needed for rent-to-rent; ask before viewing.',
    number: `${m < 0 ? '−' : ''}${absGbp(m)}/mo`,
    numberLabel: 'margin',
  };
}

function strVerdict(input: DealVerdictInput): Verdict {
  const quick = input.quick;
  const tracked = quick?.tracked ?? null;
  const beds = input.bedrooms ?? tracked?.bedrooms ?? null;
  const bedLabel = beds === null ? 'property' : `${beds}-bed`;
  // Revenue and sample count always come from the same figure: the bedroom
  // stat when it has revenue, else the all-sizes headline (labelled as such).
  const bs = quick?.area?.bedroomStat ?? null;
  const typicalStat = bs?.grossRevenue ? { rev: bs.grossRevenue, samples: bs.samples, label: bedLabel } : quick?.area?.headline.grossRevenue ? { rev: quick.area.headline.grossRevenue, samples: quick.area.headline.totalSamples, label: 'property' } : null;
  const typical = typicalStat?.rev ?? null;
  const typicalSamples = typicalStat?.samples ?? 0;
  const typicalLabel = typicalStat?.label ?? bedLabel;
  const areaName = quick?.area?.name ?? 'this area';
  if (tracked) {
    const diff = typical ? Math.round(((tracked.annualRevenue - typical) / typical) * 100) : null;
    const diffText = diff === null ? `No area average for a ${bedLabel} here to compare against.` : diff >= 0 ? `${diff}% above a typical ${typicalLabel} here.` : `${Math.abs(diff)}% below a typical ${typicalLabel} here.`;
    const sentence = `${diffText} Booked ${Math.round(tracked.occupancy * 100)}% of nights at ${absGbp(tracked.adr)}, with ${tracked.reviewCount} reviews. A benchmark for what a well-run ${bedLabel} in ${areaName} can do.` + limitedNote(quick);
    return {
      tone: 'info',
      chip: VERDICT_CHIPS.info,
      headline: `Earning about ${absGbp(tracked.annualRevenue)} a year`,
      sentence,
      track: typical ? { min: 0, max: Math.ceil((Math.max(tracked.annualRevenue, typical) * 1.3) / 10000) * 10000, target: typical, me: tracked.annualRevenue, unit: 'gbpk', targetLabel: `Area ${typicalLabel} ${gbpK(typical)}` } : null,
      keys: [
        { label: 'This listing', value: absGbp(tracked.annualRevenue), sub: 'trailing 12 months, tracked' },
        { label: `Area typical ${typicalLabel}`, value: typical ? absGbp(typical) : '—', sub: typical ? `${typicalSamples} reports` : 'no area figure yet' },
        { label: 'Rate and occupancy', value: `${absGbp(tracked.adr)} · ${Math.round(tracked.occupancy * 100)}%`, sub: 'a night · of nights booked' },
        licensingKey(quick),
      ],
      ceiling: `Nothing to buy or rent here: use it to price a ${bedLabel} of your own nearby.`,
      number: absGbp(tracked.annualRevenue),
      numberLabel: 'earns / yr',
    };
  }
  const est = quick?.estimate ?? null;
  if (!est) return unknownVerdict(input);
  const comps = quick?.competitors?.summary ?? null;
  return {
    tone: 'info',
    chip: VERDICT_CHIPS.info,
    headline: `A ${bedLabel} like this earns about ${absGbp(est.grossRevenue)} a year`,
    sentence: `${est.note}. ${quick?.trackedMissing ? 'Our data partner does not track this listing, so this is the area figure, not its own.' : 'This is the area figure, not the listing’s own.'}` + limitedNote(quick),
    track: null,
    keys: [
      { label: 'Est. revenue', value: absGbp(est.grossRevenue), sub: rateLine(quick) || 'a year, gross' },
      { label: 'Rate and occupancy', value: `${est.adr ? absGbp(est.adr) : '—'} · ${est.occupancy === null ? '—' : `${Math.round(est.occupancy)}%`}`, sub: 'a night · of nights booked' },
      { label: 'Competition nearby', value: comps ? String(comps.count) : '—', sub: comps?.medianRevenue ? `tracked within 1 km · median ${gbpK(comps.medianRevenue)}` : 'tracked Airbnbs within 1 km' },
      licensingKey(quick),
    ],
    ceiling: `Nothing to buy or rent here: use it to price a ${bedLabel} of your own nearby.`,
    number: absGbp(est.grossRevenue),
    numberLabel: 'est. / yr',
  };
}

function unknownVerdict(input: DealVerdictInput): Verdict {
  const est = input.quick?.estimate ?? null;
  if (est) {
    // A figure but no price to test it against (POA, or a listing without a price).
    return {
      tone: 'info',
      chip: VERDICT_CHIPS.info,
      headline: `Earns about ${absGbp(est.grossRevenue)} a year here`,
      sentence: `${est.note}. No ${input.kind === 'rent' ? 'rent' : 'price'} on the listing, so there is no deal to test; add one in the full report.` + limitedNote(input.quick),
      track: null,
      keys: [{ label: 'Est. revenue', value: absGbp(est.grossRevenue), sub: rateLine(input.quick) || 'a year, gross' }, licensingKey(input.quick)],
      ceiling: null,
      number: absGbp(est.grossRevenue),
      numberLabel: 'est. / yr',
    };
  }
  return {
    tone: 'unknown',
    chip: VERDICT_CHIPS.unknown,
    headline: 'Not enough data yet',
    sentence: 'We have no revenue figures for this postcode yet. A full report runs live comparables for the exact address.' + limitedNote(input.quick),
    track: null,
    keys: input.quick?.area ? [licensingKey(input.quick)] : [],
    ceiling: null,
    number: '—',
    numberLabel: 'no estimate',
  };
}

/** The verdict for a checked listing. Never throws; degrades to "not enough data". */
export function dealVerdict(input: DealVerdictInput): Verdict {
  const deal = input.deal ?? input.quick?.deal ?? null;
  if (input.kind === 'str') return strVerdict(input);
  if (deal?.kind === 'purchase') return purchaseVerdict(input, deal);
  if (deal?.kind === 'rent-to-rent') return rentVerdict(input, deal);
  return unknownVerdict(input);
}

// ── Areas ──

export interface AreaVerdictInput {
  name: string;
  code: string;
  bedroom: number | null;
  /** Figures for the bedroom count in play (or the area headline). */
  grossRevenue: number | null;
  occupancy: number | null;
  yieldPct: number | null;
  samples: number;
  grade: string | null;
  gradeLabel: string | null;
  competition: 'Open' | 'Moderate' | 'Busy' | 'Saturated' | null;
  directBooking: 'Low' | 'Moderate' | 'Strong' | null;
  licensing: { status: 'confirmed-licensed' | 'confirmed-unrestricted' | 'unconfirmed'; headline: string; regionLabel: string };
  trend: Direction | null;
  /** The member's fit, when goals exist. */
  fit: { score: number; inBudget: boolean | null; hasBedrooms: boolean | null; inRange: boolean | null; distanceMiles: number | null } | null;
  targetYieldPct: number | null;
}

export interface AreaVerdict extends Verdict {
  /** Up to three short reasons for the list row. */
  reasons: string[];
  fit: number | null;
}

export function areaVerdict(a: AreaVerdictInput): AreaVerdict {
  const warn: string[] = [];
  const good: string[] = [];
  const f = a.fit;
  if (f) {
    if (f.inBudget === true) good.push('Fits your budget');
    if (f.inBudget === false) warn.push('Over your budget');
    if (f.inRange === true && f.distanceMiles !== null) good.push(`${f.distanceMiles} mi from home`);
    if (f.inRange === false) warn.push(`${f.distanceMiles ?? '?'} mi, beyond your range`);
    if (f.hasBedrooms === false) warn.push('No data for your bedrooms');
  }
  if (a.yieldPct !== null && a.targetYieldPct) {
    if (a.yieldPct >= a.targetYieldPct) good.push(`${a.yieldPct.toFixed(1)}% yield, over your ${a.targetYieldPct}% target`);
    else warn.push(`Yield under your ${a.targetYieldPct}%`);
  }
  if (a.licensing.status === 'confirmed-licensed') warn.push('Licence required');
  else if (a.licensing.status === 'confirmed-unrestricted') good.push('No licence needed');
  if (a.competition === 'Open') good.push('Quiet competition');
  if (a.competition === 'Busy' || a.competition === 'Saturated') warn.push('Busy market');
  if (a.trend === 'up') good.push('Rising enquiries');
  if (a.trend === 'down') warn.push('Enquiries falling');
  if (a.directBooking === 'Strong') good.push('Strong direct bookings');
  const reasons = [...warn, ...good].slice(0, 3);

  const bedLabel = a.bedroom ? `${a.bedroom}-bed` : 'property';
  const figures = a.grossRevenue ? `A typical ${bedLabel} here grosses ${absGbp(a.grossRevenue)} a year${a.occupancy !== null ? ` at ${Math.round(a.occupancy)}% occupancy` : ''}${a.yieldPct !== null ? `, a ${a.yieldPct.toFixed(1)}% yield on average prices` : ''}.` : 'Not enough reports yet for a typical revenue figure.';

  let tone: VerdictTone;
  let headline: string;
  if (f) {
    // Same bands as the fit grade shown beside it: A/B fits, C is partial, D/E does not.
    const grade = gradeFor(f.score).grade;
    tone = grade === 'A' || grade === 'B' ? 'works' : grade === 'C' ? 'tight' : 'no';
    headline = tone === 'works' ? `${a.name} fits your goals` : tone === 'tight' ? `${a.name} is a partial fit` : `${a.name} doesn’t fit your goals`;
  } else {
    tone = 'info';
    headline = a.gradeLabel ? `${a.name}: ${a.gradeLabel.toLowerCase()} market` : a.name;
  }
  const sentence = `${reasons.length ? reasons.join('. ') + '. ' : ''}${figures}`;
  const yieldTone: VerdictTone | undefined = a.yieldPct !== null && a.targetYieldPct ? (a.yieldPct >= a.targetYieldPct ? 'works' : a.yieldPct >= a.targetYieldPct * 0.8 ? 'tight' : 'no') : undefined;
  return {
    tone,
    chip: f ? VERDICT_CHIPS[tone] : a.grade ?? '—',
    headline,
    sentence,
    track: null,
    keys: [
      { label: `Typical ${bedLabel} revenue`, value: a.grossRevenue ? absGbp(a.grossRevenue) : '—', sub: `${a.occupancy !== null ? `${Math.round(a.occupancy)}% occupied · ` : ''}${a.samples} report${a.samples === 1 ? '' : 's'}` },
      { label: 'Gross yield', value: a.yieldPct !== null ? `${a.yieldPct.toFixed(1)}%` : '—', sub: a.yieldPct !== null ? `on the average ${bedLabel} price` : 'no property-value data', tone: yieldTone },
      { label: 'Competition', value: a.competition ?? '—', sub: a.directBooking ? `${a.directBooking.toLowerCase()} direct-booking potential` : 'no direct-booking data' },
      { label: 'Licensing', value: a.licensing.status === 'confirmed-unrestricted' ? 'None required' : a.licensing.status === 'confirmed-licensed' ? 'Licence needed' : 'Unconfirmed', sub: a.licensing.regionLabel, tone: a.licensing.status === 'confirmed-licensed' ? 'tight' : undefined },
    ],
    ceiling: a.trend ? `${trendLabel(a.trend)} over the last six months.` : null,
    number: a.yieldPct !== null ? `${a.yieldPct.toFixed(1)}%` : a.grossRevenue ? gbpK(a.grossRevenue) : '—',
    numberLabel: a.yieldPct !== null ? `yield${a.grade ? ` · ${a.grade}` : ''}` : a.grossRevenue ? 'rev / yr' : 'no data',
    reasons,
    fit: f?.score ?? null,
  };
}
