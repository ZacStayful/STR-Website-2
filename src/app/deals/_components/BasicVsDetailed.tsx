/**
 * Replaces the old small-print disclaimer on the deal sheet and the public
 * share page (Batch 10): what this page's figures are, and what a Full
 * analysis adds.
 */
export function BasicVsDetailed({ className = "" }: { className?: string }) {
  return (
    <section className={"rounded-xl border border-border bg-card p-4 text-xs " + className} aria-label="Basic and detailed figures">
      <p className="font-semibold text-foreground">Basic vs detailed</p>
      <p className="mt-1 text-muted-foreground">
        <span className="font-medium text-foreground">This sheet is the basic estimate</span> for the area and size, shown as a range.
      </p>
      <p className="mt-1 text-muted-foreground">
        <span className="font-medium text-foreground">A Full analysis is detailed for this property:</span> real nearby listings, month-by-month occupancy and nightly rate, and its costs.
      </p>
      <p className="mt-1 text-muted-foreground">Neither is a guarantee of income or financial advice.</p>
    </section>
  );
}
