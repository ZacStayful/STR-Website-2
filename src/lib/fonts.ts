import { Cormorant_Garamond, Inter, JetBrains_Mono, Caveat, Playfair_Display, DM_Sans } from "next/font/google";

/**
 * Every web font the site loads, registered exactly once.
 *
 * Each `next/font` call is a separate registration that Turbopack resolves at
 * build time, and we were making eight of them for six families: Inter twice
 * (root layout and the marketing set, under different variable names and with
 * different weights) and DM Sans twice (`--font-dmsans` for /markets,
 * `--font-dm-sans` for /str-report, differing only by a hyphen). Duplicate
 * registrations of the same family are pure waste, and the near-identical
 * variable names were an accident waiting to happen.
 *
 * Layouts import only the variables they need, so a route still mounts just its
 * own fonts — the browser never downloads a face that nothing uses.
 */

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

/**
 * Serves both the analyser (which is designed in Inter) and the marketing set.
 * 600 is the heaviest weight the site loads — see STAYFUL_DESIGN_BRIEF.md, and
 * the PDF renderer ships the same three faces.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

const caveat = Caveat({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-caveat",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-playfair",
  display: "swap",
});

/** 400–700 is the superset of what /markets and /str-report each asked for. */
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dmsans",
  display: "swap",
});

export const interVariable = inter.variable;
export const playfairVariable = playfair.variable;
export const dmSansVariable = dmSans.variable;

/**
 * The four variables the marketing-v3 design system (`.sf-page-v3` in
 * globals.css) expects. Shared by the (marketing) layout and the /markets
 * layout so the nav, footer and product page render identically on both.
 */
export const marketingFontClasses = `${cormorant.variable} ${inter.variable} ${jetbrains.variable} ${caveat.variable}`;
