import { Cormorant_Garamond, Inter, JetBrains_Mono, Caveat } from "next/font/google";

// The marketing-v3 design system (`.sf-page-v3` in globals.css) expects these
// four font variables. Shared by the (marketing) layout and the /markets layout
// so the nav, footer and product page render identically on both.
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});
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

export const marketingFontClasses = `${cormorant.variable} ${inter.variable} ${jetbrains.variable} ${caveat.variable}`;
