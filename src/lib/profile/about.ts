/**
 * "About you": the profile quiz's Section A answers, stored on
 * profiles.about_you. These belong to the member, not to a search: what they
 * do with property, how much they have done, the time they have, when they
 * want the next deal and how they feel about risk. Batch 13's saved profiles
 * split the search criteria (src/lib/market/goals.ts) several ways; this
 * stays one per member.
 *
 * Two answers are also mirrored into the goals so the readers that already
 * exist keep working: the time they can give sets goals.management, and the
 * risk answer sets goals.riskAppetite (TIME_TO_MANAGEMENT, RISK_TO_APPETITE).
 *
 * Pure: no network, no database, no server-only.
 */
import { areaCodeList, type Management, type ProfilePath, type RiskAppetite } from '../market/goals.ts';

export const ROLE_OPTIONS = ['investor', 'r2r', 'sourcer', 'manager', 'exploring'] as const;
export type Role = (typeof ROLE_OPTIONS)[number];

export const ABOUT_OPTIONS = {
  /** "Which sounds most interesting?" for someone just exploring. */
  exploringPick: ['buy', 'r2r', 'source'],
  dealsDone: ['0', '1-3', '4-10', '10+'],
  unitsNow: ['0', '1-2', '3-5', '6-15', '16+'],
  time: ['hands_on', 'part_time', 'hands_off'],
  nextDeal: ['this_month', '1-3m', '3-6m', 'exploring'],
  dealsWanted12m: ['1', '2-5', '6+'],
  blocker: ['finding', 'numbers', 'funding', 'consent', 'time'],
  risk: ['avoid', 'consider', 'go'],
} as const;

export type AboutOption<K extends keyof typeof ABOUT_OPTIONS> = (typeof ABOUT_OPTIONS)[K][number];

export interface AboutYou {
  version: 1;
  /** Everything that describes them (tick all). */
  roles: Role[];
  /** The main one, when more than one is ticked; otherwise the one role, or null. */
  mainRole: Role | null;
  exploringPick: AboutOption<'exploringPick'> | null;
  dealsDone: AboutOption<'dealsDone'> | null;
  unitsNow: AboutOption<'unitsNow'> | null;
  /** Postcode areas of the units they run now. */
  unitAreas: string[];
  time: AboutOption<'time'> | null;
  nextDeal: AboutOption<'nextDeal'> | null;
  dealsWanted12m: AboutOption<'dealsWanted12m'> | null;
  blocker: AboutOption<'blocker'> | null;
  risk: AboutOption<'risk'> | null;
}

export const DEFAULT_ABOUT: AboutYou = {
  version: 1,
  roles: [],
  mainRole: null,
  exploringPick: null,
  dealsDone: null,
  unitsNow: null,
  unitAreas: [],
  time: null,
  nextDeal: null,
  dealsWanted12m: null,
  blocker: null,
  risk: null,
};

export function isRole(v: unknown): v is Role {
  return (ROLE_OPTIONS as readonly string[]).includes(v as string);
}

export function aboutOption<K extends keyof typeof ABOUT_OPTIONS>(key: K, v: unknown): AboutOption<K> | null {
  return (ABOUT_OPTIONS[key] as readonly string[]).includes(v as string) ? (v as AboutOption<K>) : null;
}

/** Roles from anything: unknown values dropped, duplicates removed, ROLE_OPTIONS order kept. */
export function roleList(raw: unknown): Role[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set(raw.filter(isRole));
  return ROLE_OPTIONS.filter((r) => set.has(r));
}

/**
 * Tolerant parse of a stored value: any missing or silly field falls back to
 * its default, so a hand-edited row can never break a page. Null only when
 * there is nothing stored at all (or the wrong version), which is how "the
 * member has never answered anything here" is told from "answered nothing".
 */
export function parseAboutYou(raw: unknown): AboutYou | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  const roles = roleList(o.roles);
  const main = isRole(o.mainRole) && roles.includes(o.mainRole) ? o.mainRole : null;
  return {
    version: 1,
    roles,
    mainRole: main ?? (roles.length === 1 ? roles[0] : null),
    exploringPick: aboutOption('exploringPick', o.exploringPick),
    dealsDone: aboutOption('dealsDone', o.dealsDone),
    unitsNow: aboutOption('unitsNow', o.unitsNow),
    unitAreas: areaCodeList(o.unitAreas),
    time: aboutOption('time', o.time),
    nextDeal: aboutOption('nextDeal', o.nextDeal),
    dealsWanted12m: aboutOption('dealsWanted12m', o.dealsWanted12m),
    blocker: aboutOption('blocker', o.blocker),
    risk: aboutOption('risk', o.risk),
  };
}

/** The role that decides their path: the main one, or the only one. Null until they say. */
export function effectiveRole(about: AboutYou): Role | null {
  if (about.mainRole && about.roles.includes(about.mainRole)) return about.mainRole;
  return about.roles.length === 1 ? about.roles[0] : null;
}

/** The quiz path (and the money question, and the section) their role points at. */
export function pathFor(about: AboutYou): ProfilePath | null {
  const role = effectiveRole(about);
  switch (role) {
    case 'investor':
      return 'buy';
    case 'r2r':
      return 'r2r';
    case 'sourcer':
      return 'source';
    case 'manager':
      return 'manage';
    case 'exploring':
      return about.exploringPick;
    default:
      return null;
  }
}

/** Hands-on and part-time members run it themselves; hands-off ones want a manager's fees in the numbers. */
export const TIME_TO_MANAGEMENT: Record<AboutOption<'time'>, Management> = { hands_on: 'self', part_time: 'self', hands_off: 'managed' };

export const RISK_TO_APPETITE: Record<AboutOption<'risk'>, RiskAppetite> = { avoid: 'cautious', consider: 'balanced', go: 'tolerant' };
