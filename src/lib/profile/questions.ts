/**
 * The profile quiz: every question, in the order it is asked, with its
 * "why we ask" line, its photo, its answers and where each answer is stored.
 *
 * Section A ("about you") is asked of everyone and stored on
 * profiles.about_you (about.ts); "which deals do you want to see?", the
 * "where" and money questions and Sections B–E are search criteria, stored on
 * profiles.market_goals (goals.ts). Which follow-ups a profile gets follows
 * the deal types it chose (Batch 17, deal-types.ts): the buyer's for Buy and
 * let or BRRR (asked once), BRRR's own for BRRR, the rent-to-rent ones for
 * Rent-to-rent; the sourcing and management sections follow the roles ticked.
 * The mandatory questions — which describes you, which deals, where should we
 * look, and one money question per chosen type — gate the rest of the app
 * (src/lib/profile/state.ts); every other question can be answered "Not sure".
 *
 * This module also does the two translations the quiz needs: an answer
 * (applyAnswer) into new goals / about-you objects, and stored values back
 * into a label for the profile page (answerLabel). Both are pure and tested.
 * Nothing here ranks or filters: the only thing an answer changes in Batch 12
 * is the match count (matching.ts); Batch 14 decides what each one does.
 */
import {
  BREAK_EVEN_OPTIONS,
  DISTANCE_MILES,
  GROWTH_OPTIONS,
  MAX_RENT_PCM_RANGE,
  PAYBACK_OPTIONS,
  areaCodeList,
  goalOption,
  normalisePostcode,
  parseFinanceGoals,
  parseMaxDistance,
  parseMaxRentPcm,
  type BuyerGoals,
  type DealType,
  type MarketGoals,
  type ProfilePath,
  type R2rGoals,
  type SourcerGoals,
  type ManagerGoals,
} from '../market/goals.ts';
import { BUDGET_LABELS, isBudget } from '../market/filters.ts';
import { DEFAULT_FINANCE } from '../listing/deal.ts';
import { areaMetaForCode } from '../market/areas.ts';
import { ABOUT_OPTIONS, DEFAULT_ABOUT, RISK_TO_APPETITE, ROLE_OPTIONS, TIME_TO_MANAGEMENT, aboutOption, pathFor, roleList, type AboutYou, type Role } from './about.ts';
import { AVAILABLE_DEAL_TYPES, availableTypes, COMING_SOON_DEAL_TYPES, DEAL_TYPE_LABELS, DEAL_TYPE_LONG_LABELS, DEAL_TYPES, dealTypesFor, isAvailableDealType, kindsFor } from './deal-types.ts';
import type { ImageKey } from './images.ts';

export type SectionId = 'about' | 'buy' | 'r2r' | 'source' | 'manage';

export const SECTION_TITLES: Record<SectionId, string> = { about: 'About you', buy: 'Buying', r2r: 'Rent-to-rent', source: 'Sourcing', manage: 'Your management company' };

export const PATH_LABELS: Record<ProfilePath, string> = { buy: 'Buying', r2r: 'Rent-to-rent', source: 'Sourcing', manage: 'Management company' };

/**
 * The section as the activity log records it. 'r2r' reads like a UK outcode
 * to the log's own filter (src/lib/activity/event.ts) and would be dropped,
 * so every section goes in as a word.
 */
export const SECTION_TOKENS: Record<SectionId, string> = { about: 'about', buy: 'buying', r2r: 'rent_to_rent', source: 'sourcing', manage: 'management' };

export type QuestionId =
  | 'roles'
  | 'deal_types'
  | 'where'
  | 'budget'
  | 'brrr_budget'
  | 'max_rent'
  | 'deals_done'
  | 'units_now'
  | 'unit_areas'
  | 'time'
  | 'next_deal'
  | 'deals_wanted'
  | 'blocker'
  | 'risk'
  | 'cash_available'
  | 'funding'
  | 'finance'
  | 'entity'
  | 'main_goal'
  | 'min_profit'
  | 'property_type'
  | 'bedrooms'
  | 'brrr_work'
  | 'leasehold'
  | 'restricted_areas'
  | 'r2r_min_profit'
  | 'setup_budget'
  | 'deal_structure'
  | 'break_even'
  | 'payback'
  | 'furnished'
  | 'sourcing_fee'
  | 'deals_per_month'
  | 'motivated_sellers'
  | 'units_managed'
  | 'operating_areas'
  | 'looking_for'
  | 'growth_target';

/**
 *   single   one tap card
 *   multi    tick all that apply
 *   where    a mode, plus a postcode and radius or a list of areas
 *   budget   the purchase budget bands
 *   rent     a monthly rent: presets or typed
 *   finance  deposit % and mortgage rate, prefilled
 *   profit   a £ per month, presets or typed
 *   areas    postcode areas picked from the list
 */
export type QuestionKind = 'single' | 'multi' | 'where' | 'budget' | 'rent' | 'finance' | 'profit' | 'areas';

/** Everything an answer can be read from or written to. */
export interface Answers {
  goals: MarketGoals;
  about: AboutYou;
  /** saved_areas: the "specific areas" answer, which the picks and the grid already read. */
  savedAreas: string[];
}

export interface Option {
  value: string;
  label: string;
  help?: string;
  /** A photo on the answer card itself ('plain' draws the card without one). */
  image?: ImageKey | 'plain';
  /** Shown greyed out with this badge ("Coming soon"), never selectable, and never ticked by "All of them". */
  soon?: string;
}

type Text = string | ((a: Answers) => string);

export interface Question {
  id: QuestionId;
  section: SectionId;
  kind: QuestionKind;
  title: Text;
  /** The one-line "Why we ask". */
  why: Text;
  /** The photo above the question, or 'cards' when the answer cards carry the photos. */
  image: ImageKey | ((a: Answers) => ImageKey) | 'cards';
  /** Short label for the profile page row. */
  short: string;
  options?: readonly Option[] | ((a: Answers) => readonly Option[]);
  /** The three that gate the app. Everything else can be "Not sure". */
  mandatory?: boolean;
  /** Changing it moves the match count. */
  affectsMatch?: boolean;
  /** Whether it is asked of this member. Default: everyone. */
  applies?: (a: Answers) => boolean;
  /** For 'rent' and 'profit': the preset amounts. */
  presets?: readonly number[];
  /** For 'multi': the option that ticks every other one ("All of them"). */
  allOption?: string;
}

