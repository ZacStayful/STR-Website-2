/**
 * The report's design tokens, taken from the website.
 *
 * Every colour below is a value that already exists in `src/app/globals.css`,
 * quoted with the custom property it comes from. The report and the site
 * therefore match by construction rather than by eye — and when a brand colour
 * changes there, the only work here is updating the matching constant.
 *
 * The approved design PDF was sampled to recover its layout and its palette,
 * and the two agreed to within a couple of shades on the page and the ink. The
 * places they differed — cards, hairlines, the dark panel — resolve to the
 * site's values, because a report that is nearly the brand colour looks like a
 * mistake next to a page that is.
 */

/** Mixes two hex colours, `t` of the way from `a` to `b`. */
function mix(a: string, b: string, t: number): string {
  const parse = (h: string) => {
    const s = h.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const ch = (x: number, y: number) =>
    Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

/** The raw site tokens, so every value below traces back to globals.css. */
const SITE = {
  /** `--background` / `--stayful-sage` */
  sage: "#d0d6ba",
  /** `--card` and `--primary-foreground` */
  card: "#e6ebd7",
  /** `--primary` / `--sf-green` / `--stayful-green` */
  green: "#5d8156",
  /** `--sf-green-dark` */
  greenDark: "#4a6944",
  /** `--stayful-green` in the site's dark-mode block: the brand green that
   *  works on a dark ground, which is exactly what the panels need. */
  greenOnDark: "#8ab382",
  /** `--border` */
  border: "#aab99b",
  /** `--sf-footer-base`, the deepest brand dark. */
  footerBase: "#1e2a1c",
  /** `.sf-footer__base` text: a desaturated green that reads as secondary. */
  footerMuted: "#8aa088",
  /** `--muted-foreground`: the site's secondary text colour on a light ground. */
  mutedText: "#6e9164",
} as const;

export const C = {
  /** Dark panels, peak bars, headings. */
  INK: SITE.footerBase,
  /** The page itself. */
  PAGE: SITE.sage,
  /** Cards, stat tiles, notice boxes. */
  SURFACE: SITE.card,
  /** Hairline rules and card outlines. */
  BORDER: SITE.border,
  /** Text and the QR field on dark panels. */
  CREAM: SITE.card,
  /** Buttons, hero bars and positive figures *on dark only*. */
  ACCENT: SITE.greenOnDark,
  /**
   * The long-let option, everywhere. Deliberately duller than the ramp.
   * A fill, not a text colour: the site uses it on the dark footer, so it is
   * too light to read as type on the page.
   */
  MUTED: SITE.footerMuted,
  /** Secondary type — table headers, units, captions, the footer line. */
  TEXT_MUTED: SITE.mutedText,
} as const;

/**
 * Ordered darkest → lightest, for stacked bars, dot meters and legends.
 * Index 1 is the brand green; the lighter steps are tints of it toward the
 * card colour, so the whole ramp moves if `--primary` ever does.
 *
 * The tints stop at 60%. Going further lands within a few shades of the page
 * itself, which makes the last segment of a stacked bar — and its swatch in
 * the table beside it — disappear against the background.
 */
export const RAMP = [
  SITE.greenDark,
  SITE.green,
  mix(SITE.green, SITE.card, 0.3),
  mix(SITE.green, SITE.card, 0.45),
  mix(SITE.green, SITE.card, 0.6),
] as const;

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
