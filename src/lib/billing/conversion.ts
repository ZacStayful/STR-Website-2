/**
 * Free credit → first payment: how long members take to top up, and how many
 * never do.
 *
 * This is a different question from churn and, for now, the only one with data:
 * every member holds a welcome grant, and nobody has yet paid. Pure, like
 * churn.ts — conversion-server.ts does the reading.
 *
 * The sixty-day rule, as specified: sixty days is how long a member gets to
 * top up before we stop waiting. Past that they are DISCARDED — kept out of the
 * days-to-convert statistics rather than left sitting as a pending maybe — and
 * a member who tops up later still is an ANOMALY, reported on its own and never
 * folded into the headline.
 */

export const CONVERSION_WINDOW_DAYS = 60;

export interface Signup {
  userId: string;
  createdAt: string;
}

/** The member's first paid credit, whichever route they took. */
export interface FirstPayment {
  userId: string;
  at: string;
  /** 'topup' = one-off credit, 'plan' = went straight onto a subscription. */
  route: 'topup' | 'plan';
}

export type ConversionOutcome = 'converted' | 'pending' | 'discarded' | 'anomaly';

export interface MemberConversion {
  userId: string;
  signedUpAt: string;
  convertedAt: string | null;
  route: 'topup' | 'plan' | null;
  daysToConvert: number | null;
  ageDays: number;
  outcome: ConversionOutcome;
}

export interface ConversionBucket {
  key: string;
  label: string;
  members: number;
}

export interface ConversionFunnel {
  members: MemberConversion[];
  /** Signed up, not yet paid, still inside the sixty days. */
  pending: number;
  /** Paid within the sixty days. These are the only ones in the day stats. */
  converted: number;
  /** Sixty days gone, never paid. Out of the day stats by design. */
  discarded: number;
  /** Paid after day sixty. Reported apart, never in the headline. */
  anomalies: number;
  /**
   * Converted ÷ (converted + discarded) — the rate over members whose sixty
   * days are up, so it does not drift as new signups arrive. Null until at
   * least one member has had the full window.
   */
  settledPct: number | null;
  /** How many have had a full sixty days: the settled denominator. */
  settled: number;
  medianDaysToConvert: number | null;
  meanDaysToConvert: number | null;
  buckets: ConversionBucket[];
  byRoute: { route: 'topup' | 'plan'; members: number }[];
}

const BUCKETS: { key: string; label: string; max: number }[] = [
  { key: '0-7', label: 'Within a week', max: 7 },
  { key: '8-14', label: '8–14 days', max: 14 },
  { key: '15-30', label: '15–30 days', max: 30 },
  { key: '31-60', label: '31–60 days', max: CONVERSION_WINDOW_DAYS },
];

function wholeDays(from: string, to: string): number {
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

export function conversionFunnel(
  signups: Signup[],
  firstPayments: FirstPayment[],
  now: Date = new Date(),
): ConversionFunnel {
  const nowIso = now.toISOString();
  const paid = new Map<string, FirstPayment>();
  for (const p of firstPayments) {
    const seen = paid.get(p.userId);
    // Earliest payment wins: this is time to FIRST payment.
    if (!seen || p.at < seen.at) paid.set(p.userId, p);
  }

  const members: MemberConversion[] = [];
  for (const s of signups) {
    const payment = paid.get(s.userId) ?? null;
    const ageDays = wholeDays(s.createdAt, nowIso);
    if (payment) {
      const daysToConvert = wholeDays(s.createdAt, payment.at);
      members.push({
        userId: s.userId,
        signedUpAt: s.createdAt,
        convertedAt: payment.at,
        route: payment.route,
        daysToConvert,
        ageDays,
        outcome: daysToConvert <= CONVERSION_WINDOW_DAYS ? 'converted' : 'anomaly',
      });
      continue;
    }
    members.push({
      userId: s.userId,
      signedUpAt: s.createdAt,
      convertedAt: null,
      route: null,
      daysToConvert: null,
      ageDays,
      outcome: ageDays > CONVERSION_WINDOW_DAYS ? 'discarded' : 'pending',
    });
  }

  const converted = members.filter((m) => m.outcome === 'converted');
  const discarded = members.filter((m) => m.outcome === 'discarded').length;
  const anomalies = members.filter((m) => m.outcome === 'anomaly').length;
  const pending = members.filter((m) => m.outcome === 'pending').length;

  const dayValues = converted.map((m) => m.daysToConvert ?? 0);
  const buckets: ConversionBucket[] = BUCKETS.map((b, i) => {
    const min = i === 0 ? 0 : BUCKETS[i - 1].max + 1;
    return { key: b.key, label: b.label, members: dayValues.filter((d) => d >= min && d <= b.max).length };
  });

  const routes: ('topup' | 'plan')[] = ['topup', 'plan'];
  const settled = converted.length + discarded;

  return {
    members,
    pending,
    converted: converted.length,
    discarded,
    anomalies,
    settled,
    settledPct: settled === 0 ? null : Math.round((converted.length / settled) * 1000) / 10,
    medianDaysToConvert: median(dayValues),
    meanDaysToConvert: dayValues.length === 0 ? null : Math.round((dayValues.reduce((a, b) => a + b, 0) / dayValues.length) * 10) / 10,
    buckets,
    byRoute: routes.map((route) => ({ route, members: converted.filter((m) => m.route === route).length })),
  };
}