export const RENT_PRESETS_PCM: readonly number[] = [1000, 1500, 2000, 3000];
export const PROFIT_PRESETS_PCM: readonly number[] = [300, 500, 800, 1000];
export const MIN_PROFIT_RANGE = { min: 0, max: 20_000 } as const;

const opt = (value: string, label: string, help?: string, image?: Option['image']): Option => ({ value, label, ...(help ? { help } : {}), ...(image ? { image } : {}) });

const ROLE_LABELS: Record<(typeof ROLE_OPTIONS)[number], string> = { investor: 'Investor buying', r2r: 'Rent-to-rent operator', sourcer: 'Deal sourcer', manager: 'Management company', exploring: 'Just exploring' };

/** The deal types this profile wants (chosen, or mapped from older answers until it chooses). */
const typesOf = (a: Answers): DealType[] => dealTypesFor({ goals: a.goals, about: a.about });

/** Asked when the profile wants any of these types. */
const wants = (...types: DealType[]) => (a: Answers) => typesOf(a).some((t) => types.includes(t));

const hasRole = (role: Role) => (a: Answers) => a.about.roles.includes(role);

/**
 * Whose money a budget question is about: the member's own, unless they only
 * source (their clients') or only manage (the deals they take on). Anyone who
 * also invests or runs rent-to-rent answers for themselves.
 */
function budgetVoice(a: Answers): 'own' | 'clients' | 'manager' {
  const r = a.about.roles;
  if (r.includes('investor') || r.includes('r2r')) return 'own';
  if (r.includes('sourcer')) return 'clients';
  if (r.includes('manager')) return 'manager';
  return 'own';
}

/** The "All of them" option of "Which deals do you want to see?". */
export const ALL_DEAL_TYPES = 'all';

/** The line under each deal type in the question. */
const DEAL_TYPE_HELP: Record<DealType, string> = {
  buy_str: 'Buy a property that’s ready to go, and run it as a holiday let',
  brrr: 'A property that needs work, priced for it',
  r2r: 'Rent from a landlord and let it short-term',
  btl: 'Buy a property and let it to long-term tenants',
};

const BUDGET_OPTIONS: readonly Option[] = (['u200', '200-350', '350-500', '500+'] as const).map((b) => opt(b, BUDGET_LABELS[b]));

