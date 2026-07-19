import type { Metadata } from "next";
import { Playfair_Display, DM_Sans } from "next/font/google";
import { Nav } from "@/components/marketing-v3/Nav";
import { Footer } from "@/components/marketing-v3/Footer";
import { siteUrl } from "@/lib/url";
import "./markets.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-playfair",
  display: "swap",
});
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dmsans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl("/")),
  title: {
    default: "Market Explorer — UK Short-Term Rental Yields by Area | Stayful",
    template: "%s | Stayful Market Explorer",
  },
  description:
    "Explore UK areas by short-term rental yield potential. Compare average revenue, occupancy, yield-on-cost and licensing rules before you buy — free, no login.",
};

export default function MarketsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${playfair.variable} ${dmSans.variable}`}>
      <Nav />
      <div className="mx">{children}</div>
      <Footer />
    </div>
  );
}
