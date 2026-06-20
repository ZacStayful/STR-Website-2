import Link from "next/link";
import Image from "next/image";
import { Icon } from "@/lib/icons";

export function Nav() {
  return (
    <header className="v3-nav">
      <div className="v3-nav-inner">
        <Link href="/" className="brand" aria-label="Stayful Intelligence">
          <Image
            src="/assets/stayful-logo.png"
            alt="Stayful"
            width={75}
            height={44}
            className="brand-logo"
            priority
          />
          <span className="brand-sub">Intelligence</span>
        </Link>
        <nav className="v3-nav-links">
          <Link href="/features">Features</Link>
          <Link href="/income-calculator">Calculator</Link>
          <Link href="/short-term-vs-long-term-letting">Why us</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/about">About</Link>
        </nav>
        <div className="v3-nav-cta">
          <Link className="btn btn-ghost btn-sample" href="/demo">
            Sample report
          </Link>
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
