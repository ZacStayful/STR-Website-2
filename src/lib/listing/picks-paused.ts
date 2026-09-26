/**
 * "Your picks have paused": the letter a member gets when the daily-picks
 * run found them a property but their credit could not cover it.
 *
 * The run records each such miss (sourcing_missed); the paused cron reads
 * them back and this module decides whether a letter is due and what it
 * says. Pure, so the rules are tested: the run and the cron only call it.
 *
 * Rules (from the brief): send on the first day picks pause, then at most
 * once every seven days while they stay out of credit, each time listing
 * everything missed since the last letter; stop as soon as they have credit
 * again. A letter never shows the address, postcode or listing link — the
 * member did not pay for that pick.
 */
import { escapeHtml as esc } from '../email/escape.ts';
import { manageNotificationsUrl } from '../url.ts';
import { formatListingPrice } from './format.ts';
import { rentPcm, type SourcedListing } from './sourcing.ts';
import type { Screening } from './screen.ts';

export const PAUSED_EMAIL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** One pick the member missed, as stored. Never carries the address, postcode or URL. */
export interface MissedPick {
  id?: string;
  missedAt: string;
  kind: 'sale' | 'rent';
  areaName: string;
  bedrooms: number | null;
  /** Sale: asking price; rent: pcm. */
  priceAmount: number | null;
  pricePeriod: 'total' | 'pcm' | null;
  /** The screening's annual surplus over a long let (purchase) or after rent (rent-to-rent), £/yr. */
  annualProfit: number | null;
  emailedAt?: string | null;
}