export const QUESTIONS: readonly Question[] = [
  // ── Section A: about you ──
  {
    id: 'roles',
    section: 'about',
    kind: 'multi',
    title: 'Which describes you?',
    why: 'So we show you deals that fit how you actually do property.',
    image: 'roles',
    short: 'What you do',
    options: ROLE_OPTIONS.map((r) => opt(r, ROLE_LABELS[r])),
    mandatory: true,
  },
  {
    id: 'deal_types',
    section: 'about',
    kind: 'multi',
    title: 'Which deals do you want to see?',
    why: 'Today mixes the kinds you pick, and asks only what each one needs.',
    image: 'deal_types',
    short: 'Deals you want',
    // Every declared type in the question's order; one not yet available is shown greyed out,
    // "Coming soon" (AVAILABLE_DEAL_TYPES, market/goals.ts). "All of them" is every available one.
    options: DEAL_TYPES.map((t) => {
      const o = opt(t, DEAL_TYPE_LONG_LABELS[t], DEAL_TYPE_HELP[t]);
      return isAvailableDealType(t) ? o : { ...o, soon: 'Coming soon' };
    }).concat([opt(ALL_DEAL_TYPES, 'All of them')]),
    allOption: ALL_DEAL_TYPES,
    mandatory: true,
    affectsMatch: true,
  },
  {
    id: 'where',
    section: 'about',
    kind: 'where',
    title: 'Where should we look?',
    why: 'So your deals are somewhere you’d actually buy or run.',
    image: 'where',
    short: 'Where to look',
    options: [
      opt('near', 'Near me', 'Your postcode and how far you’d go'),
      opt('areas', 'Specific areas', 'Pick from Stayful’s ranked areas'),
      opt('anywhere', 'Most profitable anywhere in the UK', 'No area limit, just the strongest numbers'),
      opt('near_plus_best', 'Near me + the best elsewhere', 'Your area first, plus the strongest deals anywhere'),
    ],
    mandatory: true,
    affectsMatch: true,
  },
  {
    id: 'budget',
    section: 'about',
    kind: 'budget',
    title: (a) => (budgetVoice(a) === 'clients' ? 'What do your clients typically spend?' : budgetVoice(a) === 'manager' ? 'What’s the budget for deals you take on?' : 'What’s your budget?'),
    why: (a) => (budgetVoice(a) === 'clients' ? 'So we find deals your clients can actually buy.' : budgetVoice(a) === 'manager' ? 'So we pitch deals at the right price for you.' : 'So every deal is one you could actually buy.'),
    image: (a) => (budgetVoice(a) === 'clients' ? 'budget_source' : budgetVoice(a) === 'manager' ? 'budget_manage' : 'budget_buy'),
    short: 'Short-let budget',
    options: BUDGET_OPTIONS,
    mandatory: true,
    affectsMatch: true,
    applies: wants('buy_str'),
  },
  {
    id: 'brrr_budget',
    section: 'about',
    kind: 'budget',
    title: (a) => (budgetVoice(a) === 'clients' ? 'What would your clients pay for a project, before works?' : 'What’s the most you’d pay for a project, before works?'),
    why: 'The works come on top, so a project’s price is judged on its own.',
    image: 'brrr_budget',
    short: 'Project budget',
    options: BUDGET_OPTIONS,
    mandatory: true,
    affectsMatch: true,
    applies: wants('brrr'),
  },
  {
    id: 'max_rent',
    section: 'about',
    kind: 'rent',
    title: (a) => (budgetVoice(a) === 'clients' ? 'What’s the most rent your clients would pay a landlord each month?' : 'What’s the most rent you’d pay a landlord each month?'),
    why: (a) => (budgetVoice(a) === 'clients' ? 'So we find deals your clients will actually take on.' : 'So we never show you a rent you wouldn’t pay.'),
    image: (a) => (budgetVoice(a) === 'clients' ? 'client_rent' : 'max_rent'),
    short: 'Max rent',
    presets: RENT_PRESETS_PCM,
    mandatory: true,
    affectsMatch: true,
    applies: wants('r2r'),
  },
  {
    id: 'deals_done',
    section: 'about',
    kind: 'single',
    title: 'How many deals have you done so far?',
    why: 'So we explain as much or as little as you need.',
    image: 'deals_done',
    short: 'Deals done',
    options: [opt('0', 'None yet'), opt('1-3', '1 to 3'), opt('4-10', '4 to 10'), opt('10+', 'More than 10')],
  },
  {
    id: 'units_now',
    section: 'about',
    kind: 'single',
    title: 'How many short-let units do you own or run now?',
    why: 'Bigger operators need different deals from first-timers.',
    image: 'units_now',
    short: 'Units now',
    options: [opt('0', 'None'), opt('1-2', '1 or 2'), opt('3-5', '3 to 5'), opt('6-15', '6 to 15'), opt('16+', '16 or more')],
  },
  {
    id: 'unit_areas',
    section: 'about',
    kind: 'areas',
    title: 'Where are your current units?',
    why: 'Deals near what you already run are cheaper to clean and manage.',
    image: 'unit_areas',
    short: 'Where your units are',
    applies: (a) => a.about.unitsNow !== null && a.about.unitsNow !== '0',
  },
  {
    id: 'time',
    section: 'about',
    kind: 'single',
    title: 'How much time can you give it?',
    why: 'Hands-off investors need deals that work with a manager’s fees.',
    image: 'time',
    short: 'Time you can give',
    options: [opt('hands_on', 'Hands-on', 'I’ll run it myself'), opt('part_time', 'Part-time', 'Some of it, with help'), opt('hands_off', 'Hands-off', 'A manager runs it')],
  },
  {
    id: 'next_deal',
    section: 'about',
    kind: 'single',
    title: 'When do you want your next deal?',
    why: 'So we know how urgently to tell you about new deals.',
    image: 'next_deal',
    short: 'Next deal',
    options: [opt('this_month', 'This month'), opt('1-3m', '1 to 3 months'), opt('3-6m', '3 to 6 months'), opt('exploring', 'Just exploring')],
  },
  {
    id: 'deals_wanted',
    section: 'about',
    kind: 'single',
    title: 'How many deals do you want in the next 12 months?',
    why: 'So we send the right number of deals, not too many.',
    image: 'deals_wanted',
    short: 'Deals wanted',
    options: [opt('1', 'One'), opt('2-5', '2 to 5'), opt('6+', '6 or more')],
  },
  {
    id: 'blocker',
    section: 'about',
    kind: 'single',
    title: 'What’s the biggest thing holding you back?',
    why: 'So we help with the part you’re actually stuck on.',
    image: 'blocker',
    short: 'Holding you back',
    options: [opt('finding', 'Finding deals'), opt('numbers', 'Knowing the numbers'), opt('funding', 'Funding'), opt('consent', 'Landlord or agent consent'), opt('time', 'Time')],
  },
  {
    id: 'risk',
    section: 'about',
    kind: 'single',
    title: 'A deal could make £800 a month, but £300 in a slow year. Would you…',
    why: 'Everyone’s comfort with risk is different. No wrong answer.',
    image: 'cards',
    short: 'Risk',
    options: [opt('avoid', 'Avoid it', undefined, 'risk_avoid'), opt('consider', 'Consider it', undefined, 'plain'), opt('go', 'Go for it', undefined, 'risk_go')],
  },

  // ── Section B: investor buying ──
  {
    id: 'cash_available',
    section: 'buy',
    kind: 'single',
    title: 'How much cash can you put in?',
    why: 'So we only show deals you can actually fund.',
    image: 'cash_available',
    short: 'Cash available',
    options: [opt('u30', 'Under £30k'), opt('30-60', '£30k to £60k'), opt('60-100', '£60k to £100k'), opt('100-200', '£100k to £200k'), opt('200+', '£200k or more')],
    applies: wants('buy_str', 'brrr'),
  },
  {
    id: 'funding',
    section: 'buy',
    kind: 'single',
    title: 'How will you fund it?',
    why: 'Cash and mortgage buyers judge deals differently.',
    image: 'funding',
    short: 'Funding',
    options: [opt('cash', 'Cash'), opt('btl', 'Buy-to-let mortgage'), opt('holiday_let', 'Holiday-let mortgage'), opt('bridging', 'Bridging')],
    applies: wants('buy_str', 'brrr'),
  },
  {
    id: 'finance',
    section: 'buy',
    kind: 'finance',
    title: 'Your deposit and mortgage rate',
    why: 'So every profit figure uses your numbers, not ours.',
    image: 'finance',
    short: 'Deposit and rate',
    applies: wants('buy_str', 'brrr'),
  },
  {
    id: 'entity',
    section: 'buy',
    kind: 'single',
    title: 'Buying in your own name or a company?',
    why: 'Company and personal mortgages are priced differently.',
    image: 'entity',
    short: 'Buying as',
    options: [opt('own_name', 'Own name'), opt('company', 'Limited company'), opt('undecided', 'Undecided')],
    applies: wants('buy_str', 'brrr'),
  },
  {
    id: 'main_goal',
    section: 'buy',
    kind: 'single',
    title: 'What’s the main goal?',
    why: 'So we rank by what matters to you.',
    image: 'main_goal',
    short: 'Main goal',
    options: [opt('cashflow', 'Monthly cashflow'), opt('growth', 'Long-term growth'), opt('both', 'Both')],
    applies: wants('buy_str', 'brrr'),
  },
  {
    id: 'min_profit',
    section: 'buy',
    kind: 'profit',
    title: 'What’s the least profit a deal should make each month?',
    why: 'So you never see deals that aren’t worth your time.',
    image: 'min_profit',
    short: 'Minimum profit',
    presets: PROFIT_PRESETS_PCM,
    applies: wants('buy_str', 'brrr'),
  },
  {
    id: 'property_type',
    section: 'buy',
    kind: 'single',
    title: 'Flat or house?',
    why: 'Some investors only want flats, some only houses.',
    image: 'cards',
    short: 'Property type',
    options: [opt('flat', 'Flat', undefined, 'property_flat'), opt('house', 'House', undefined, 'property_house'), opt('either', 'Either', undefined, 'plain')],
    applies: wants('buy_str', 'brrr'),
  },
  {
    id: 'bedrooms',
    section: 'buy',
    kind: 'single',
    title: 'How many bedrooms?',
    why: 'Bigger places earn more but cost more to run.',
    image: 'bedrooms',
    short: 'Bedrooms',
    options: [opt('1', '1 bed'), opt('2', '2 bed'), opt('3', '3 bed'), opt('4', '4 or more')],
    applies: wants('buy_str', 'brrr'),
  },
  {
    id: 'brrr_work',
    section: 'buy',
    kind: 'single',
    title: 'How much work would you take on?',
    why: 'Projects can be great value if you’re up for the work.',
    image: 'cards',
    short: 'Work you’d take on',
    options: [opt('light', 'Light refresh', 'Paint, carpets, a kitchen', 'condition_ready'), opt('full', 'Full project', 'Strip-out and refit', 'condition_project'), opt('either', 'Either', undefined, 'plain')],
    applies: wants('brrr'),
  },
  {
    id: 'leasehold',
    section: 'buy',
    kind: 'single',
    title: 'Leasehold OK?',
    why: 'Many leases ban short lets, so some buyers avoid them.',
    image: 'leasehold',
    short: 'Leasehold',
    options: [opt('yes', 'Yes'), opt('no', 'No'), opt('depends', 'Depends on the lease')],
    applies: wants('buy_str', 'brrr'),
  },
  {
    id: 'restricted_areas',
    section: 'buy',
    kind: 'single',
    title: 'Areas with short-let restrictions?',
    why: 'Some councils limit short lets. We can hide them or warn you.',
    image: 'restricted_areas',
    short: 'Restricted areas',
    options: [opt('avoid', 'Avoid them'), opt('warn', 'Show them with a warning')],
    applies: wants('buy_str', 'brrr'),
  },

  // ── Section C: rent-to-rent operator ──
  {
    id: 'r2r_min_profit',
    section: 'r2r',
    kind: 'profit',
    title: 'What’s the least profit a deal should make each month?',
    why: 'So every deal clears your bar after rent and bills.',
    image: 'r2r_min_profit',
    short: 'Minimum profit',
    presets: PROFIT_PRESETS_PCM,
    applies: wants('r2r'),
  },
  {
    id: 'setup_budget',
    section: 'r2r',
    kind: 'single',
    title: 'Setup budget per unit?',
    why: 'Furnishing and setup is your biggest upfront cost.',
    image: 'setup_budget',
    short: 'Setup budget',
    options: [opt('u3k', 'Under £3k'), opt('3-6k', '£3k to £6k'), opt('6-10k', '£6k to £10k'), opt('10k+', '£10k or more')],
    applies: wants('r2r'),
  },
  {
    id: 'deal_structure',
    section: 'r2r',
    kind: 'single',
    title: 'Which deal structure do you use?',
    why: 'So we give you the right pitch for the landlord.',
    image: 'deal_structure',
    short: 'Deal structure',
    options: [opt('company_let', 'Company let'), opt('management', 'Management agreement'), opt('guaranteed_rent', 'Guaranteed rent'), opt('any', 'Any')],
    applies: wants('r2r'),
  },
  {
    id: 'break_even',
    section: 'r2r',
    kind: 'single',
    title: 'What break-even occupancy are you comfortable with?',
    why: 'The lower this is, the safer the deal in a quiet month.',
    image: 'break_even',
    short: 'Break-even occupancy',
    options: BREAK_EVEN_OPTIONS.map((n) => opt(String(n), `Up to ${n}%`)),
    applies: wants('r2r'),
  },
  {
    id: 'payback',
    section: 'r2r',
    kind: 'single',
    title: 'How fast do you want your setup money back?',
    why: 'How fast you want your setup money back.',
    image: 'payback',
    short: 'Target payback',
    options: PAYBACK_OPTIONS.map((n) => opt(String(n), `${n} months`)),
    applies: wants('r2r'),
  },
  {
    id: 'furnished',
    section: 'r2r',
    kind: 'single',
    title: 'Furnished or unfurnished?',
    why: 'Furnished lets cut your setup cost.',
    image: 'furnished',
    short: 'Furnished',
    options: [opt('either', 'Either'), opt('furnished', 'Furnished only'), opt('unfurnished', 'Unfurnished only')],
    applies: wants('r2r'),
  },

  // ── Section D: deal sourcer ──
  {
    id: 'sourcing_fee',
    section: 'source',
    kind: 'single',
    title: 'What’s your typical sourcing fee?',
    why: 'A deal needs enough room in it to cover your fee.',
    image: 'sourcing_fee',
    short: 'Sourcing fee',
    options: [opt('u2k', 'Under £2k'), opt('2-4k', '£2k to £4k'), opt('4k+', '£4k or more')],
    applies: hasRole('sourcer'),
  },
  {
    id: 'deals_per_month',
    section: 'source',
    kind: 'single',
    title: 'How many deals do you need a month?',
    why: 'So we keep your pipeline full.',
    image: 'deals_per_month',
    short: 'Deals per month',
    options: [opt('1-2', '1 or 2'), opt('3-5', '3 to 5'), opt('6+', '6 or more')],
    applies: hasRole('sourcer'),
  },
  {
    id: 'motivated_sellers',
    section: 'source',
    kind: 'single',
    title: 'Motivated sellers?',
    why: 'Motivated sellers are more open to below-asking offers.',
    image: 'motivated_sellers',
    short: 'Motivated sellers',
    options: [opt('prefer', 'Prefer them'), opt('only', 'Only motivated sellers'), opt('off', 'No preference')],
    applies: hasRole('sourcer'),
  },

  // ── Section E: management company ──
  {
    id: 'units_managed',
    section: 'manage',
    kind: 'single',
    title: 'How many units do you manage now?',
    why: 'So we pitch deals at your scale.',
    image: 'units_managed',
    short: 'Units managed',
    options: [opt('1-10', '1 to 10'), opt('11-30', '11 to 30'), opt('31-75', '31 to 75'), opt('76+', '76 or more')],
    applies: hasRole('manager'),
  },
  {
    id: 'operating_areas',
    section: 'manage',
    kind: 'areas',
    title: 'Which cities do you operate in?',
    why: 'Deals where your team already works are easier to take on.',
    image: 'operating_areas',
    short: 'Where you operate',
    applies: hasRole('manager'),
  },
  {
    id: 'looking_for',
    section: 'manage',
    kind: 'single',
    title: 'What are you looking for?',
    why: 'Some management companies want landlords, some want their own deals.',
    image: 'looking_for',
    short: 'Looking for',
    options: [opt('landlords', 'Landlords to manage'), opt('own_deals', 'Our own deals'), opt('both', 'Both')],
    applies: hasRole('manager'),
  },
  {
    id: 'growth_target',
    section: 'manage',
    kind: 'single',
    title: 'Growth target for the next 12 months?',
    why: 'So we send enough to hit your target.',
    image: 'growth_target',
    short: 'Growth target',
    options: GROWTH_OPTIONS.map((n) => opt(String(n), `+${n} units`)),
    applies: hasRole('manager'),
  },
];

