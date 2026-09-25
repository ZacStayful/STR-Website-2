import Link from "next/link";

/**
 * Under the Deals heading: the "N deals match" line when the member has just
 * arrived from the welcome questions (the count is the grid's own, never a
 * guess), the way back to edit those goals in the Market Explorer, and the
 * two doors that left the nav — the analyser for a property of their own,
 * and the Explorer's map and area rankings.
 */
export function GoalsStrip({ total, fromWelcome }: { total: number; fromWelcome: boolean }) {
  const link = "font-medium text-foreground underline-offset-4 hover:underline";
  return (
    <section className="mb-4 rounded-xl border border-border bg-card px-4 py-3">
      {fromWelcome && (
        <p className="text-base font-semibold text-foreground">
          {total.toLocaleString("en-GB")} deal{total === 1 ? "" : "s"} match what you’re looking for.
        </p>
      )}
      <p className={`${fromWelcome ? "mt-1 " : ""}flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground`}>
        <Link href="/markets?goals=1" className={link}>
          Edit what you’re looking for
        </Link>
        <span>
          Got your own property?{" "}
          <Link href="/estimate" className={link}>
            Paste a link to analyse it
          </Link>
        </span>
        <Link href="/markets" className={link}>
          Browse the map / area rankings
        </Link>
      </p>
    </section>
  );
}
