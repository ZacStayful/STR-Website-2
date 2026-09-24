import localFont from "next/font/local";

/**
 * Every web font the site loads, registered exactly once, from files we ship.
 *
 * These used to come from `next/font/google`, which downloads them at build
 * time. Google intermittently answers with an extensionless `/l/font?kit=…`
 * URL instead of a `.woff2` one, and Next mishandles that in both bundlers
 * (vercel/next.js#99114): webpack crashes taking an extension off a URL that
 * has none, Turbopack breaks on the `&` in the query string. At about twenty
 * faces a build that reddened roughly one build in four, always a different
 * family, never reproducibly. Self-hosting removes the fetch, so the failure
 * cannot happen.
 *
 * The files in `webfonts/` are Google's own latin-subset variable fonts,
 * fetched by `scripts/fetch-webfonts.mjs` — run it again to refresh or add a
 * family. One variable file spans a whole weight range, so each `weight` below
 * is the range the site used to request as separate static faces.
 *
 * Layouts import only the variables they need, so a page only ever *uses* its
 * own families.
 */

const cormorant = localFont({
  src: [
    { path: "./webfonts/CormorantGaramond.woff2", weight: "400 600", style: "normal" },
    { path: "./webfonts/CormorantGaramond-Italic.woff2", weight: "400 600", style: "italic" },
  ],
  variable: "--font-cormorant",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

/**
 * Serves both the analyser (which is designed in Inter) and the marketing set.
 * 600 is the heaviest weight the site loads — see STAYFUL_DESIGN_BRIEF.md, and
 * the PDF renderer ships the same three faces as TTFs in src/lib/pdf/fonts.
 */
const inter = localFont({
  src: "./webfonts/Inter.woff2",
  weight: "400 600",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = localFont({
  src: "./webfonts/JetBrainsMono.woff2",
  weight: "400 500",
  style: "normal",
  variable: "--font-jetbrains",
  display: "swap",
});

const caveat = localFont({
  src: "./webfonts/Caveat.woff2",
  weight: "500 700",
  style: "normal",
  variable: "--font-caveat",
  display: "swap",
});

const playfair = localFont({
  src: "./webfonts/PlayfairDisplay.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-playfair",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

/** 400–700 is the superset of what /markets and /str-report each asked for. */
const dmSans = localFont({
  src: "./webfonts/DMSans.woff2",
  weight: "400 700",
  style: "normal",
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
