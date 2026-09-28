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

/** 'profile': a saved profile's heading, over its pick and teasers (Batch 13). */
export type SectionKey = 'pick' | 'teasers' | 'changes' | 'missed' | 'recap' | 'areas' | 'notice' | 'profile';

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

/**
 * One teaser: figure, price, town, type and motivation, linking to Today.
 * Built from public columns only. `figureFor` (Batch 10) gives the profit as
 * the member's range ("£450–£700/mo · area estimate"); without it, the old line.
 */
export function teaserItem(card: DealCard, todayUrl: string, now: Date = new Date(), figureFor?: (card: DealCard) => string | null): Item {
  const figure = figureFor ? figureFor(card) : figureLine(card);
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
  /** The saved profile it is tracked under (Batch 13). */
  profileId?: string | null;
  /** That profile's name, set by the sender only once the member has two profiles: "For Client: JS". */
  profileName?: string | null;
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
  const item = changeItemOf(c, siteUrl);
  if (!item || !c.profileName) return item;
  return { ...item, lines: [...item.lines, `For ${c.profileName}`] };
}

function changeItemOf(c: ChangeInput, siteUrl: string): Item | null {
  const place = changePlace(c);
  const link = changeLink(c, siteUrl);
  switch (c.alertType) {
    case 'price_drop': {
      const from = money(c.oldAmount, c.period);
      const to = money(c.newAmount, c.period);
      if (!from || !to || !(Number(c.newAmount) < Number(c.oldAmount))) return null;
      // A marketplace deal's figures are only ever an area range now (Batch 10): say they changed, and where the exact one is.
      if (c.dealId && !c.figure) return { title: `Price drop: ${from} → ${to}`, lines: [place, 'The figures have changed. Get the exact figure with a Full analysis.'], link: { label: 'Full analysis', url: `${siteUrl.replace(/\/$/, '')}/deals/${encodeURIComponent(c.dealId)}?analysis=1` } };
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
  /** Batch 10: each teaser's profit as the member's area-estimate range. */
  figureFor?: (card: DealCard) => string | null;
  /** Batch 12: the profile line while the profile is incomplete (profileNudgeSection). Absent once complete. */
  profileNudge?: ProfileNudge | null;
  /**
   * Saved profiles (Batch 13): one part per running profile, in charge order
   * (the active one first). When given it replaces `pick`, `teasers` and
   * `advice`, which are the one-profile case.
   */
  profiles?: ProfileDeals[];
  /**
   * The names of profiles left out today because the credit ran out part-way
   * (named only when the member has two or more; the letter covers the rest).
   */
  unfunded?: string[];
}

/** One saved profile's part of the daily email. */
export interface ProfileDeals {
  /** The profile's name as a heading, once the member has two or more; null: no heading. */
  heading: string | null;
  pick: { section: Section; headline: string } | null;
  /** The marketplace deal the pick was drawn from: never a teaser under another profile too. */
  pickDealId?: string | null;
  teasers: DealCard[];
  advice?: string | null;
  /** "Open Today" for this profile: /today, or through the switch route for another profile. */
  todayUrl?: string;
  /** Each teaser's profit at this profile's finance; defaults to the input's. */
  figureFor?: (card: DealCard) => string | null;
}

/** "Your profile is 60% done: finish it for better deals and £5 credit." */
export interface ProfileNudge {
  percent: number;
  /** The profile page. renderEmail marks it ?via=email like every own-site link. */
  url: string;
  /** billing_settings.profile_complete_pence; 0 leaves the credit out of the line. */
  pence: number;
}

export function profileNudgeLine(n: Pick<ProfileNudge, 'percent' | 'pence'>): string {
  const pct = Math.max(0, Math.min(100, Math.round(n.percent)));
  const credit = n.pence > 0 ? ` and £${(n.pence / 100).toFixed(n.pence % 100 === 0 ? 0 : 2)} credit` : '';
  return `Your profile is ${pct}% done: finish it for better deals${credit}.`;
}

/** The one line, inside the one-a-day email: no email of its own. */
export function profileNudgeSection(n: ProfileNudge): Section {
  return { key: 'notice', title: null, blocks: [{ type: 'text', text: profileNudgeLine(n), tone: 'callout' }, { type: 'buttons', links: [{ label: 'Finish my profile', url: n.url }] }] };
}

export interface BuiltMessage {
  message: Message;
  /** Teaser ids actually in the email, in order. */
  teaserIds: string[];
  /** The same, per profile part (in the order given): what each profile's charge is for. */
  teasersByPart: string[][];
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
  const parts: ProfileDeals[] = input.profiles ?? [{ heading: null, pick: input.pick, teasers: input.teasers, advice: input.advice ?? null }];
  const dropped: string[] = [];
  // One deal is told once per email, whichever profile found it first; a pick is never a teaser.
  const told = new Set<string>(parts.map((p) => p.pickDealId).filter((id): id is string => Boolean(id)));
  const shown = parts.map((part) => {
    const { kept, dropped: gone } = visibleTeasers(part.teasers, input.freeCutoffIso);
    dropped.push(...gone);
    const fresh = kept.filter((c) => !told.has(c.id));
    for (const c of fresh) told.add(c.id);
    return { part, kept: fresh };
  });
  const { section: changes, used } = changesSection(input.changes, base);
  const picks = shown.filter((x) => x.part.pick);
  const dealCount = picks.length + shown.reduce((sum, x) => sum + x.kept.length, 0);
  if (dealCount === 0 && !changes) return null;

  const sections: Section[] = [];
  const anyPick = picks.length > 0;
  for (const { part, kept } of shown) {
    if (!part.pick && kept.length === 0) continue;
    const todayUrl = part.todayUrl ?? `${base}/today`;
    if (part.heading) sections.push({ key: 'profile', title: `For ${part.heading}`, blocks: [] });
    if (part.pick) sections.push(part.pick.section);
    if (kept.length > 0) {
      const blocks: Block[] = [];
      if (part.advice) blocks.push({ type: 'text', text: part.advice, tone: 'callout' });
      blocks.push({ type: 'items', items: kept.map((c) => teaserItem(c, todayUrl, now, part.figureFor ?? input.figureFor)) });
      blocks.push({ type: 'buttons', links: [{ label: 'Open Today', url: todayUrl, primary: !part.pick }] });
      sections.push({ key: 'teasers', title: part.pick ? `The other ${plural(kept.length, 'deal')} on your Today` : `${plural(kept.length, 'deal')} on your Today`, blocks });
    }
  }
  const unfunded = (input.unfunded ?? []).filter((n) => n.trim());
  if (unfunded.length > 0 && dealCount > 0) {
    sections.push({
      key: 'notice',
      title: null,
      blocks: [
        { type: 'text', text: `Not sent today, because your credit ran out: ${unfunded.join(', ')}. Top up and ${unfunded.length === 1 ? 'it starts' : 'they start'} again tomorrow morning.`, tone: 'callout' },
        { type: 'buttons', links: [{ label: 'Top up', url: `${base}/account/billing` }] },
      ],
    });
  }
  if (changes) sections.push(changes);
  if (input.profileNudge) sections.push(profileNudgeSection(input.profileNudge));

  const phrase = changesPhrase(used);
  const kind: MessageKind = dealCount > 0 ? 'todays_5' : 'deal_changes';
  let subject: string;
  if (kind === 'deal_changes') subject = capitalise(phrase ?? 'Changes on your deals');
  else {
    const head = `${plural(dealCount, 'deal')} today`;
    subject = phrase ? `${head} · ${phrase}` : anyPick ? `${head} · top pick: ${picks[0].part.pick!.headline}` : head;
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
    teaserIds: shown.flatMap((x) => x.kept.map((c) => c.id)),
    teasersByPart: shown.map((x) => x.kept.map((c) => c.id)),
    changeIds: used.flatMap((c) => [c.id, ...(c.mergedIds ?? [])]),
    refusedIds: input.changes.filter((c) => !used.includes(c)).flatMap((c) => [c.id, ...(c.mergedIds ?? [])]),
    droppedTeasers: dropped,
  };
}

function capitalise(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

