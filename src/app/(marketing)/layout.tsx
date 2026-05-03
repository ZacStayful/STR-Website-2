import Link from "next/link";
import { CTA } from "@/lib/cta";
import { BRAND } from "@/lib/brand";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="sf-page">
      <SiteNav />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}

function SiteNav() {
  return (
    <header className="sf-nav">
      <div className="sf-nav__inner">
        <Link href="/" className="sf-nav__logo">
          Stayful
        </Link>
        <nav className="sf-nav__links">
          <Link href="/income-calculator">Calculator</Link>
          <Link href="/features">Features</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/about">About</Link>
          <Link href={CTA.secondaryHref}>{CTA.secondary}</Link>
          <Link
            href={CTA.primaryHref}
            className="sf-btn"
            style={{ padding: "10px 20px", fontSize: "14px" }}
          >
            {CTA.primary}
          </Link>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="sf-footer">
      <div className="sf-footer__inner">
        <div className="sf-footer__cols">
          <div className="sf-footer__brand">
            <h4>{BRAND.name}</h4>
            <p>
              Income-estimate software for UK short-term lets. Find out if your
              property has potential, customise based on comparable nearby
              properties, decide with confidence.
            </p>
          </div>
          <div className="sf-footer__col">
            <h4>Software</h4>
            <Link href="/">Home</Link>
            <Link href="/income-calculator">Calculator</Link>
            <Link href="/features">Features</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/demo">See a sample report</Link>
          </div>
          <div className="sf-footer__col">
            <h4>Compare</h4>
            <Link href="/short-term-vs-long-term-letting">
              Short-term vs long-term letting
            </Link>
            <Link href="/about">About Stayful</Link>
            <a
              href={BRAND.managementUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Stayful Management
            </a>
            <a href={`mailto:${BRAND.contactEmail}`}>Contact</a>
          </div>
          <div className="sf-footer__col">
            <h4>Legal</h4>
            <Link href="/legal/privacy">Privacy policy</Link>
            <Link href="/legal/terms">Terms of service</Link>
          </div>
        </div>
        <div className="sf-footer__base">
          © {new Date().getFullYear()} {BRAND.legalName}. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
