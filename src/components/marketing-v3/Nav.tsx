"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { Icon } from "@/lib/icons";
import { hasSessionCookie } from "@/lib/auth/session-hint";

const LINKS = [
  { href: "https://intelligence.stayful.co.uk/", label: "Home" },
  { href: "/markets", label: "Market Explorer" },
  { href: "/methodology", label: "Methodology" },
  { href: "/short-term-vs-long-term-letting", label: "Why us" },
  { href: "/features", label: "Features" },
  { href: "/income-calculator", label: "Calculator" },
  { href: "/pricing", label: "Pricing" },
];

// The cookie is read once per render; a sign-in happens on another page.
const noSubscription = () => () => {};

export function Nav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  // A member on a marketing page sees one "Open Today" instead of "Sign in"
  // and "Start free trial" (which the proxy would only bounce to Today).
  // Read from the session cookie once hydrated (false on the server, so the
  // static page renders the same for everyone), via src/lib/auth/session-hint.ts.
  const signedIn = useSyncExternalStore(noSubscription, () => hasSessionCookie(document.cookie), () => false);

  return (
    <header className="v3-nav">
      <div className="v3-nav-inner">
        <Link href="/" className="brand" aria-label="Stayful Intelligence" onClick={close}>
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
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="v3-nav-cta">
          <Link className="btn btn-ghost btn-sample" href="/demo">
            Case studies
          </Link>
          {signedIn ? (
            <Link className="btn btn-primary" href="/today">
              Open Today <Icon name="arrow" size={14} />
            </Link>
          ) : (
            <>
              <Link className="btn btn-ghost" href="/login">
                Sign in
              </Link>
              <Link className="btn btn-primary" href="/signup">
                Start free trial <Icon name="arrow" size={14} />
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="v3-nav-burger"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {open && (
        <div className="v3-nav-mobile">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={close}>
              {l.label}
            </Link>
          ))}
          <Link className="btn btn-ghost btn-sample" href="/demo" onClick={close}>
            Case studies
          </Link>
          {signedIn ? (
            <Link className="btn btn-primary" href="/today" onClick={close}>
              Open Today
            </Link>
          ) : (
            <>
              <Link className="btn btn-ghost" href="/login" onClick={close}>
                Sign in
              </Link>
              <Link className="btn btn-primary" href="/signup" onClick={close}>
                Start free trial
              </Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}
