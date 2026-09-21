import { C, SIZE, TRACK } from "./tokens";
import { pdfFonts } from "./fonts";

/**
 * The report's text roles.
 *
 * The design uses exactly two voices: a letterspaced uppercase monospace for
 * anything that labels something, and a grotesque for anything that says
 * something. Keeping them here — rather than restating fontFamily and
 * letterSpacing on every page — is what stops the two drifting apart.
 *
 * This is the only module that calls `pdfFonts()`, so registration happens once
 * and before any StyleSheet is built.
 */

const F = pdfFonts();

/** True when the real typefaces loaded; false when the built-ins stood in. */
export const usingCustomFonts = F.custom;

const mono = (size: number, letterSpacing: number, color: string, weight: 400 | 500 = 400) => ({
  fontFamily: F.mono,
  fontWeight: weight,
  fontSize: size,
  letterSpacing,
  color,
});

const sans = (size: number, weight: 400 | 700, color: string) => ({
  fontFamily: F.sans,
  fontWeight: weight,
  fontSize: size,
  color,
});

export const T = {
  /** `01 — THE VERDICT`. Always uppercase at the call site. */
  eyebrow: mono(SIZE.label, TRACK.eyebrow, C.INK),
  /** Field labels inside cards and panels. */
  label: mono(SIZE.label, TRACK.label, C.INK),
  labelOnDark: mono(SIZE.label, TRACK.label, C.CREAM),
  /** Running header, footer, masthead meta. */
  meta: mono(SIZE.meta, TRACK.meta, C.INK),
  metaMuted: mono(SIZE.meta, TRACK.meta, C.MUTED),
  /** Table column headings. */
  tableHead: mono(SIZE.label, TRACK.label, C.MUTED),
  /** Axis ticks and other very small mono. */
  micro: mono(SIZE.micro, TRACK.meta, C.MUTED),

  /** The page's one big statement. */
  display: sans(SIZE.display, 700, C.INK),
  /** Section headlines. */
  headline: sans(SIZE.headline, 700, C.INK),
  /** The single explanatory line under a headline. */
  lead: sans(SIZE.lead, 400, C.INK),
  body: sans(SIZE.body, 400, C.INK),
  bodyOnDark: sans(SIZE.body, 400, C.CREAM),
  bodyBold: sans(SIZE.body, 700, C.INK),

  /** Figures, in three sizes. */
  figureXl: sans(SIZE.figureXl, 700, C.CREAM),
  figureLg: sans(SIZE.figureLg, 700, C.INK),
  figureMd: sans(SIZE.figureMd, 700, C.INK),
  figureAccent: sans(SIZE.figureLg, 700, C.ACCENT),
} as const;
