import Link from "next/link";

/**
 * The one line a free member sees about deals they cannot see yet: the real
 * count and the ways to see them now. Nothing about any one deal. The page
 * passes null (and this draws nothing) when the count is zero. `returnTo` is
 * where the upgrade flow sends the member back to: the page the banner is on.
 * Batch 21 (C32): any payment lifts the delay (hasEverPaid counts a top-up
 * and the starter pack as well as a plan), so the banner offers the pack
 * while it is on offer, otherwise a top-up, beside Upgrade.
 */
export function EarlyAccessBanner({ text, returnTo = "/deals", pack = null }: { text: string | null; returnTo?: string; pack?: { href: string; label: string } | null }) {
  if (!text) return null;
  const primary = "rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90";
  const secondary = "rounded-md border border-primary/40 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-primary/10";
  return (
    <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
      <p className="text-sm font-medium text-foreground">{text}</p>
      <span className="flex flex-wrap gap-2">
        {pack ? (
          <Link href={pack.href} className={primary}>{pack.label}</Link>
        ) : (
          <Link href="/account/billing#topup" className={secondary}>Top up</Link>
        )}
        <Link href={`/upgrade?redirect=${encodeURIComponent(returnTo)}`} className={pack ? secondary : primary}>
          Upgrade
        </Link>
      </span>
    </section>
  );
}
