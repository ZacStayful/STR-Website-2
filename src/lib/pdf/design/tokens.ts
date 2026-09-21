/**
 * The report's design tokens.
 *
 * Every value here was sampled from the approved reference PDF rather than
 * eyeballed, so the document and the printed spec agree exactly. The web app's
 * tokens in `globals.css` sit within a shade of PAGE/SURFACE — that is
 * deliberate, not a coincidence to be "tidied up".
 */

export const C = {
  /** Dark panels, peak bars, headings. Near-black green. */
  INK: "#1F2C1B",
  /** The page itself. Sage. */
  PAGE: "#D2D6BD",
  /** Cards, stat tiles, notice boxes — one step up from the page. */
  SURFACE: "#DEE2CC",
  /** Hairline rules and card outlines. */
  BORDER: "#CBCFB9",
  /** Text and the QR field on dark panels. */
  CREAM: "#E6EBD9",
  /** Buttons, hero bars and positive figures *on dark only*. */
  ACCENT: "#A4C191",
  /** The long-let option, everywhere. Deliberately duller than the ramp. */
  MUTED: "#7C8A70",
} as const;

/**
 * Ordered darkest → lightest. Used for stacked bars, dot meters and category
 * legends. Index 1 is the workhorse "primary green".
 */
export const RAMP = ["#3F5637", "#67815D", "#8DA17E", "#A7B498", "#BEC6AC"] as const;

/**
 * Page geometry. A4 at 72dpi. Every chart width derives from CONTENT so that
 * changing the margin cannot leave a chart overhanging the page.
 */
export const PAGE = {
  W: 595.28,
  H: 841.89,
  /** Side margin. The reference's gutter. */
  M: 40,
  /** Usable width: W - 2M. */
  CONTENT: 595.28 - 80,
  /** Space reserved at the top for the running header. */
  HEADER_H: 52,
  /** Space reserved at the bottom for the footer. */
  FOOTER_H: 34,
} as const;

/** Type sizes, so headings stay on a scale rather than being picked per page. */
export const SIZE = {
  display: 30,
  headline: 19,
  figureXl: 34,
  figureLg: 22,
  figureMd: 15,
  lead: 9.5,
  body: 8.5,
  meta: 7.5,
  label: 7,
  micro: 6.2,
} as const;

/** Letterspacing for the uppercase mono roles. */
export const TRACK = {
  label: 1.1,
  meta: 0.9,
  eyebrow: 1.4,
} as const;