const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

export function questionById(id: string): Question | null {
  return BY_ID.get(id as QuestionId) ?? null;
}

export function isQuestionId(v: unknown): v is QuestionId {
  return typeof v === 'string' && BY_ID.has(v as QuestionId);
}

/** The questions this member is asked, in order. */
export function questionsFor(a: Answers): Question[] {
  return QUESTIONS.filter((q) => !q.applies || q.applies(a));
}

export function text(t: Text, a: Answers): string {
  return typeof t === 'function' ? t(a) : t;
}

export function optionsOf(q: Question, a: Answers): readonly Option[] {
  if (!q.options) return [];
  return typeof q.options === 'function' ? q.options(a) : q.options;
}

export function imageOf(q: Question, a: Answers): ImageKey | 'cards' {
  return typeof q.image === 'function' ? q.image(a) : q.image;
}

/** The money question for each chosen type (all mandatory, Q27): the budget, the project budget, the rent ceiling. */
export function moneyQuestionsFor(types: readonly DealType[]): QuestionId[] {
  const out: QuestionId[] = [];
  if (types.includes('buy_str')) out.push('budget');
  if (types.includes('brrr')) out.push('brrr_budget');
  if (types.includes('r2r')) out.push('max_rent');
  return out;
}

// ── Answering ──

