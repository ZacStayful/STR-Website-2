import type { Metadata } from "next";
import { Playfair_Display, DM_Sans } from "next/font/google";
import { Nav } from "@/components/marketing-v3/Nav";
import { Footer } from "@/components/marketing-v3/Footer";
import { AppSwitcher } from "@/components/AppSwitcher";
import { TrialBanner } from "@/components/TrialBanner";
import { getMarketAccess } from "@/lib/market/gate";
import { freeReportsRemaining, trialBannerVariant } from "@/lib/access";
import { isAdminEmail } from "@/lib/admin";
import { checkoutUrlFor } from "@/lib/billing";
import { marketingFontClasses } from "@/lib/marketing-fonts";
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
    default: "Market Explorer — UK Short-Term Rental Areas Ranked | Stayful",
    template: "%s | Stayful Market Explorer",
  },
  description:
    "Rank every UK area by short-term rental yield, occupancy, competition and licensing, tailored to your investment goals. Included with every Stayful trial and subscription.",
};

// The gate reads the session cookie on every request — never prerender.
export const dynamic = "force-dynamic";

/**
 * Members-only gate for the Market Explorer, mirroring /estimate:
 *   • signed out            → public product page, rendered by the page itself
 *                             (no market figures; see requireMarketAccess)
 *   • signed in, no access  → /upgrade, issued by the page so it can carry the
 *                             exact path to return to (see requireMarketAccess)
 *   • admin / pro / trial   → the explorer, with the trial banner for free users
 * Viewing never touches reports_run, so it can't consume a free report.
 * Every page under /markets calls requireMarketAccess() and renders nothing
 * unless the state is 'ok' — see src/lib/market/gate.ts for why.
 */
export default async function MarketsLayout({ children }: { children: React.ReactNode }) {
  const fontVars = `${playfair.variable} ${dmSans.variable} ${marketingFontClasses}`;

  const { state, user, profile } = await getMarketAccess();

  // Signed out: marketing chrome; each page renders the public product page
  // (pages own that decision so an unknown area slug can still 404 and no
  // market data is ever fetched for a visitor).
  if (state === "anon") {
    return (
      <div className={`sf-page-v3 ${fontVars}`}>
        <Nav />
        <main>{children}</main>
        <Footer />
      </div>
    );
  }

  // 'blocked' falls through: the page itself redirects to /upgrade with its
  // own return path, and renders nothing meanwhile.
  const admin = isAdminEmail(user?.email);
  const bannerVariant = trialBannerVariant(profile, admin);

  // The marketing nav/footer need the `.sf-page-v3` scope, but the explorer
  // itself must not sit inside it — its element-level heading rules would
  // compete with the `.mx` styles.
  return (
    <div className={fontVars}>
      <div className="sf-page-v3"><Nav /></div>
      <AppSwitcher active="markets" admin={admin} />
      {bannerVariant && profile && user && (
        <TrialBanner
          variant={bannerVariant}
          remaining={freeReportsRemaining(profile)}
          checkoutHref={checkoutUrlFor(user.id, user.email ?? null)}
        />
      )}
      <div className="mx">{children}</div>
      <div className="sf-page-v3"><Footer /></div>
    </div>
  );
}
