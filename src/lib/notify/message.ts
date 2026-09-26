/**
 * One message builder for every capped member email: Today's 5, the
 * changes-only email, the picks-paused letter's changes, Your week.
 *
 * A message is plain data — sections of blocks (headings, lines, facts,
 * buttons, items), each item a few lines and one link — so Batch 8 can render
 * the same content as SMS. Nothing here is HTML; ./render-email.ts is the
 * only place markup is written.
 *
 * The privacy rules live here, where the content is decided, so no renderer
 * can get them wrong:
 *   - A teaser (a deal on the member's Today) is built from the grid's public
 *     columns only (DealCard): figure, price, town, type, motivation. It can
 *     never carry an address, a postcode or a listing link, and links to /today.
 *   - A change on a tracked deal names the address only when the member has
 *     opened the deal (B5's address rule, TrackedDeal.opened); otherwise town
 *     and type. It links to My deals or the deal sheet, never the listing.
 *   - For an account that has never paid, a teaser still inside the
 *     early-access window is dropped (a backstop: Today's own choice already
 *     leaves them out) and reported, so a mismatch is visible, never a leak.
 *   - Every number in a subject or a heading is counted from the items given.
 *
 * Pure: no network, no database, no server-only.
 */
import { describeType, headlineFigure, priceLine, type DealCard } from '../marketplace/grid.ts';
import { motivationLine } from '../marketplace/motivation-line.ts';
import { dealVisible } from '../marketplace/visibility.ts';
import { areaMetaForCode } from '../market/areas.ts';
import { formatListingPrice } from '../listing/format.ts';
import { manageNotificationsUrl } from '../url.ts';

// ── The data ──

export type MessageKind = 'todays_5' | 'deal_changes' | 'picks_paused' | 'your_week';

export interface Link {
  label: string;
  url: string;
  primary?: boolean;
}

export interface Item {
  title: string;
  lines: string[];
  link: Link | null;
}

export type Tone = 'normal' | 'muted' | 'strong' | 'accent' | 'callout' | 'small';

export type Block =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string; tone?: Tone }
  | { type: 'image'; url: string }
  | { type: 'facts'; rows: { label: string; value: string }[] }
  | { type: 'buttons'; links: Link[] }
  | { type: 'items'; items: Item[] };

export type SectionKey = 'pick' | 'teasers' | 'changes' | 'missed' | 'recap' | 'areas' | 'notice';

export interface Section {
  key: SectionKey;
  title: string | null;
  blocks: Block[];
}

export interface Unsubscribe {
  label: string;
  /** Where the link in the email goes (a page that confirms). */
  url: string;
  /** RFC 8058 one-click POST target, for the List-Unsubscribe header. */
  oneClickUrl: string;
}

export interface Message {
  kind: MessageKind;
  subject: string;
  /** The small line above everything: "Stayful · Today's 5". */
  eyebrow: string;
  sections: Section[];
  /** Why they get it, in one line. */
  reason: string;
  manageUrl: string;
  unsubscribe: Unsubscribe | null;
}

// ── Deals on Today ──

/** Town, or the area's name when the listing gave none. Never an outcode or a postcode. */
export function placeOf(card: Pick<DealCard, 'town' | 'postcode_area'>): string | null {
  if (card.town && card.town.trim()) return card.town.trim();
  return card.postcode_area ? areaMetaForCode(card.postcode_area).name : null;
}

/** "+42% · £8,400/yr over a long let" / "£6,100/yr · profit after rent". */
export function figureLine(card: Pick<DealCard, 'kind' | 'annual_profit' | 'uplift_pct'>): string | null {
  const f = headlineFigure(card);
  if (f.big === '—') return null;
  return `${f.big} · ${f.small}`;
}

