/**
 * The works guide (Part D): which refurb lines a property needs, how many of
 * each, and the works RANGE they add up to. A guide from the photos to show a
 * property has potential, not a quote: the working section says so, and
 * members are expected to get their own quotes and a survey.
 *
 *   low   the lines the photos clearly show as needed
 *   high  low + the lines the photos can't settle and the hidden ones
 *         (rewire, water tank and pipework are never visible; the boiler,
 *         roof and damp are when a photo shows them)
 *
 * Both ends carry the contingency. Quantities come from the bedroom count
 * (config.ts) and can only go DOWN where the photos show fewer. The garden is
 * never priced: the working section always lists it under "not priced in".
 *
 * The lines are plain data so a member's edited version (Part G) runs
 * through the same sums: change a cost or a quantity, switch a line on or
 * off (needed / not needed), or add a line of their own.
 *
 * Pure: no network, no database, no server-only.
 */

import { DEFAULT_PROJECT_COSTS, DEFAULT_PROJECT_QUANTITIES, DEFAULT_PROJECT_RATES, type KitchenSize, type ProjectCostsSettings, type ProjectQuantities, type ProjectRates } from './config.ts';

export type LineKey =
  | 'waste'
  | 'rewire'
  | 'boiler'
  | 'radiators'
  | 'water_tank'
  | 'pipework'
  | 'bathroom'
  | 'plaster'
  | 'skirting'
  | 'paint'
  | 'kitchen'
  | 'carpet'
  | 'roof'
  | 'windows'
  | 'outside_doors'
  | 'internal_doors'
  | 'damp';

export type LineStatus = 'needed' | 'not_needed' | 'cant_tell';
export type LineUnit = 'job' | 'each' | 'room' | 'wall';

/**
 * How a line counts in the value after works (Part E): visible works add
 * twice their cost; hidden fixes (rewire, boiler, water tank, pipework, damp,
 * roof) count at cost, because they remove a discount rather than add value.
 */
export type ValueRole = 'visible' | 'hidden';

/** Where a line's answer comes from: the photos, the photos when they show it, or never the photos. */
export type LineSight = 'photo' | 'if_visible' | 'hidden';

export interface LineSpec {
  key: LineKey;
  label: string;
  unit: LineUnit;
  sight: LineSight;
  valueRole: ValueRole;
}

/** The costing table, in the brief's order. */
export const LINE_SPECS: readonly LineSpec[] = [
  { key: 'waste', label: 'Waste removal', unit: 'job', sight: 'photo', valueRole: 'visible' },
  { key: 'rewire', label: 'Electrical rewire', unit: 'job', sight: 'hidden', valueRole: 'hidden' },
  { key: 'boiler', label: 'Boiler', unit: 'job', sight: 'if_visible', valueRole: 'hidden' },
  { key: 'radiators', label: 'Radiators', unit: 'each', sight: 'photo', valueRole: 'visible' },
  { key: 'water_tank', label: 'Water tank', unit: 'job', sight: 'hidden', valueRole: 'hidden' },
  { key: 'pipework', label: 'Bathroom pipework and drainage', unit: 'job', sight: 'hidden', valueRole: 'hidden' },
  { key: 'bathroom', label: 'New bathroom', unit: 'each', sight: 'photo', valueRole: 'visible' },
  { key: 'plaster', label: 'Plastering', unit: 'room', sight: 'photo', valueRole: 'visible' },
  { key: 'skirting', label: 'Skirting and architraves', unit: 'room', sight: 'photo', valueRole: 'visible' },
  { key: 'paint', label: 'Paint', unit: 'room', sight: 'photo', valueRole: 'visible' },
  { key: 'kitchen', label: 'Kitchen', unit: 'job', sight: 'photo', valueRole: 'visible' },
  { key: 'carpet', label: 'Carpet', unit: 'room', sight: 'photo', valueRole: 'visible' },
  { key: 'roof', label: 'Roof', unit: 'job', sight: 'if_visible', valueRole: 'hidden' },
  { key: 'windows', label: 'UPVC windows', unit: 'each', sight: 'photo', valueRole: 'visible' },
  { key: 'outside_doors', label: 'UPVC doors', unit: 'each', sight: 'photo', valueRole: 'visible' },
  { key: 'internal_doors', label: 'Internal doors', unit: 'each', sight: 'photo', valueRole: 'visible' },
  { key: 'damp', label: 'Damp proofing', unit: 'wall', sight: 'if_visible', valueRole: 'hidden' },
];

