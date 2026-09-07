/**
 * Weekly trend-alert digest: which of a member's saved areas changed since
 * the last digest. Pure — the route feeds it data and sends the result.
 *
 * A "change" is either the enquiry trend flipping (up / flat / down /
 * insufficient) or the confidence tier crossing into Confirmed. Nothing
 * changed → no email.
 */

import type { AreaCardData } from './explorer.ts';
import type { AreaTrend } from './trend.ts';
import { formatMonth } from './trend.ts';

export interface SavedAreaState {
  postcode_area: string;
  last_alerted_direction: string | null;
  last_alerted_tier: string | null;
}

export interface AlertChange {
  code: string;
  name: string;
  direction: AreaTrend['enquiries']['direction'];
  previousDirection: string | null;
  tier: string;
  previousTier: string | null;
  deltaPct: number | null;
  since: string | null;
  becameConfirmed: boolean;
  trendChanged: boolean;
}

export function digestChanges(
  saved: SavedAreaState[],
  cards: Map<string, AreaCardData>,
  trends: Map<string, AreaTrend | null>,
): AlertChange[] {
  const out: AlertChange[] = [];
  for (const s of saved) {
    const card = cards.get(s.postcode_area);
    if (!card) continue;
    const t = trends.get(s.postcode_area) ?? null;
    const direction = t?.enquiries.direction ?? 'insufficient';
    const tier = card.confidence.tier;
    const trendChanged = s.last_alerted_direction !== null && s.last_alerted_direction !== direction && direction !== 'insufficient';
    const becameConfirmed = tier === 'confirmed' && s.last_alerted_tier !== null && s.last_alerted_tier !== 'confirmed';
    if (!trendChanged && !becameConfirmed) continue;
    out.push({
      code: card.code,
      name: card.name,
      direction,
      previousDirection: s.last_alerted_direction,
      tier,
      previousTier: s.last_alerted_tier,
      deltaPct: t?.enquiries.deltaPct ?? null,
      since: t?.since ?? null,
      becameConfirmed,
      trendChanged,
    });
  }
  return out;
}

function line(c: AlertChange): string {
  const parts: string[] = [];
  if (c.trendChanged) {
    const pct = c.deltaPct === null ? '' : ` (${c.deltaPct > 0 ? '+' : ''}${Math.round(c.deltaPct * 100)}%)`;
    const word = (d: string | null) => (d === 'up' ? 'rising' : d === 'down' ? 'falling' : d === 'flat' ? 'steady' : 'not enough data');
    parts.push(`enquiries now ${word(c.direction)}${pct}, previously ${word(c.previousDirection)}`);
  }
  if (c.becameConfirmed) parts.push('now backed by enough reports to be Confirmed');
  return `${c.name} (${c.code}): ${parts.join('; ')}${c.since ? ` — tracking since ${formatMonth(c.since)}` : ''}`;
}

/** A pipeline listing that moved in the last week (from the daily re-check), for the Monday digest. */
export interface ListingWeekChange {
  id: string;
  label: string; // address or title
  summary: string; // e.g. "price down from £220,000 to £210,000 (−4.5%)"
}

export function digestEmail(changes: AlertChange[], siteUrl: string, listingChanges: ListingWeekChange[] = []): { subject: string; text: string; html: string } {
  const subject =
    changes.length === 0
      ? `Market Explorer: ${listingChanges.length} of your listings moved this week`
      : changes.length === 1
        ? `Market Explorer: ${changes[0].name} has changed`
        : `Market Explorer: ${changes.length} of your saved areas have changed`;
  const items = changes.map(line);
  const text = [
    'Your weekly Market Explorer update from Stayful.',
    '',
    ...items.map((i) => `• ${i}`),
    ...(listingChanges.length > 0 ? ['', 'Listings in your pipeline this week:', ...listingChanges.map((l) => `• ${l.label}: ${l.summary} — ${siteUrl}/markets?pane=listings&listing=${encodeURIComponent(l.id)}`)] : []),
    '',
    `Open the explorer: ${siteUrl}/markets`,
    `Manage alerts in your goals: ${siteUrl}/markets`,
  ].join('\n');
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const areasHtml = changes.length > 0 ? `<ul style="padding-left:18px">${changes.map((c) => `<li style="margin:8px 0"><a href="${siteUrl}/markets/${esc(c.code.toLowerCase())}" style="color:#2e3d2b">${esc(line(c))}</a></li>`).join('')}</ul>` : '';
  const listingsHtml =
    listingChanges.length > 0
      ? `<h2 style="font-size:16px;margin:18px 0 6px">Listings in your pipeline this week</h2><ul style="padding-left:18px">${listingChanges.map((l) => `<li style="margin:8px 0"><a href="${esc(`${siteUrl}/markets?pane=listings&listing=${encodeURIComponent(l.id)}`)}" style="color:#2e3d2b"><strong>${esc(l.label)}</strong>: ${esc(l.summary)}</a></li>`).join('')}</ul>`
      : '';
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.55;color:#2e3d2b;max-width:560px">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5d8156;font-weight:600">Stayful Market Explorer</p>
      <h1 style="font-size:22px;margin:0 0 14px">${changes.length > 0 ? 'Your saved areas moved this week' : 'Your pipeline moved this week'}</h1>
      ${areasHtml}
      ${listingsHtml}
      <p style="margin:22px 0"><a href="${siteUrl}/markets" style="display:inline-block;background:#5d8156;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:600">Open the Market Explorer</a></p>
      <p style="color:#7a8274;font-size:12px">You get this because you saved these areas or listings. Turn alerts off under “Edit goals” in the explorer.</p>
    </div>`.trim();
  return { subject, text, html };
}
