/**
 * Setup cost calculator — default line item data + furnishing-state logic.
 *
 * Edit unit costs here whenever pricing changes — UI components should not
 * contain any hardcoded numbers. Keep field order stable; the UI renders
 * line items in the order they appear in DEFAULT_ITEMS.
 */

export type FurnishingState = "fully" | "part" | "unfurnished";

export type LineItemCategory =
  | "Furniture & Beds"
  | "Soft Furnishings & Décor"
  | "Appliances & Tech"
  | "Kitchen"
  | "Services"
  | "Other";

export interface LineItemDefinition {
  id: string;
  name: string;
  category: LineItemCategory;
  supplier: string;
  qtyByBedrooms: (b: number) => number;
  unitCost: number;
  /** If true, the total is computed directly as qty × unitCost where unitCost
   *  is itself derived from bedrooms. Qty/unitCost inputs are hidden. */
  computedTotal?: boolean;
}

export interface LineItemState {
  id: string;
  name: string;
  category: LineItemCategory;
  supplier: string;
  qty: number;
  unitCost: number;
  active: boolean;
  computedTotal?: boolean;
}

export const DEFAULT_ITEMS: LineItemDefinition[] = [
  // Furniture & Beds
  { id: "double_beds",       name: "Double beds",             category: "Furniture & Beds",            supplier: "Dunelm",       qtyByBedrooms: (b) => b,     unitCost: 350 },
  { id: "zip_link_single",   name: "Zip-link single beds",    category: "Furniture & Beds",            supplier: "Sublime",      qtyByBedrooms: ()  => 0,     unitCost: 660 },
  { id: "sofabed",           name: "Sofabed",                 category: "Furniture & Beds",            supplier: "Dunelm",       qtyByBedrooms: ()  => 1,     unitCost: 750 },
  { id: "coffee_table",      name: "Coffee table",            category: "Furniture & Beds",            supplier: "Argos",        qtyByBedrooms: ()  => 1,     unitCost: 200 },
  { id: "dining_table",      name: "Dining table + chairs",   category: "Furniture & Beds",            supplier: "Argos",        qtyByBedrooms: ()  => 1,     unitCost: 250 },
  { id: "side_tables",       name: "Side tables",             category: "Furniture & Beds",            supplier: "Amazon",       qtyByBedrooms: (b) => b * 2, unitCost: 20 },

  // Soft Furnishings & Décor — qty = bedrooms + 1 (includes living room)
  { id: "soft_furnishings",  name: "Soft furnishings (per room)", category: "Soft Furnishings & Décor", supplier: "Dunelm",       qtyByBedrooms: (b) => b + 1, unitCost: 300 },
  { id: "clothes_rack",      name: "Clothes rack",            category: "Soft Furnishings & Décor",     supplier: "Amazon",       qtyByBedrooms: (b) => b,     unitCost: 20 },
  { id: "paint_per_room",    name: "Paint (per room)",        category: "Soft Furnishings & Décor",     supplier: "B&Q",          qtyByBedrooms: (b) => b + 1, unitCost: 100 },

  // Appliances & Tech
  { id: "tv_and_stand",      name: "TV & stand",              category: "Appliances & Tech",            supplier: "Argos",        qtyByBedrooms: ()  => 1,     unitCost: 350 },
  { id: "electrical_pack",   name: "Electrical pack",         category: "Appliances & Tech",            supplier: "Internal",     qtyByBedrooms: ()  => 1,     unitCost: 330 },

  // Kitchen
  { id: "kitchen_pack",      name: "Kitchen pack (fully stocked)", category: "Kitchen",                 supplier: "Internal",     qtyByBedrooms: ()  => 1,     unitCost: 350 },

  // Services — Labour is a flat computed total: (bedrooms / 2.5) × £750
  { id: "photos",            name: "Professional photos",     category: "Services",                     supplier: "Martyn",       qtyByBedrooms: ()  => 1,     unitCost: 250 },
  { id: "labour",            name: "Labour",                  category: "Services",                     supplier: "Internal",     qtyByBedrooms: (b) => 1,     unitCost: 750, computedTotal: true },

  // Other
  { id: "keysafes",          name: "Keysafes",                category: "Other",                        supplier: "Amazon",       qtyByBedrooms: ()  => 2,     unitCost: 15 },
];

/** Compute the flat labour cost from bedroom count */
export function computeLabourCost(bedrooms: number): number {
  return Math.round((bedrooms / 2.5) * 750);
}

const FURNISHING_OVERRIDES: Record<FurnishingState, Record<string, { active?: boolean; qtyByBedrooms?: (b: number) => number }>> = {
  // Only services + basics: TV, paint, soft furnishings, electrical, kitchen,
  // photos, labour, keysafes. All actual furniture off by default.
  fully: {
    double_beds:     { active: false },
    zip_link_single: { active: false },
    sofabed:         { active: false },
    coffee_table:    { active: false },
    dining_table:    { active: false },
    side_tables:     { active: false },
    clothes_rack:    { active: false },
  },
  // Fully-furnished baseline + coffee table + dining table (commonly missing)
  part: {
    double_beds:     { active: false },
    zip_link_single: { active: false },
    sofabed:         { active: false },
    side_tables:     { active: false },
    clothes_rack:    { active: false },
  },
  // Everything ticked by default — bare property needs it all
  unfurnished: {},
};

export function buildDefaultLineItems(
  furnishing: FurnishingState,
  bedrooms: number,
): LineItemState[] {
  const b = Math.max(1, Math.floor(bedrooms));
  const overrides = FURNISHING_OVERRIDES[furnishing];
  return DEFAULT_ITEMS.map((def) => {
    const o = overrides[def.id];
    const qtyFn = o?.qtyByBedrooms ?? def.qtyByBedrooms;
    const qty = qtyFn(b);
    const active = o?.active ?? true;
    const isLabour = def.id === "labour";
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      supplier: def.supplier,
      qty: isLabour ? 1 : qty,
      unitCost: isLabour ? computeLabourCost(b) : def.unitCost,
      active,
      computedTotal: def.computedTotal,
    };
  });
}

export const CATEGORY_ORDER: LineItemCategory[] = [
  "Furniture & Beds",
  "Soft Furnishings & Décor",
  "Appliances & Tech",
  "Kitchen",
  "Services",
  "Other",
];

export const FURNISHING_LABELS: Record<FurnishingState, string> = {
  fully: "Fully Furnished",
  part: "Part Furnished",
  unfurnished: "Unfurnished",
};