/** What the quiz posts for a "where" answer. */
export interface WhereAnswer {
  mode: string;
  postcode?: string | null;
  miles?: number | string | null;
  areas?: string[] | null;
}

export type Applied = { ok: true; answers: Answers } | { ok: false; error: string };

const fail = (error: string): Applied => ({ ok: false, error });

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[£,\s]/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * New about-you answers into the goals: the kind the profile searches follows
 * its deal types (chosen, or mapped from the roles until it chooses). The old
 * path is still written for any reader that has not moved on, but decides
 * nothing (Batch 17).
 */
function withRoles(a: Answers, about: AboutYou): Answers {
  const next = { ...a, about };
  const types = typesOf(next);
  const goals: MarketGoals = { ...a.goals, path: pathFor(about), sourcingKind: types.length > 0 ? kindsFor(types) : a.goals.sourcingKind };
  return { ...next, goals };
}

/**
 * The deal types as the question posts them: "All of them" ticks every
 * available type, and a type that is not available yet (Buy to let) is never
 * kept, whatever is posted.
 */
export function dealTypesFromAnswer(raw: unknown): DealType[] {
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.includes(ALL_DEAL_TYPES)) return [...AVAILABLE_DEAL_TYPES];
  return availableTypes(list.filter((v): v is DealType => (DEAL_TYPES as readonly unknown[]).includes(v)));
}

const setBuyer = (a: Answers, patch: Partial<BuyerGoals>): Answers => ({ ...a, goals: { ...a.goals, buyer: { ...a.goals.buyer, ...patch } } });
const setR2r = (a: Answers, patch: Partial<R2rGoals>): Answers => ({ ...a, goals: { ...a.goals, r2r: { ...a.goals.r2r, ...patch } } });
const setSourcer = (a: Answers, patch: Partial<SourcerGoals>): Answers => ({ ...a, goals: { ...a.goals, sourcer: { ...a.goals.sourcer, ...patch } } });
const setManager = (a: Answers, patch: Partial<ManagerGoals>): Answers => ({ ...a, goals: { ...a.goals, manager: { ...a.goals.manager, ...patch } } });
const setAbout = (a: Answers, patch: Partial<AboutYou>): Answers => ({ ...a, about: { ...a.about, ...patch } });

/**
 * A real answer to one question, as new goals / about-you / saved areas.
 * Every value is checked: a wrong one is refused with a message the screen
 * can show, and nothing else changes. The reads and writes are the server's
 * (src/lib/profile/server.ts).
 */