export const LINE_KEYS: readonly LineKey[] = LINE_SPECS.map((s) => s.key);

const SPEC_BY_KEY = new Map(LINE_SPECS.map((s) => [s.key, s]));

export function isLineKey(v: unknown): v is LineKey {
  return typeof v === 'string' && SPEC_BY_KEY.has(v as LineKey);
}

export function lineSpec(key: LineKey): LineSpec {
  return SPEC_BY_KEY.get(key)!;
}

/** Never priced; always listed under "not priced in". */
export const GARDEN_NOTE = 'Garden: not priced in.';

/** One line of the guide: the estimate's, or a member's edited or added one. */
export interface WorksLine {
  /** A LineKey, or "own-<n>" for a line a member added. */
  key: string;
  label: string;
  unit: LineUnit;
  /** £ a unit, VAT included. */
  unitCost: number;
  quantity: number;
  status: LineStatus;
  valueRole: ValueRole;
  /** Why, from the photos ("dated units and worktops"). Private: shown only after the deal is opened. */
  reason: string | null;
  /** Which photos it rests on, numbered from 1 in the order the check used. Private, as above. */
  photos: number[];
  /** A line the member added. */
  own?: boolean;
}

export function lineCost(l: Pick<WorksLine, 'unitCost' | 'quantity'>): number {
  const c = l.unitCost * l.quantity;
  return Number.isFinite(c) && c > 0 ? Math.round(c) : 0;
}

/** What the photo check found, validated (photo-check-schema.ts). */
export interface LineFinding {
  status: LineStatus;
  reason: string;
  photos: number[];
}

export type PhotoCondition = 'ready' | 'light' | 'full';

export interface PhotoFindings {
  condition: PhotoCondition;
  /** Null when no photo shows the kitchen. */
  kitchenSize: KitchenSize | null;
  lines: Partial<Record<LineKey, LineFinding>>;
  /** Whole-property counts, only where the photos make them plain; null otherwise. */
  counts: {
    rooms: number | null;
    radiators: number | null;
    windows: number | null;
    outsideDoors: number | null;
    internalDoors: number | null;
    bathrooms: number | null;
  };
}

export interface PropertyFacts {
  bedrooms: number;
  bathrooms: number | null;
  propertyKind: 'house' | 'flat';
  /** From the listing when it states it; scales the rewire. */
  floorAreaSqft: number | null;
}

export interface Quantities {
  rooms: number;
  bathrooms: number;
  radiators: number;
  carpets: number;
  windows: number;
  outsideDoors: number;
  internalDoors: number;
  dampWalls: number;
  roofs: number;
  /** The rewire as a share of the baseline house. */
  rewireScale: number;
  /** How the rewire was scaled, for the working section. */
  rewireBasis: 'floor_area' | 'rooms';
}

const whole = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null);

/** A photo count can only lower a quantity; a missing or silly one leaves it. */
function lowered(base: number, photo: number | null | undefined): number {
  const p = whole(photo);
  return p === null ? base : Math.min(base, p);
}

export function quantitiesFor(facts: PropertyFacts, counts: Partial<PhotoFindings['counts']> = {}, q: ProjectQuantities = DEFAULT_PROJECT_QUANTITIES): Quantities {
  const beds = Math.max(0, whole(facts.bedrooms) ?? 0);
  const flat = facts.propertyKind === 'flat';
  const baseRooms = beds + q.roomsPlusBedrooms;
  const rooms = Math.max(1, lowered(baseRooms, counts.rooms));
  const bathrooms = Math.max(1, lowered(Math.max(1, whole(facts.bathrooms) ?? q.defaultBathrooms), counts.bathrooms));
  const area = typeof facts.floorAreaSqft === 'number' && Number.isFinite(facts.floorAreaSqft) && facts.floorAreaSqft > 0 ? facts.floorAreaSqft : null;
  return {
    rooms,
    bathrooms,
    radiators: lowered(rooms + bathrooms, counts.radiators),
    carpets: Math.min(rooms, beds + q.carpetsPlusBedrooms),
    windows: lowered(rooms + q.windowsPlusRooms, counts.windows),
    outsideDoors: lowered(flat ? q.outsideDoorsFlat : q.outsideDoorsHouse, counts.outsideDoors),
    internalDoors: lowered(rooms, counts.internalDoors),
    dampWalls: flat ? q.dampWallsFlat : q.dampWallsHouse,
    roofs: flat ? 0 : 1,
    rewireScale: area !== null ? area / q.rewireBaselineSqft : baseRooms / q.rewireBaselineRooms,
    rewireBasis: area !== null ? 'floor_area' : 'rooms',
  };
}

