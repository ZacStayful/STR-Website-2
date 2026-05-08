import Link from "next/link";
import { Icon } from "@/lib/icons";

export function Nav() {
  return (
    <header className="v3-nav">
      <div className="v3-nav-inner">
        <Link href="/" className="brand" aria-label="Stayful Intelligence">
          <img
            src="/assets/stayful-logo.png"
            alt="Stayful"
            className="brand-logo"
          />
          <span className="brand-sub">Intelligence</span>
        </Link>
        <nav className="v3-nav-links">
          <a href="/#watch">Watch</a>
          <a href="/#features">Features</a>
          <a href="/#reports">Sample reports</a>
          <a href="/#compare">Why us</a>
          <a href="/#pricing">Pricing</a>
          <a href="/#faq">FAQ</a>
        </nav>
        <div className="v3-nav-cta">
          <Link className="btn btn-ghost" href="/login">
            Sign in
          </Link>
          <Link className="btn btn-primary" href="/signup">
            Start free trial <Icon name="arrow" size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}
