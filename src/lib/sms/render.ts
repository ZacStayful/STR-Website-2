/**
 * The SMS renderer: Batch 6's changes on tracked deals (ChangeInput, from the
 * channel-neutral message builder's model) as ONE text of at most 160 plain
 * GSM-7 characters.
 *
 * One change is one sentence:
 *
 *   Stayful: price drop on the 2 bed flat you kept in Leeds: now £1,050 pcm (was £1,150).
 *   intelligence.stayful.co.uk/my-deals
 *   Reply STOP to opt out
 *
 * Several are a count, the link to My deals, then a short line each, most
 * important first, and "+N more" for what does not fit:
 *
 *   Stayful: 3 deal updates
 *   intelligence.stayful.co.uk/my-deals
 *   Price drop: 2 bed flat, Leeds, now £1,050 pcm
 *   Gone: 3 bed, York, under offer
 *   +1 more
 *   Reply STOP to opt out
 *
 * Never an address, a postcode or a listing link, whether or not the member
 * opened the deal: only bedrooms and type, town, prices and our own link to
 * My deals (which applies the site's own access rules). ChangeInput.address
 * is never read here.
 *
 * Every piece is shortened before anything is cut: the figure goes first,
 * then the old price, then the type, then the town. A text that still does
 * not fit is not sent.
 *
 * Pure: no network, no database, no server-only.
 */
import type { ChangeInput } from '../notify/message.ts';
import { formatListingPrice } from '../listing/format.ts';
import { fitsOneSegment, gsmLength, isGsm, MAX_SMS_LENGTH, OPT_OUT_LINE, toGsm } from './gsm.ts';

/** The link in every alert text: My deals on our own site, without the scheme (phones link it anyway, and it saves 8 characters). */
export function myDealsLink(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '').replace(/^https?:\/\//, '')}/my-deals`;
}

/** Plain GSM-7 text, or null when the value cannot be made plain. */
function plain(value: string | null | undefined): string | null {
  const v = toGsm((value ?? '').trim()).replace(/\s+/g, ' ');
  return v && isGsm(v) ? v : null;
}

/** "2 bed flat": the type without its tenure ("2 bed flat · leasehold"). */
function typeOf(c: Pick<ChangeInput, 'type'>): string | null {
  const head = (c.type ?? '').split('·')[0];
  return plain(head);
}

function townOf(c: Pick<ChangeInput, 'town'>): string | null {
  return plain(c.town);
}

/** Rents in full ("£1,050 pcm"); sale prices short ("£185k"). */
function price(amount: number | null | undefined, period: string | null | undefined): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  const p = period ?? 'total';
  return plain(formatListingPrice({ amount, period: p }, p === 'total'));
}

/** "£1,150": the amount alone, for "(was £1,150)" after a price that already said pcm. */
function amountOnly(amount: number | null | undefined, period: string | null | undefined): string | null {
  return price(amount, period)?.replace(/ (pcm|pw)$/, '') ?? null;
}