/** The kitchen when the photos can't size it: the middle size. */
export const DEFAULT_KITCHEN: KitchenSize = 'big';

function unitCostOf(key: LineKey, r: ProjectRates, qty: Quantities, kitchen: KitchenSize): number {
  switch (key) {
    case 'waste':
      return r.waste;
    case 'rewire':
      return Math.round(r.rewire * qty.rewireScale);
    case 'boiler':
      return r.boiler;
    case 'radiators':
      return r.radiator;
    case 'water_tank':
      return r.waterTank;
    case 'pipework':
      return r.pipework;
    case 'bathroom':
      return r.bathroom;
    case 'plaster':
      return r.plaster;
    case 'skirting':
      return r.skirting;
    case 'paint':
      return r.paint;
    case 'kitchen':
      return Math.round(r.kitchen * r.kitchenFactors[kitchen]);
    case 'carpet':
      return r.carpet;
    case 'roof':
      return r.roof;
    case 'windows':
      return r.window;
    case 'outside_doors':
      return r.outsideDoor;
    case 'internal_doors':
      return r.internalDoor;
    case 'damp':
      return r.damp;
  }
}

function quantityOf(key: LineKey, qty: Quantities): number {
  switch (key) {
    case 'radiators':
      return qty.radiators;
    case 'bathroom':
      return qty.bathrooms;
    case 'plaster':
    case 'skirting':
    case 'paint':
      return qty.rooms;
    case 'carpet':
      return qty.carpets;
    case 'roof':
      return qty.roofs;
    case 'windows':
      return qty.windows;
    case 'outside_doors':
      return qty.outsideDoors;
    case 'internal_doors':
      return qty.internalDoors;
    case 'damp':
      return qty.dampWalls;
    default:
      return 1;
  }
}

/**
 * The estimate's lines from the photo check's findings. Hidden lines are
 * always "can't tell"; a line the check left out reads as "can't tell" (never
 * as not needed); a line with no quantity (a flat's roof) is left out with
 * its reason; waste is needed when anything is, and can't tell otherwise.
 */
export function linesFromFindings(facts: PropertyFacts, findings: PhotoFindings, rates: ProjectRates = DEFAULT_PROJECT_RATES, q: ProjectQuantities = DEFAULT_PROJECT_QUANTITIES): WorksLine[] {
  const qty = quantitiesFor(facts, findings.counts, q);
  const kitchen = findings.kitchenSize ?? DEFAULT_KITCHEN;
  const lines: WorksLine[] = [];
  for (const spec of LINE_SPECS) {
    if (spec.key === 'waste') continue;
    const quantity = quantityOf(spec.key, qty);
    const f = findings.lines[spec.key];
    let status: LineStatus;
    let reason: string | null = f?.reason?.trim() || null;
    let photos = f?.photos ?? [];
    if (quantity <= 0) {
      status = 'not_needed';
      reason = spec.key === 'roof' ? 'A flat: no roof of its own to price.' : 'None to price.';
      photos = [];
    } else if (spec.sight === 'hidden') {
      status = 'cant_tell';
      reason = 'Hidden: photos never show it.';
      photos = [];
    } else {
      status = f?.status ?? 'cant_tell';
      if (!f) reason = 'Not clear from the photos.';
    }
    if (spec.key === 'kitchen' && status !== 'not_needed' && findings.kitchenSize === null) reason = `${reason ?? 'Not clear from the photos.'} Size not clear: priced as big.`;
    lines.push({ key: spec.key, label: spec.key === 'kitchen' ? `Kitchen (${kitchenLabel(kitchen)})` : spec.label, unit: spec.unit, unitCost: unitCostOf(spec.key, rates, qty, kitchen), quantity, status, valueRole: spec.valueRole, reason, photos: [...photos] });
  }
  return withWaste(lines, rates);
}

export function kitchenLabel(size: KitchenSize): string {
  return size === 'extra_big' ? 'extra big' : size;
}

/**
 * Waste removal, first: one job when any works are needed, can't tell while
 * only unsettled lines remain. For the estimate only; in a member's version
 * the waste line is theirs to switch like any other.
 */
