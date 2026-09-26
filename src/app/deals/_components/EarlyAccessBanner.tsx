import Link from "next/link";

/**
 * The one line a free member sees about deals they cannot see yet: the real
 * count and the way to see them now. Nothing about any one deal. The page
 * passes null (and this draws nothing) when the count is zero. `returnTo` is
 * where the upgrade flow sends the member back to: the page the banner is on.
 */
export function EarlyAccessBanner({ text, returnTo = "/deals" }: { text: string | null; returnTo?: string }) {
  if (!text) return null;
  return (
    <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
      <p className="text-sm font-medium text-foreground">{text}</p>
      <Link href={`/upgrade?redirect=${encodeURIComponent(returnTo)}`} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
        Upgrade
      </Link>
    </section>
  );
}