/** The sourcing_missed row for a candidate the run could not send. Only figures; nothing that identifies the listing. */
export function missedRowFor(listing: SourcedListing, screening: Screening | null | undefined): { canonical_url: string; kind: 'sale' | 'rent'; postcode_area: string | null; bedrooms: number | null; price_amount: number | null; price_period: 'total' | 'pcm' | null; annual_profit: number | null } {
  const pcm = listing.kind === 'rent' ? rentPcm(listing.price) : null;
  const total = listing.kind === 'sale' && listing.price?.period === 'total' ? listing.price.amount : null;
  return {
    canonical_url: listing.canonicalUrl,
    kind: listing.kind,
    postcode_area: listing.postcodeArea ?? null,
    bedrooms: listing.bedrooms ?? null,
    price_amount: listing.kind === 'rent' ? pcm : total,
    price_period: listing.kind === 'rent' ? (pcm === null ? null : 'pcm') : total === null ? null : 'total',
    annual_profit: screening?.surplus ?? null,
  };
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Is a letter due now? Yes when none has ever been sent; when a pick has
 * gone out since the last one (credit came back, then ran out again: a new
 * first day); or when the last one is at least seven days old.
 */
export function pausedEmailDue(input: { lastEmailAt: string | null; lastPickSentAt: string | null; now: Date }): boolean {
  const last = time(input.lastEmailAt);
  if (last === null) return true;
  const pick = time(input.lastPickSentAt);
  if (pick !== null && pick > last) return true;
  return input.now.getTime() - last >= PAUSED_EMAIL_INTERVAL_MS;
}

/**
 * Which un-emailed misses belong in the next letter: those after the last
 * pick actually sent. Anything older predates a pick that went out, so the
 * member was not paused then — it is superseded, and never resurfaces.
 */
export function missesToList(misses: MissedPick[], lastPickSentAt: string | null): { list: MissedPick[]; superseded: MissedPick[] } {
  const pick = time(lastPickSentAt);
  const list: MissedPick[] = [];
  const superseded: MissedPick[] = [];
  for (const m of misses) {
    if (m.emailedAt) continue;
    const at = time(m.missedAt) ?? 0;
    if (pick !== null && at <= pick) superseded.push(m);
    else list.push(m);
  }
  list.sort((a, b) => (time(a.missedAt) ?? 0) - (time(b.missedAt) ?? 0));
  return { list, superseded };
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

export function missedPickLine(m: MissedPick): string {
  const type = m.kind === 'rent' ? 'Rent-to-rent' : 'Purchase';
  const size = m.bedrooms ? `${m.bedrooms}-bed` : null;
  const price = m.priceAmount !== null && m.pricePeriod ? formatListingPrice({ amount: m.priceAmount, period: m.pricePeriod }) : 'price not stated';
  const profit = m.annualProfit !== null ? `est. profit ${gbp(m.annualProfit)}/yr` : 'profit not estimated';
  return [m.areaName, [size, type].filter(Boolean).join(' '), price, profit].join(' · ');
}

function dayWords(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

export interface PausedEmailInput {
  misses: MissedPick[];
  siteUrl: string;
  firstName?: string | null;
  /**
   * Anything else due today, already rendered (src/lib/notify): the changes
   * on deals the member tracks. The letter goes instead of the daily email,
   * so what that email would have carried rides here rather than being lost.
   */
  extra?: { text: string; html: string; subjectSuffix?: string | null } | null;
}

/** The letter itself: plain, one button. */
export function pausedEmail(input: PausedEmailInput): { subject: string; text: string; html: string } {
  const base = input.siteUrl.replace(/\/$/, '');
  const topUp = `${base}/account/billing`;
  const manage = manageNotificationsUrl(base);
  const n = input.misses.length;
  const baseSubject = n === 1 ? 'Your daily picks have paused: 1 pick you missed' : `Your daily picks have paused: ${n} picks you missed`;
  const subject = input.extra?.subjectSuffix ? `${baseSubject} · ${input.extra.subjectSuffix}` : baseSubject;
  const hi = input.firstName ? `Hi ${input.firstName},` : 'Hi,';
  const since = input.misses[0] ? dayWords(input.misses[0].missedAt) : '';
  const lines = input.misses.map(missedPickLine);
  const text = [
    hi,
    '',
    'Your daily picks have paused because your credit ran out. A pick costs a few pence, so rather than run your balance further down we stop sending them until you top up.',
    '',
    n === 1 ? `Here is the pick we found for you${since ? ` on ${since}` : ''} and could not send:` : `Here are the picks we found for you${since ? ` since ${since}` : ''} and could not send:`,
    '',
    ...lines.map((l) => `• ${l}`),
    '',
    `Top up and picks start again with tomorrow morning's run: ${topUp}`,
    '',
    'Figures are Stayful estimates for the area and size of property. The address and listing come with the pick itself.',
    '',
    ...(input.extra ? [input.extra.text, ''] : []),
    `Manage notifications: ${manage}`,
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#2e3d2b;max-width:560px">
      <p style="margin:0 0 14px">${esc(hi)}</p>
      <p style="margin:0 0 14px">Your daily picks have paused because your credit ran out. A pick costs a few pence, so rather than run your balance further down we stop sending them until you top up.</p>
      <p style="margin:0 0 6px">${esc(n === 1 ? `Here is the pick we found for you${since ? ` on ${since}` : ''} and could not send:` : `Here are the picks we found for you${since ? ` since ${since}` : ''} and could not send:`)}</p>
      <ul style="margin:0 0 18px;padding-left:18px">${lines.map((l) => `<li style="margin:4px 0">${esc(l)}</li>`).join('')}</ul>
      <p style="margin:0 0 18px"><a href="${esc(topUp)}" style="display:inline-block;background:#5d8156;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600">Top up</a></p>
      <p style="margin:0 0 14px;color:#5b6657;font-size:13px">Top up and picks start again with tomorrow morning&#8217;s run. Figures are Stayful estimates for the area and size of property; the address and listing come with the pick itself.</p>
      ${input.extra ? `<div style="margin:0 0 18px">${input.extra.html}</div>` : ''}
      <p style="margin:0;color:#7a8274;font-size:12px">Stayful Intelligence · <a href="${esc(manage)}" style="color:#7a8274">Manage notifications</a></p>
    </div>`.trim();
  return { subject, text, html };
}
