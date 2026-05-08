import { Cormorant_Garamond, Inter, JetBrains_Mono, Caveat } from "next/font/google";
import { Nav } from "@/components/marketing-v3/Nav";
import { Footer } from "@/components/marketing-v3/Footer";

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

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const fontClasses = `${cormorant.variable} ${inter.variable} ${jetbrains.variable} ${caveat.variable}`;
  return (
    <div className={`sf-page-v3 ${fontClasses}`}>
      <Nav />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