export function withWaste(lines: WorksLine[], rates: ProjectRates = DEFAULT_PROJECT_RATES): WorksLine[] {
  const rest = lines.filter((l) => l.key !== 'waste');
  const counted = rest.filter((l) => lineCost(l) > 0);
  const status: LineStatus = counted.some((l) => l.status === 'needed') ? 'needed' : counted.some((l) => l.status === 'cant_tell') ? 'cant_tell' : 'not_needed';
  const reason = status === 'needed' ? 'Any works leave waste to clear.' : status === 'cant_tell' ? 'Only if the unsettled works turn out to be needed.' : 'No works to clear up after.';
  return [{ key: 'waste', label: lineSpec('waste').label, unit: 'job', unitCost: rates.waste, quantity: 1, status, valueRole: 'visible', reason, photos: [] }, ...rest];
}

/**
 * The most a property's works could honestly come to before any paid check:
 * every visible line needed at full quantities with an extra-big kitchen, the
 * boiler, roof and damp fine (they would only lower the value added), and the
 * hidden lines unsettled. The free best-case test (hold.ts) runs on this.
 */
export function bestCaseLines(facts: PropertyFacts, rates: ProjectRates = DEFAULT_PROJECT_RATES, q: ProjectQuantities = DEFAULT_PROJECT_QUANTITIES): WorksLine[] {
  const lines: Partial<Record<LineKey, LineFinding>> = {};
  for (const spec of LINE_SPECS) {
    if (spec.sight === 'photo') lines[spec.key] = { status: 'needed', reason: '', photos: [] };
    else if (spec.sight === 'if_visible') lines[spec.key] = { status: 'not_needed', reason: '', photos: [] };
  }
  return linesFromFindings(facts, { condition: 'full', kitchenSize: 'extra_big', lines, counts: { rooms: null, radiators: null, windows: null, outsideDoors: null, internalDoors: null, bathrooms: null } }, rates, q);
}

export interface WorksSummary {
  /** Lines clearly needed, before contingency. */
  neededLines: number;
  /** Lines the photos can't settle (and hidden ones), before contingency. */
  cantTellLines: number;
  /** The range, contingency included, to the pound. */
  low: number;
  high: number;
  contingencyPct: number;
  /** For the value: visible lines needed (2×) … */
  visibleNeeded: number;
  /** … and what counts at cost at the high end: hidden fixes needed plus every unsettled line (1×). */
  atCostHigh: number;
}

export function summariseWorks(lines: readonly WorksLine[], contingencyPct: number = DEFAULT_PROJECT_RATES.contingencyPct): WorksSummary {
  let needed = 0;
  let cantTell = 0;
  let visibleNeeded = 0;
  let atCost = 0;
  for (const l of lines) {
    const c = lineCost(l);
    if (c <= 0) continue;
    if (l.status === 'needed') {
      needed += c;
      if (l.valueRole === 'visible') visibleNeeded += c;
      else atCost += c;
    } else if (l.status === 'cant_tell') {
      cantTell += c;
      atCost += c;
    }
  }
  const k = 1 + Math.max(0, contingencyPct) / 100;
  return { neededLines: needed, cantTellLines: cantTell, low: Math.round(needed * k), high: Math.round((needed + cantTell) * k), contingencyPct, visibleNeeded, atCostHigh: atCost };
}

/** What the estimate calls the property: released as an ordinary deal, or a project of either size. */
export type ProjectLevelOrReady = 'ready' | 'light' | 'full';
export type ProjectLevel = 'light' | 'full';

/**
 * Light or full (decided, Q4): the photos' rating, overridden by the clearly
 * needed works (the low end): above £15,000 is a full project whatever the
 * photos say; a full rating below £5,000 is a light refresh. A "ready to go"
 * rating with at least £5,000 of clearly needed works is not ready to go: it
 * is a light refresh (the same line read the other way).
 */
export function levelFor(condition: PhotoCondition, lowWorks: number, c: ProjectCostsSettings = DEFAULT_PROJECT_COSTS): ProjectLevelOrReady {
  if (lowWorks > c.fullAboveWorks) return 'full';
  if (condition === 'full') return lowWorks < c.lightBelowWorks ? 'light' : 'full';
  if (condition === 'light') return 'light';
  return lowWorks >= c.lightBelowWorks ? 'light' : 'ready';
}

export const LEVEL_LABELS: Record<ProjectLevel, string> = { light: 'Light refresh', full: 'Full project' };
