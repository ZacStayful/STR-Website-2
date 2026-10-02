/**
 * Batch 23: /admin/calls' totals, from the rows it lists. Pure.
 *   calls        every row in the filter (blocked ones included)
 *   placed       outbound calls that rang (not queued, not blocked)
 *   answer rate  answered ÷ placed (outbound)
 *   minutes      answered seconds ÷ 60, both directions
 *   revenue      what members were charged (minutes, texts, fallback emails)
 *   raw cost     answered minutes at the unit row's raw cost, plus texts at
 *                Twilio's (an ESTIMATE: reconcile on /admin/billing)
 */
export interface CallTotalsRow {
  direction: string;
  status: string;
  seconds: number | null;
  charged_pence: number;
  texts_sent: number;
}

export interface CallTotals {
  calls: number;
  placed: number;
  answered: number;
  blocked: number;
  answerRate: number | null;
  minutes: number;
  revenuePence: number;
  rawCostPence: number;
}

export function callTotals(rows: readonly CallTotalsRow[], rawPerMinutePence: number, rawPerTextPence: number): CallTotals {
  let placed = 0;
  let answeredOut = 0;
  let answered = 0;
  let blocked = 0;
  let seconds = 0;
  let revenue = 0;
  let texts = 0;
  for (const r of rows) {
    if (r.status === 'blocked') blocked += 1;
    const rang = r.status !== 'blocked' && r.status !== 'queued';
    if (r.direction === 'outbound' && rang) {
      placed += 1;
      if (r.status === 'answered') answeredOut += 1;
    }
    if (r.status === 'answered') {
      answered += 1;
      seconds += Math.max(0, Number(r.seconds) || 0);
    }
    revenue += Number(r.charged_pence) || 0;
    texts += Number(r.texts_sent) || 0;
  }
  const minutes = seconds / 60;
  return {
    calls: rows.length,
    placed,
    answered,
    blocked,
    answerRate: placed > 0 ? answeredOut / placed : null,
    minutes: Math.round(minutes * 10) / 10,
    revenuePence: revenue,
    rawCostPence: Math.round((minutes * rawPerMinutePence + texts * rawPerTextPence) * 100) / 100,
  };
}