export function applyAnswer(id: QuestionId, raw: unknown, a: Answers): Applied {
  const q = BY_ID.get(id);
  if (!q) return fail('Unknown question.');
  const goals = a.goals;
  switch (id) {
    case 'roles': {
      const roles = roleList(raw);
      if (roles.length === 0) return fail('Tick at least one.');
      const mainRole = roles.length === 1 ? roles[0] : a.about.mainRole && roles.includes(a.about.mainRole) ? a.about.mainRole : null;
      return { ok: true, answers: withRoles(a, { ...a.about, roles, mainRole }) };
    }
    case 'deal_types': {
      const types = dealTypesFromAnswer(raw);
      const posted = Array.isArray(raw) ? raw : [raw];
      const soon = COMING_SOON_DEAL_TYPES.filter((t) => posted.includes(t));
      if (types.length === 0 && soon.length > 0) return fail(`${soon.map((t) => DEAL_TYPE_LABELS[t]).join(' and ')} ${soon.length === 1 ? 'is' : 'are'} coming soon. Tick one of the others for now.`);
      if (types.length === 0) return fail('Tick at least one.');
      return { ok: true, answers: { ...a, goals: { ...goals, dealTypes: types, sourcingKind: kindsFor(types) } } };
    }
    case 'where': {
      const w = (raw && typeof raw === 'object' ? raw : {}) as WhereAnswer;
      const mode = goalOption('where', w.mode);
      if (!mode) return fail('Choose where you want to look.');
      if (mode === 'near' || mode === 'near_plus_best') {
        const postcode = normalisePostcode(typeof w.postcode === 'string' ? w.postcode : '');
        if (!postcode) return fail('Enter a full UK postcode, like NG2 5GB.');
        const miles = parseMaxDistance(w.miles);
        if (miles === null) return fail(`Choose how far you would go, ${DISTANCE_MILES.min} to ${DISTANCE_MILES.max} miles.`);
        // The same postcode keeps its coordinates (placed once, metered); a new one is placed by the server.
        const same = goals.home && goals.home.postcode === postcode ? goals.home : null;
        return { ok: true, answers: { ...a, goals: { ...goals, where: mode, home: same ?? { postcode, lat: null, lng: null }, maxDistanceMiles: miles }, savedAreas: [] } };
      }
      if (mode === 'areas') {
        const areas = areaCodeList(w.areas);
        if (areas.length === 0) return fail('Pick at least one area.');
        return { ok: true, answers: { ...a, goals: { ...goals, where: mode, home: null, maxDistanceMiles: null }, savedAreas: areas } };
      }
      return { ok: true, answers: { ...a, goals: { ...goals, where: mode, home: null, maxDistanceMiles: null }, savedAreas: [] } };
    }
    case 'budget': {
      if (!isBudget(raw) || raw === 'any') return fail('Choose a budget.');
      return { ok: true, answers: { ...a, goals: { ...goals, budget: raw } } };
    }
    case 'brrr_budget': {
      if (!isBudget(raw) || raw === 'any') return fail('Choose a budget.');
      return { ok: true, answers: { ...a, goals: { ...goals, brrr: { ...goals.brrr, budget: raw } } } };
    }
    case 'brrr_work': {
      const v = goalOption('brrrWork', raw);
      if (!v) return fail('Choose one.');
      return { ok: true, answers: { ...a, goals: { ...goals, brrr: { ...goals.brrr, work: v } } } };
    }
    case 'max_rent': {
      const rent = parseMaxRentPcm(raw);
      if (rent === null) return fail(`Enter a monthly rent between £${MAX_RENT_PCM_RANGE.min} and £${MAX_RENT_PCM_RANGE.max.toLocaleString('en-GB')}.`);
      return { ok: true, answers: { ...a, goals: { ...goals, maxRentPcm: rent } } };
    }
    case 'deals_done':
    case 'units_now':
    case 'next_deal':
    case 'deals_wanted':
    case 'blocker': {
      const key = ({ deals_done: 'dealsDone', units_now: 'unitsNow', next_deal: 'nextDeal', deals_wanted: 'dealsWanted12m', blocker: 'blocker' } as const)[id];
      const v = aboutOption(key, raw);
      if (!v) return fail('Choose one.');
      const about: AboutYou = { ...a.about, [key]: v };
      if (id === 'units_now' && v === '0') about.unitAreas = [];
      return { ok: true, answers: { ...a, about } };
    }
    case 'unit_areas': {
      const areas = areaCodeList(raw);
      if (areas.length === 0) return fail('Pick at least one area.');
      return { ok: true, answers: setAbout(a, { unitAreas: areas }) };
    }
    case 'time': {
      const v = aboutOption('time', raw);
      if (!v) return fail('Choose one.');
      return { ok: true, answers: { ...a, about: { ...a.about, time: v }, goals: { ...goals, management: TIME_TO_MANAGEMENT[v] } } };
    }
    case 'risk': {
      const v = aboutOption('risk', raw);
      if (!v) return fail('Choose one.');
      return { ok: true, answers: { ...a, about: { ...a.about, risk: v }, goals: { ...goals, riskAppetite: RISK_TO_APPETITE[v] } } };
    }
    case 'cash_available':
    case 'funding':
    case 'entity':
    case 'main_goal':
    case 'property_type':
    case 'leasehold':
    case 'restricted_areas': {
      const key = ({ cash_available: 'cashAvailable', funding: 'funding', entity: 'entity', main_goal: 'mainGoal', property_type: 'propertyType', leasehold: 'leaseholdOk', restricted_areas: 'restrictedAreas' } as const)[id];
      const v = goalOption(key, raw);
      if (!v) return fail('Choose one.');
      return { ok: true, answers: setBuyer(a, { [key]: v }) };
    }
    case 'finance': {
      const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const deposit = num(f.depositPct);
      const rate = num(f.mortgageRatePct);
      if (deposit === null || deposit < 0 || deposit > 100) return fail('Enter a deposit between 0% and 100%.');
      if (rate === null || rate < 0 || rate > 25) return fail('Enter a mortgage rate between 0% and 25%.');
      return { ok: true, answers: { ...a, goals: { ...goals, finance: parseFinanceGoals({ ...goals.finance, depositPct: deposit, mortgageRatePct: rate }) } } };
    }
    case 'min_profit':
    case 'r2r_min_profit': {
      const n = num(raw);
      if (n === null || n < MIN_PROFIT_RANGE.min || n > MIN_PROFIT_RANGE.max) return fail(`Enter a monthly profit between £0 and £${MIN_PROFIT_RANGE.max.toLocaleString('en-GB')}.`);
      // Two answers, two fields: the rent-to-rent one no longer overwrites the buyer's (Batch 17).
      if (id === 'r2r_min_profit') return { ok: true, answers: setR2r(a, { minMarginPcm: Math.round(n) }) };
      return { ok: true, answers: { ...a, goals: { ...goals, finance: { ...goals.finance, targetMarginPcm: Math.round(n) } } } };
    }
    case 'bedrooms': {
      const n = num(raw);
      if (n !== 1 && n !== 2 && n !== 3 && n !== 4) return fail('Choose one.');
      return { ok: true, answers: { ...a, goals: { ...goals, bedrooms: n } } };
    }
    case 'setup_budget':
    case 'deal_structure':
    case 'furnished': {
      const key = ({ setup_budget: 'setupBudget', deal_structure: 'dealStructure', furnished: 'furnished' } as const)[id];
      const v = goalOption(key, raw);
      if (!v) return fail('Choose one.');
      return { ok: true, answers: setR2r(a, { [key]: v }) };
    }
    case 'break_even': {
      const n = num(raw);
      const v = BREAK_EVEN_OPTIONS.find((x) => x === n);
      if (!v) return fail('Choose one.');
      return { ok: true, answers: setR2r(a, { breakEvenOccupancyPct: v }) };
    }
    case 'payback': {
      const n = num(raw);
      const v = PAYBACK_OPTIONS.find((x) => x === n);
      if (!v) return fail('Choose one.');
      return { ok: true, answers: setR2r(a, { paybackMonths: v }) };
    }
    case 'sourcing_fee':
    case 'deals_per_month': {
      const key = ({ sourcing_fee: 'sourcingFee', deals_per_month: 'dealsPerMonth' } as const)[id];
      const v = goalOption(key, raw);
      if (!v) return fail('Choose one.');
      return { ok: true, answers: setSourcer(a, { [key]: v }) };
    }
    case 'motivated_sellers': {
      if (raw !== 'prefer' && raw !== 'only' && raw !== 'off') return fail('Choose one.');
      return { ok: true, answers: { ...a, goals: { ...goals, motivation: { ...goals.motivation, mode: raw } } } };
    }
    case 'units_managed':
    case 'looking_for': {
      const key = ({ units_managed: 'unitsManaged', looking_for: 'lookingFor' } as const)[id];
      const v = goalOption(key, raw);
      if (!v) return fail('Choose one.');
      return { ok: true, answers: setManager(a, { [key]: v }) };
    }
    case 'operating_areas': {
      const areas = areaCodeList(raw);
      if (areas.length === 0) return fail('Pick at least one area.');
      return { ok: true, answers: setManager(a, { operatingAreas: areas }) };
    }
    case 'growth_target': {
      const n = num(raw);
      const v = GROWTH_OPTIONS.find((x) => x === n);
      if (!v) return fail('Choose one.');
      return { ok: true, answers: setManager(a, { growthTarget: v }) };
    }
  }
}