/** One teaser: figure, price, town, type and motivation, linking to Today. Built from public columns only. */
export function teaserItem(card: DealCard, todayUrl: string, now: Date = new Date()): Item {
  const figure = figureLine(card);
  const first = [priceLine(card), placeOf(card)].filter((x): x is string => Boolean(x)).join(' · ');
  const type = describeType(card);
  const why = motivationLine({ kind: card.kind, motivation: card.motivation, price_history: card.price_history, listed_date: card.listed_date }, now);
  const kindWord = card.kind === 'rent' ? 'Rent-to-rent' : 'To buy';
  return {
    title: figure ?? kindWord,
    lines: [first, type ? `${kindWord} · ${type}` : kindWord, why.length > 0 ? why.join(' · ') : null].filter((x): x is string => Boolean(x)),
    link: { label: 'See it on Today', url: todayUrl },
  };
}

/**
 * The early-access backstop: the teasers a free account may see, and the ids
 * of any it may not (which should never happen — Today's own choice applies
 * the same rule — and is reported when it does).
 */
export function visibleTeasers(cards: DealCard[], freeCutoffIso: string | null): { kept: DealCard[]; dropped: string[] } {
  if (freeCutoffIso === null) return { kept: cards, dropped: [] };
  const kept: DealCard[] = [];
  const dropped: string[] = [];
  for (const c of cards) {
    if (dealVisible(c.live_since ?? null, freeCutoffIso)) kept.push(c);
    else dropped.push(c.id);
  }
  return { kept, dropped };
}

// ── Changes on tracked deals ──

export type AlertType = 'price_drop' | 'back_on_market' | 'nearly_gone' | 'gone';

/**
 * What the collector stored for one alert (deal_alerts.payload), plus its
 * type. `address` is only ever set when the member opened the deal; the
 * builder still checks `opened` before using it.
 */
export interface ChangeInput {
  id: string;
  /** Other alert ids this one stands for (collapsed price drops): marked sent with it. */
  mergedIds?: string[];
  alertType: AlertType;
  kind: 'sale' | 'rent';
  opened: boolean;
  address?: string | null;
  town?: string | null;
  type?: string | null;
  /** B5's stage key: 'watching' is Kept. */
  stage?: string | null;
  dealId?: string | null;
  checkedListingId?: string | null;
  oldAmount?: number | null;
  newAmount?: number | null;
  /** total | pcm (always normalised to pcm for rent). */
  period?: string | null;
  /** The profit figure at the NEW price, when it was computed at that price; null otherwise. */
  figure?: string | null;
  /** gone: what it went to. back_on_market: what it came back from. */
  status?: string | null;
  previousStatus?: string | null;
  /** nearly_gone: other accounts that opened or kept it in the last week. */
  watchers?: number | null;
}

const GONE_WORDS: Record<string, string> = {
  under_offer: 'now under offer',
  sold: 'now sold',
  let_agreed: 'now let agreed',
  removed: 'no longer listed',
};

const PREVIOUS_WORDS: Record<string, string> = {
  under_offer: 'under offer',
  sold: 'sold',
  let_agreed: 'let agreed',
  removed: 'off the market',
};

const money = (amount: number | null | undefined, period: string | null | undefined): string | null =>
  typeof amount === 'number' && Number.isFinite(amount) ? formatListingPrice({ amount, period: period ?? 'total' }) : null;

/** Where the deal lives on the site: the member's own My deals entry, else its sheet. Never the listing. */
export function changeLink(c: Pick<ChangeInput, 'dealId' | 'checkedListingId'>, siteUrl: string): Link {
  const base = siteUrl.replace(/\/$/, '');
  if (c.dealId) return { label: 'Open in My deals', url: `${base}/my-deals?focus=${encodeURIComponent(`d-${c.dealId}`)}` };
  if (c.checkedListingId) return { label: 'Open in My deals', url: `${base}/my-deals?focus=${encodeURIComponent(`l-${c.checkedListingId}`)}` };
  return { label: 'Open My deals', url: `${base}/my-deals` };
}

