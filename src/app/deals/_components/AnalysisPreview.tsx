/**
 * What a Full analysis will hold, before it is bought (Batch 10): the real
 * section headings of the report and an empty chart outline. No figures:
 * those are what the analysis is for.
 */
const SECTIONS = [
  "Revenue and occupancy, month by month",
  "Comparable short lets nearby",
  "The deal at your finance: costs, mortgage, cash flow",
  "Long-let comparison",
  "Due diligence: flood, EPC, designations",
  "Demand drivers and local events",
  "Risk and verdict",
];

export function AnalysisPreview() {
  const bars = [38, 46, 58, 72, 84, 92, 96, 90, 74, 60, 48, 42];
  return (
    <section className="mt-4 rounded-xl border border-dashed border-border bg-card p-4" aria-label="Inside a Full analysis">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inside a Full analysis</p>
      <div className="mt-3 flex h-20 items-end gap-1" aria-hidden="true">
        {bars.map((h, i) => (
          <div key={i} className="flex-1 rounded-t border border-dashed border-muted-foreground/40" style={{ height: `${h}%` }} />
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Income by month for this property, once analysed</p>
      <ol className="mt-3 grid gap-1 text-xs text-foreground sm:grid-cols-2">
        {SECTIONS.map((s, i) => (
          <li key={s} className="flex gap-2">
            <span className="text-muted-foreground">{i + 1}.</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