/**
 * "Not sure": the stored value goes back to "no preference", so an earlier
 * real answer never lingers behind a shrug. Only for the questions that
 * allow it; a mandatory one is returned unchanged.
 */
export function clearAnswer(id: QuestionId, a: Answers): Answers {
  const goals = a.goals;
  switch (id) {
    case 'roles':
    case 'deal_types':
    case 'where':
    case 'budget':
    case 'brrr_budget':
    case 'max_rent':
      return a;
    case 'brrr_work':
      return { ...a, goals: { ...goals, brrr: { ...goals.brrr, work: null } } };
    case 'deals_done':
      return setAbout(a, { dealsDone: null });
    case 'units_now':
      return setAbout(a, { unitsNow: null, unitAreas: [] });
    case 'unit_areas':
      return setAbout(a, { unitAreas: [] });
    case 'time':
      return { ...a, about: { ...a.about, time: null }, goals: { ...goals, management: 'managed' } };
    case 'next_deal':
      return setAbout(a, { nextDeal: null });
    case 'deals_wanted':
      return setAbout(a, { dealsWanted12m: null });
    case 'blocker':
      return setAbout(a, { blocker: null });
    case 'risk':
      return { ...a, about: { ...a.about, risk: null }, goals: { ...goals, riskAppetite: 'balanced' } };
    case 'cash_available':
      return setBuyer(a, { cashAvailable: null });
    case 'funding':
      return setBuyer(a, { funding: null });
    case 'finance':
      return { ...a, goals: { ...goals, finance: { ...goals.finance, depositPct: DEFAULT_FINANCE.depositPct, mortgageRatePct: DEFAULT_FINANCE.mortgageRatePct } } };
    case 'entity':
      return setBuyer(a, { entity: null });
    case 'main_goal':
      return setBuyer(a, { mainGoal: null });
    case 'min_profit':
      return { ...a, goals: { ...goals, finance: { ...goals.finance, targetMarginPcm: DEFAULT_FINANCE.targetMarginPcm } } };
    case 'r2r_min_profit':
      return setR2r(a, { minMarginPcm: null });
    case 'property_type':
      return setBuyer(a, { propertyType: null });
    case 'bedrooms':
      return { ...a, goals: { ...goals, bedrooms: null } };
    case 'leasehold':
      return setBuyer(a, { leaseholdOk: null });
    case 'restricted_areas':
      return setBuyer(a, { restrictedAreas: null });
    case 'setup_budget':
      return setR2r(a, { setupBudget: null });
    case 'deal_structure':
      return setR2r(a, { dealStructure: null });
    case 'break_even':
      return setR2r(a, { breakEvenOccupancyPct: null });
    case 'payback':
      return setR2r(a, { paybackMonths: null });
    case 'furnished':
      return setR2r(a, { furnished: null });
    case 'sourcing_fee':
      return setSourcer(a, { sourcingFee: null });
    case 'deals_per_month':
      return setSourcer(a, { dealsPerMonth: null });
    case 'motivated_sellers':
      return { ...a, goals: { ...goals, motivation: { ...goals.motivation, mode: 'off' } } };
    case 'units_managed':
      return setManager(a, { unitsManaged: null });
    case 'operating_areas':
      return setManager(a, { operatingAreas: [] });
    case 'looking_for':
      return setManager(a, { lookingFor: null });
    case 'growth_target':
      return setManager(a, { growthTarget: null });
  }
}

