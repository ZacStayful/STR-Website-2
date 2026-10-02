/**
 * Batch 22e, Part D: "Emailed <date>" on a Browse card. No new storage: the
 * daily email already records the deals it carried (notification_sends.summary:
 * teasers, the per-profile parts' teasers and the pick's deal), all
 * marketplace_deals ids, the same id a card has; an alert email marks its
 * deal_alerts rows with the send (send_id, notified_at). Only a send that
 * actually went (status 'sent') counts: a claimed, sending or failed one
 * never did.
 *
 * Pure: no network, no database, no server-only.
 */

export interface SendRow {
  id: string;
  status: string;
  /** sent_at, else the send's day. */
  sentAt: string | null;
  day: string | null;
  summary: unknown;
}

export interface AlertRow {
  dealId: string | null;
  sendId: string | null;
  notifiedAt: string | null;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Every deal id a send's summary says it carried. */
export function dealIdsInSend(summary: unknown): string[] {
  if (!summary || typeof summary !== 'object') return [];
  const s = summary as { teasers?: unknown; parts?: unknown; pickDealId?: unknown };
  const out = new Set(strings(s.teasers));
  for (const part of Array.isArray(s.parts) ? s.parts : []) {
    if (part && typeof part === 'object') for (const id of strings((part as { teasers?: unknown }).teasers)) out.add(id);
  }
  if (typeof s.pickDealId === 'string' && s.pickDealId) out.add(s.pickDealId);
  return [...out];
}

const dateOf = (send: Pick<SendRow, 'sentAt' | 'day'>): string | null => {
  if (send.sentAt && Number.isFinite(Date.parse(send.sentAt))) return send.sentAt;
  return send.day ? `${send.day}T12:00:00Z` : null;
};

/** The latest date each of `dealIds` was emailed to the member, from sent sends and sent alert emails only. */
export function emailedDates(dealIds: readonly string[], sends: readonly SendRow[], alerts: readonly AlertRow[]): Map<string, string> {
  const wanted = new Set(dealIds);
  const out = new Map<string, string>();
  const note = (id: string, at: string | null) => {
    if (!at || !wanted.has(id)) return;
    const prev = out.get(id);
    if (!prev || Date.parse(at) > Date.parse(prev)) out.set(id, at);
  };
  const sent = new Map<string, SendRow>();
  for (const s of sends) {
    if (s.status !== 'sent') continue;
    sent.set(s.id, s);
    for (const id of dealIdsInSend(s.summary)) note(id, dateOf(s));
  }
  for (const a of alerts) {
    if (!a.dealId || !a.sendId || !a.notifiedAt) continue;
    const s = sent.get(a.sendId);
    if (!s) continue;
    note(a.dealId, dateOf(s) ?? a.notifiedAt);
  }
  return out;
}

/** "Emailed 2 Oct" (UK date). */
export function emailedLabel(at: string): string {
  return `Emailed ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(at))}`;
}