/** The line that says which deal: the address only when opened, else town and type. */
export function changePlace(c: Pick<ChangeInput, 'opened' | 'address' | 'town' | 'type' | 'kind'>): string {
  if (c.opened && c.address && c.address.trim()) return c.address.trim();
  const bits = [c.town, c.type].filter((x): x is string => Boolean(x && x.trim()));
  return bits.length > 0 ? bits.join(' · ') : c.kind === 'rent' ? 'A rental you track' : 'A property you track';
}

/** One change as an item, or null when the input cannot support a truthful line. */
export function changeItem(c: ChangeInput, siteUrl: string): Item | null {
  const place = changePlace(c);
  const link = changeLink(c, siteUrl);
  switch (c.alertType) {
    case 'price_drop': {
      const from = money(c.oldAmount, c.period);
      const to = money(c.newAmount, c.period);
      if (!from || !to || !(Number(c.newAmount) < Number(c.oldAmount))) return null;
      return { title: `Price drop: ${from} → ${to}`, lines: [place, c.figure ? `Now ${c.figure}` : null].filter((x): x is string => Boolean(x)), link };
    }
    case 'back_on_market': {
      const was = c.previousStatus ? PREVIOUS_WORDS[c.previousStatus] : null;
      const now = money(c.newAmount, c.period);
      return { title: 'Back on the market', lines: [place, [was ? `It was ${was}; it is available again.` : 'It is available again.', now ? `Asking ${now}.` : null].filter(Boolean).join(' ')], link };
    }
    case 'nearly_gone': {
      const n = Math.floor(Number(c.watchers ?? 0));
      if (!(n >= 3)) return null;
      return { title: 'Getting attention', lines: [place, `${n} other members opened or kept it in the last 7 days.`], link };
    }
    case 'gone': {
      const word = c.status ? GONE_WORDS[c.status] : null;
      if (!word) return null;
      return { title: `Gone: ${word}`, lines: [place], link };
    }
  }
}

export function changesSection(changes: ChangeInput[], siteUrl: string, title = 'Changes on your deals'): { section: Section | null; used: ChangeInput[] } {
  const items: Item[] = [];
  const used: ChangeInput[] = [];
  for (const c of changes) {
    const item = changeItem(c, siteUrl);
    if (!item) continue;
    items.push(item);
    used.push(c);
  }
  if (items.length === 0) return { section: null, used };
  return { section: { key: 'changes', title, blocks: [{ type: 'items', items }] }, used };
}

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "1 price drop on a deal you kept · 1 deal you track has gone": counted from the changes given, at most two parts. */
export function changesPhrase(changes: Pick<ChangeInput, 'alertType' | 'stage'>[]): string | null {
  if (changes.length === 0) return null;
  const whose = (list: Pick<ChangeInput, 'stage'>[]) => (list.every((c) => (c.stage ?? 'watching') === 'watching') ? 'kept' : 'track');
  const parts: { text: string; n: number }[] = [];
  const add = (t: AlertType, word: (n: number, owner: string) => string) => {
    const list = changes.filter((c) => c.alertType === t);
    if (list.length > 0) parts.push({ text: word(list.length, whose(list)), n: list.length });
  };
  add('price_drop', (n, o) => (n === 1 ? `1 price drop on a deal you ${o}` : `${n} price drops on deals you ${o}`));
  add('back_on_market', (n, o) => (n === 1 ? `1 deal you ${o} is back on the market` : `${n} deals you ${o} are back on the market`));
  add('gone', (n, o) => (n === 1 ? `1 deal you ${o} has gone` : `${n} deals you ${o} have gone`));
  add('nearly_gone', (n, o) => (n === 1 ? `1 deal you ${o} is getting attention` : `${n} deals you ${o} are getting attention`));
  const shown = parts.slice(0, 2);
  const rest = changes.length - shown.reduce((sum, p) => sum + p.n, 0);
  return [...shown.map((p) => p.text), ...(rest > 0 ? [plural(rest, 'more change')] : [])].join(' · ');
}