// ── Reading back ──

/** The stored value in the shape applyAnswer takes, for the quiz to preselect; null when there is none. */
export function currentValue(id: QuestionId, a: Answers): unknown {
  const g = a.goals;
  const b = a.about;
  switch (id) {
    case 'roles':
      return b.roles.length > 0 ? b.roles : null;
    case 'deal_types': {
      const t = typesOf(a);
      return t.length > 0 ? t : null;
    }
    case 'where':
      if (!g.where) return null;
      return { mode: g.where, postcode: g.home?.postcode ?? null, miles: g.maxDistanceMiles, areas: a.savedAreas } satisfies WhereAnswer;
    case 'budget':
      return g.budget;
    case 'brrr_budget':
      return g.brrr.budget;
    case 'brrr_work':
      return g.brrr.work;
    case 'max_rent':
      return g.maxRentPcm;
    case 'deals_done':
      return b.dealsDone;
    case 'units_now':
      return b.unitsNow;
    case 'unit_areas':
      return b.unitAreas.length > 0 ? b.unitAreas : null;
    case 'time':
      return b.time;
    case 'next_deal':
      return b.nextDeal;
    case 'deals_wanted':
      return b.dealsWanted12m;
    case 'blocker':
      return b.blocker;
    case 'risk':
      return b.risk;
    case 'cash_available':
      return g.buyer.cashAvailable;
    case 'funding':
      return g.buyer.funding;
    case 'finance':
      return { depositPct: g.finance.depositPct, mortgageRatePct: g.finance.mortgageRatePct };
    case 'entity':
      return g.buyer.entity;
    case 'main_goal':
      return g.buyer.mainGoal;
    case 'min_profit':
      return g.finance.targetMarginPcm;
    case 'r2r_min_profit':
      return g.r2r.minMarginPcm;
    case 'property_type':
      return g.buyer.propertyType;
    case 'bedrooms':
      return g.bedrooms === null ? null : String(g.bedrooms);
    case 'leasehold':
      return g.buyer.leaseholdOk;
    case 'restricted_areas':
      return g.buyer.restrictedAreas;
    case 'setup_budget':
      return g.r2r.setupBudget;
    case 'deal_structure':
      return g.r2r.dealStructure;
    case 'break_even':
      return g.r2r.breakEvenOccupancyPct === null ? null : String(g.r2r.breakEvenOccupancyPct);
    case 'payback':
      return g.r2r.paybackMonths === null ? null : String(g.r2r.paybackMonths);
    case 'furnished':
      return g.r2r.furnished;
    case 'sourcing_fee':
      return g.sourcer.sourcingFee;
    case 'deals_per_month':
      return g.sourcer.dealsPerMonth;
    case 'motivated_sellers':
      return g.motivation.mode;
    case 'units_managed':
      return g.manager.unitsManaged;
    case 'operating_areas':
      return g.manager.operatingAreas.length > 0 ? g.manager.operatingAreas : null;
    case 'looking_for':
      return g.manager.lookingFor;
    case 'growth_target':
      return g.manager.growthTarget === null ? null : String(g.manager.growthTarget);
  }
}

const gbp = (n: number) => `£${n.toLocaleString('en-GB')}`;

const areaNames = (codes: readonly string[]) => codes.map((c) => areaMetaForCode(c).name).join(', ');

/** The stored answer as the profile page shows it; null when there is none. */
export function answerLabel(id: QuestionId, a: Answers): string | null {
  const q = BY_ID.get(id);
  if (!q) return null;
  const v = currentValue(id, a);
  if (v === null || v === undefined) return null;
  switch (q.kind) {
    case 'single': {
      const o = optionsOf(q, a).find((x) => x.value === String(v));
      return o?.label ?? null;
    }
    case 'multi': {
      const opts = optionsOf(q, a);
      const picked = v as string[];
      // "All of them": every option that can be chosen (never one that is coming soon).
      if (q.allOption && opts.filter((o) => o.value !== q.allOption && !o.soon).every((o) => picked.includes(o.value))) return opts.find((o) => o.value === q.allOption)?.label ?? null;
      const labels = picked.map((x) => opts.find((o) => o.value === x)?.label).filter((x): x is string => Boolean(x));
      return labels.length > 0 ? labels.join(', ') : null;
    }
    case 'where': {
      const w = v as WhereAnswer;
      if (w.mode === 'near' || w.mode === 'near_plus_best') {
        const near = `Within ${w.miles} miles of ${String(w.postcode ?? '').split(' ')[0]}`;
        return w.mode === 'near' ? near : `${near}, plus the best elsewhere`;
      }
      if (w.mode === 'areas') return w.areas && w.areas.length > 0 ? areaNames(w.areas) : 'Specific areas';
      return 'Anywhere in the UK';
    }
    case 'budget':
      return isBudget(v) ? BUDGET_LABELS[v] : null;
    case 'rent':
      return `Up to ${gbp(Number(v))} a month`;
    case 'finance': {
      const f = v as { depositPct: number; mortgageRatePct: number };
      return `${f.depositPct}% deposit, ${f.mortgageRatePct}% rate`;
    }
    case 'profit':
      return `${gbp(Number(v))} a month`;
    case 'areas':
      return areaNames(v as string[]);
  }
}

/** Fresh answers for a member with nothing stored yet. */
export function emptyAnswers(goals: MarketGoals, about: AboutYou | null, savedAreas: string[]): Answers {
  return { goals, about: about ?? DEFAULT_ABOUT, savedAreas };
}

export { ABOUT_OPTIONS };
