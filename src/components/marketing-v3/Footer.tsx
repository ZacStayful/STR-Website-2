import Link from "next/link";

export function Footer() {
  return (
    <footer className="v3-footer">
      <div className="wrap">
        <div className="v3-footer-grid">
          <div>
            <Link href="/" className="brand" style={{ textDecoration: "none" }}>
              <img
                src="/assets/stayful-logo.png"
                alt="Stayful"
                className="brand-logo"
              />
            </Link>
            <p className="muted" style={{ marginTop: 12, maxWidth: "36ch", fontSize: 14 }}>
              The decision engine for short-term rental. Built in the UK for owners,
              investors and operators.
            </p>
          </div>

          <div className="v3-footer-col">
            <div className="v3-footer-h">Product</div>
            <Link href="/features">Features</Link>
            <Link href="/income-calculator">Income calculator</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/demo">Sample report</Link>
          </div>

          <div className="v3-footer-col">
            <div className="v3-footer-h">Company</div>
            <Link href="/about">About</Link>
            <Link href="/short-term-vs-long-term-letting">Short-let vs long-let</Link>
            <a href="https://stayful.co.uk" target="_blank" rel="noopener noreferrer">
              Management service
            </a>
            <a href="mailto:hello@stayful.co.uk">Contact</a>
          </div>

          <div className="v3-footer-col">
            <div className="v3-footer-h">Account</div>
            <Link href="/login">Sign in</Link>
            <Link href="/signup">Start free trial</Link>
          </div>
        </div>

        <div className="v3-footer-bottom">
          <span className="muted">
            © {new Date().getFullYear()} Stayful Ltd. Registered in England &amp; Wales.
          </span>
          <span className="muted">
            Data: Airbtics · PropertyData · Google Places · Ticketmaster
          </span>
        </div>
      </div>
    </footer>
  );
}