// ── Today's 5 (and the changes-only email) ──

export interface DailyInput {
  siteUrl: string;
  now?: Date;
  /** This morning's pick as a section (picks.ts pickSection), and its one-line headline. Null on a day with no pick. */
  pick: { section: Section; headline: string } | null;
  /** The rest of the member's Today, in display order, the pick left out. */
  teasers: DealCard[];
  /** Today's advice line when the list is the closest match rather than an exact one. */
  advice?: string | null;
  changes: ChangeInput[];
  /** The account's early-access cutoff (dealVisibility), null for an account that has paid. */
  freeCutoffIso: string | null;
  unsubscribe: Unsubscribe | null;
  /** Why they get it. Defaults by kind. */
  reason?: string;
}

export interface BuiltMessage {
  message: Message;
  /** Teaser ids actually in the email, in order. */
  teaserIds: string[];
  /** Every alert id the changes in the email stand for (collapsed ones included): what to mark sent. */
  changeIds: string[];
  /** Alerts given to the builder that it would not tell (not true as stated). Closed with the email, never told later. */
  refusedIds: string[];
  /** Teasers the early-access backstop removed. Should always be empty. */
  droppedTeasers: string[];
}

/**
 * The daily email. With a pick or teasers it is Today's 5; with only changes
 * it is the short "Changes on your deals" email; with nothing it is null (no
 * email). The pick is charged by the picks run as it always was; nothing
 * this builds is charged.
 */
export function buildDaily(input: DailyInput): BuiltMessage | null {
  const now = input.now ?? new Date();
  const base = input.siteUrl.replace(/\/$/, '');
  const todayUrl = `${base}/today`;
  const { kept, dropped } = visibleTeasers(input.teasers, input.freeCutoffIso);
  const { section: changes, used } = changesSection(input.changes, base);
  const dealCount = (input.pick ? 1 : 0) + kept.length;
  if (dealCount === 0 && !changes) return null;

  const sections: Section[] = [];
  if (input.pick) sections.push(input.pick.section);
  if (kept.length > 0) {
    const blocks: Block[] = [];
    if (input.advice) blocks.push({ type: 'text', text: input.advice, tone: 'callout' });
    blocks.push({ type: 'items', items: kept.map((c) => teaserItem(c, todayUrl, now)) });
    blocks.push({ type: 'buttons', links: [{ label: 'Open Today', url: todayUrl, primary: !input.pick }] });
    sections.push({ key: 'teasers', title: input.pick ? `The other ${plural(kept.length, 'deal')} on your Today` : `${plural(kept.length, 'deal')} on your Today`, blocks });
  }
  if (changes) sections.push(changes);

  const phrase = changesPhrase(used);
  const kind: MessageKind = dealCount > 0 ? 'todays_5' : 'deal_changes';
  let subject: string;
  if (kind === 'deal_changes') subject = capitalise(phrase ?? 'Changes on your deals');
  else {
    const head = `${plural(dealCount, 'deal')} today`;
    subject = phrase ? `${head} · ${phrase}` : input.pick ? `${head} · top pick: ${input.pick.headline}` : head;
  }
  return {
    message: {
      kind,
      subject,
      eyebrow: kind === 'todays_5' ? 'Stayful · Today’s 5' : 'Stayful · Your deals',
      sections,
      reason: input.reason ?? (kind === 'todays_5' ? 'You get this because daily picks are on.' : 'You get this because you track these deals.'),
      manageUrl: manageNotificationsUrl(base),
      unsubscribe: input.unsubscribe,
    },
    teaserIds: kept.map((c) => c.id),
    changeIds: used.flatMap((c) => [c.id, ...(c.mergedIds ?? [])]),
    refusedIds: input.changes.filter((c) => !used.includes(c)).flatMap((c) => [c.id, ...(c.mergedIds ?? [])]),
    droppedTeasers: dropped,
  };
}

function capitalise(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

