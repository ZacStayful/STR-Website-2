/**
 * The photo (or built graphic) on every quiz screen, one line each, so a
 * swap is a one-line change. The files are the profile-quiz image set in
 * public/profile-quiz (19 .webp photos, 1200px wide, already resized and
 * blurred where needed); 'map', 'icon' and 'project' are simple graphics
 * drawn in code (src/app/welcome/_components/Graphics.tsx), not photos.
 *
 * Pure: no server-only, so the question list and its tests can read it.
 */

export const QUIZ_IMAGE_DIR = '/profile-quiz';

/** A graphic drawn in code instead of a photo. */
export type Graphic = 'map' | 'icon' | 'project';
export const GRAPHICS: readonly Graphic[] = ['map', 'icon', 'project'];

export const QUIZ_IMAGES = {
  // Screens
  start: '04-apartment-living-floor-to-ceiling-windows',
  done: '10-bold-maximalist-unicorn',
  // Section A: about you
  roles: '02-flat-living-blue-wall-dining',
  deal_types: '17-bright-modern-living',
  where: 'map',
  budget_buy: '09-bold-maximalist-living-kitchen',
  brrr_budget: '13-terraced-house-living-fireplace',
  budget_source: '15-house-living-marble-wallpaper',
  budget_manage: '15-house-living-marble-wallpaper',
  max_rent: '02-flat-living-blue-wall-dining',
  deals_done: '11-compact-studio-living',
  units_now: '07-large-living-geometric-wall',
  unit_areas: 'map',
  time: '03-bedroom-sage-green',
  next_deal: '06-living-navy-diagonal-wall',
  deals_wanted: '01-flat-living-geometric-wall',
  blocker: '12-compact-kitchen',
  risk_go: '08-bold-maximalist-living',
  risk_avoid: '17-bright-modern-living',
  // Section B: investor buying
  cash_available: '13-terraced-house-living-fireplace',
  funding: '14-period-dining-room',
  finance: 'icon',
  entity: '05-city-bedroom-with-desk',
  main_goal: '15-house-living-marble-wallpaper',
  min_profit: '16-house-living-games',
  property_flat: '04-apartment-living-floor-to-ceiling-windows',
  property_house: '13-terraced-house-living-fireplace',
  bedrooms: '18-bedroom-slatted-wall',
  condition_ready: '17-bright-modern-living',
  condition_project: 'project',
  leasehold: '04-apartment-living-floor-to-ceiling-windows',
  restricted_areas: 'map',
  // Section C: rent-to-rent operator
  r2r_min_profit: '16-house-living-games',
  setup_budget: '18-bedroom-slatted-wall',
  deal_structure: '05-city-bedroom-with-desk',
  break_even: '03-bedroom-sage-green',
  payback: '12-compact-kitchen',
  furnished: '11-compact-studio-living',
  // Section D: deal sourcer (their clients' rent is the max rent question in their words)
  client_rent: '02-flat-living-blue-wall-dining',
  sourcing_fee: '09-bold-maximalist-living-kitchen',
  deals_per_month: '01-flat-living-geometric-wall',
  motivated_sellers: '14-period-dining-room',
  // Section E: management company
  units_managed: '09-bold-maximalist-living-kitchen',
  operating_areas: 'map',
  looking_for: '19-games-room-pool-table',
  growth_target: '06-living-navy-diagonal-wall',
} as const satisfies Record<string, string>;

export type ImageKey = keyof typeof QUIZ_IMAGES;

export type QuizImage = { kind: 'photo'; src: string; name: string } | { kind: 'graphic'; name: Graphic };

/** What to draw for a key: the photo's public path, or the graphic's name. */
export function quizImage(key: ImageKey): QuizImage {
  const name = QUIZ_IMAGES[key];
  if ((GRAPHICS as readonly string[]).includes(name)) return { kind: 'graphic', name: name as Graphic };
  return { kind: 'photo', src: `${QUIZ_IMAGE_DIR}/${name}.webp`, name };
}

/** Every photo file the map refers to, for the test that checks they all exist. */
export function quizPhotoFiles(): string[] {
  return [...new Set(Object.values(QUIZ_IMAGES).filter((v) => !(GRAPHICS as readonly string[]).includes(v)))].map((v) => `${v}.webp`);
}