/** "£9,800" → "£9.8k". */
function compactMoney(digits: string): string {
  const n = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(n)) return `£${digits}`;
  return n >= 1000 ? `£${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : `£${Math.round(n)}`;
}

/**
 * The figure at the new price, in a few words: "profit now £9.8k/yr" for a
 * rent-to-rent, "+42% vs a long let" for a purchase, the pipeline row's own
 * yield or margin otherwise. Null when Batch 6 had no figure at that price.
 */
function figurePhrase(c: Pick<ChangeInput, 'figure' | 'kind'>): string | null {
  const f = toGsm(c.figure ?? '');
  if (!f.trim()) return null;
  const money = f.match(/£([\d,]+(?:\.\d+)?)\/yr/);
  if (c.kind === 'rent' && money) return `profit now ${compactMoney(money[1])}/yr`;
  const uplift = f.match(/\+\d+%/);
  if (uplift) return `${uplift[0]} vs a long let`;
  if (/gross yield|margin/.test(f)) return plain(f);
  return null;
}

/** "kept" for a deal they only kept (watching), "track" once it has moved on. */
function own(c: Pick<ChangeInput, 'stage'>): string {
  return (c.stage ?? 'watching') === 'watching' ? 'kept' : 'track';
}

const GONE: Record<string, { sentence: string; short: string }> = {
  under_offer: { sentence: 'now under offer', short: 'under offer' },
  sold: { sentence: 'now sold', short: 'sold' },
  let_agreed: { sentence: 'now let agreed', short: 'let agreed' },
  removed: { sentence: 'no longer listed', short: 'off the market' },
};

const PREVIOUS: Record<string, string> = { under_offer: 'under offer', sold: 'sold', let_agreed: 'let agreed', removed: 'off the market' };

/** A change the renderer can say something true about. */
export function renderable(c: ChangeInput): boolean {
  switch (c.alertType) {
    case 'price_drop':
      return price(c.newAmount, c.period) !== null && price(c.oldAmount, c.period) !== null && Number(c.newAmount) < Number(c.oldAmount);
    case 'back_on_market':
      return true;
    case 'nearly_gone':
      return Math.floor(Number(c.watchers ?? 0)) >= 3;
    case 'gone':
      return Boolean(c.status && GONE[c.status]);
  }
}

// ── One change: a sentence, from most to least detail ──

function sentences(c: ChangeInput): string[] {
  const type = typeOf(c);
  const town = townOf(c);
  const who = own(c);
  // "the 2 bed flat you kept in Leeds" → "the 2 bed flat you kept" → "a deal you kept in Leeds" → "a deal you kept"
  const subjects = [
    type && town ? `the ${type} you ${who} in ${town}` : null,
    type ? `the ${type} you ${who}` : null,
    town ? `a deal you ${who} in ${town}` : null,
    `a deal you ${who}`,
  ].filter((x): x is string => Boolean(x));
  const figure = figurePhrase(c);
  const out: string[] = [];
  for (const s of subjects) {
    switch (c.alertType) {
      case 'price_drop': {
        const now = price(c.newAmount, c.period)!;
        const was = amountOnly(c.oldAmount, c.period)!;
        if (figure) out.push(`price drop on ${s}: now ${now} (was ${was}). ${figure[0].toUpperCase()}${figure.slice(1)}.`);
        out.push(`price drop on ${s}: now ${now} (was ${was}).`);
        out.push(`price drop on ${s}: now ${now}.`);
        break;
      }
      case 'back_on_market': {
        const now = price(c.newAmount, c.period);
        const was = c.previousStatus ? PREVIOUS[c.previousStatus] : null;
        const cap = s[0].toUpperCase() + s.slice(1);
        if (now && was) out.push(`${cap} is back on the market at ${now}. It was ${was}.`);
        if (now) out.push(`${cap} is back on the market at ${now}.`);
        out.push(`${cap} is back on the market.`);
        break;
      }
      case 'nearly_gone': {
        const n = Math.floor(Number(c.watchers ?? 0));
        const cap = s[0].toUpperCase() + s.slice(1);
        out.push(`${cap} is getting attention: ${n} others opened or kept it this week.`);
        out.push(`${cap} is getting attention.`);
        break;
      }
      case 'gone': {
        const cap = s[0].toUpperCase() + s.slice(1);
        out.push(`${cap} is ${GONE[c.status!].sentence}.`);
        break;
      }
    }
  }
  return out;
}

// ── Several changes: a short line each, from most to least detail ──

/** "2 bed" from "2 bed flat": the shortest way to tell two deals in one town apart. */
function bedsOf(type: string | null): string | null {
  const m = type?.match(/^\d+ bed\b/);
  return m ? m[0] : null;
}

function briefs(c: ChangeInput): string[] {
  const type = typeOf(c);
  const beds = bedsOf(type);
  const town = townOf(c);
  const what = [...new Set([type && town ? `${type}, ${town}` : null, beds && town ? `${beds}, ${town}` : null, town, type, beds].filter((x): x is string => Boolean(x)))];
  const label = { price_drop: 'Price drop', back_on_market: 'Back on market', nearly_gone: 'Getting attention', gone: 'Gone' }[c.alertType];
  // The news (new price, what it went to) outlasts the description: every
  // shorter description is tried with it before any is tried without.
  const detail = c.alertType === 'price_drop' ? `now ${price(c.newAmount, c.period)}` : c.alertType === 'gone' ? GONE[c.status!].short : c.alertType === 'back_on_market' ? price(c.newAmount, c.period) : null;
  const detailed = detail ? [...what.map((w) => `${label}: ${w}, ${detail}`), `${label}, ${detail}`] : [];
  const bare = what.map((w) => `${label}: ${w}`);
  return [...detailed, ...bare, label];
}

export interface RenderedText {
  body: string;
  /** Every change the text counts (described, or in "+N more"): recorded as texted, never texted again. */
  counted: ChangeInput[];
  /** The ones it describes. */
  described: ChangeInput[];
}

const assemble = (lines: string[]) => lines.join('\n');
const fits = (body: string) => fitsOneSegment(body) && body.endsWith(OPT_OUT_LINE);

/**
 * The text for these changes, already in order of importance, or null when
 * there is nothing true to say or nothing that fits. `link` is myDealsLink().
 */
export function renderSmsText(changes: readonly ChangeInput[], link: string): RenderedText | null {
  const usable = changes.filter(renderable);
  const safeLink = plain(link);
  if (usable.length === 0 || !safeLink) return null;

  if (usable.length === 1) {
    const c = usable[0];
    for (const s of sentences(c)) {
      const body = assemble([`Stayful: ${s}`, safeLink, OPT_OUT_LINE]);
      if (fits(body)) return { body, counted: [c], described: [c] };
    }
    return null;
  }

  const head = [`Stayful: ${usable.length} deal updates`, safeLink];
  const tail = [OPT_OUT_LINE];
  const described: ChangeInput[] = [];
  const lines: string[] = [];
  for (let i = 0; i < usable.length; i++) {
    const restAfter = usable.length - (i + 1);
    let placed = false;
    for (const b of briefs(usable[i])) {
      const trial = [...head, ...lines, b, ...(restAfter > 0 ? [`+${restAfter} more`] : []), ...tail];
      if (fits(assemble(trial))) {
        lines.push(b);
        described.push(usable[i]);
        placed = true;
        break;
      }
    }
    if (!placed) break;
  }
  const more = usable.length - described.length;
  const body = assemble([...head, ...lines, ...(more > 0 ? [`+${more} more`] : []), ...tail]);
  if (!fits(body)) return null;
  return { body, counted: [...usable], described };
}

/** For tests and the dry run: the text's length in GSM-7 characters. */
export function textLength(body: string): number {
  return gsmLength(body) ?? MAX_SMS_LENGTH + 1;
}
