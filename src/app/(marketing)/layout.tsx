import Link from "next/link";

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
          <Link href="/">Home</Link>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/#case-studies">Case studies</Link>
          <Link href="/login">Sign in</Link>
          <Link
            href="/signup"
            className="sf-btn"
            style={{ padding: "10px 20px", fontSize: "14px" }}
          >
            Try free for 14 days
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
            <h4>Stayful</h4>
            <p>
              Calibrated short-term rental income estimates for UK landlords.
              Real comparables, seasonal demand modelling, honest long-let
              comparison.
            </p>
          </div>
          <div className="sf-footer__col">
            <h4>Product</h4>
            <Link href="/">Overview</Link>
            <Link href="/#how-it-works">How it works</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/#case-studies">Case studies</Link>
          </div>
          <div className="sf-footer__col">
            <h4>Company</h4>
            <a href="https://stayful.co.uk" target="_blank" rel="noopener noreferrer">
              Stayful Management
            </a>
            <a href="mailto:hello@stayful.co.uk">Contact</a>
            <Link href="/#faq">FAQ</Link>
          </div>
          <div className="sf-footer__col">
            <h4>Legal</h4>
            <Link href="/legal/privacy">Privacy policy</Link>
            <Link href="/legal/terms">Terms of service</Link>
          </div>
        </div>
        <div className="sf-footer__base">
          © {new Date().getFullYear()} Stayful Limited. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
