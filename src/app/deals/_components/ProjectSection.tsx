import type { ReactNode } from "react";
import { LEVEL_LABELS, GARDEN_NOTE, lineCost, type WorksLine } from "@/lib/project/costing";
import { moneyLeftInLine, VALUE_DISCLAIMER, WORKS_DISCLAIMER, type ProjectCardData, type ProjectNumbers } from "@/lib/project/headline";
import type { StoredEstimate } from "@/lib/project/read-server";

/**
 * "The project" on a Project deal's sheet (Batch 17, Part F). Before the deal
 * is opened: the headline numbers only (works, value added, profit after
 * works, cash needed). After it is opened: the working, line by line, with
 * why and the photos each line rests on, the value after works and the
 * finance, and (Part G) the member's own figures. Reasons, photo numbers and
 * the photos themselves never reach an unopened sheet.
 */

const gbp = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
const span = (s: { low: number; high: number }) => (Math.round(s.low) === Math.round(s.high) ? gbp(s.high) : `${gbp(s.low)}–${gbp(s.high)}`);

const STATUS: Record<WorksLine["status"], { text: string; tone: string }> = {
  needed: { text: "Needed", tone: "bg-primary/10 text-primary" },
  cant_tell: { text: "Can’t tell", tone: "bg-warning/15 text-foreground" },
  not_needed: { text: "Not needed", tone: "bg-muted text-muted-foreground" },
};

function Fig({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="min-w-0">
      <dd className="text-sm font-bold text-foreground">{value}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}

function photoList(nums: readonly number[]): string | null {
  if (nums.length === 0) return null;
  return nums.length === 1 ? `photo ${nums[0]}` : `photos ${nums.join(", ")}`;
}

export function ProjectSection({ project, numbers, opened, stored, working }: { project: ProjectCardData; numbers: ProjectNumbers; opened: boolean; stored: StoredEstimate | null; working?: ReactNode }) {
  const e = stored?.estimate ?? null;
  const left = moneyLeftInLine(project);
  const shown = e ? e.lines.filter((l) => l.status !== "not_needed") : [];
  const notNeeded = e ? e.lines.filter((l) => l.status === "not_needed") : [];
  return (
    <section aria-labelledby="the-project" className="mt-4 rounded-xl border border-border bg-card p-4">
      <h2 id="the-project" className="text-sm font-semibold text-foreground">
        The project <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{LEVEL_LABELS[project.level]}</span>
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{WORKS_DISCLAIMER}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Fig label="Works" value={numbers.works.replace(/^Works /, "")} sub="including 10% contingency" />
        <Fig label="Value added" value={numbers.valueAdded.replace(/ value added$/, "")} sub={`${project.valueAddedPct.toFixed(1)}% of the value after works`} />
        <Fig label="Profit after works" value={numbers.range ? numbers.range.label : "—"} sub={numbers.range ? numbers.caption : "no income figure yet"} />
        <Fig label="Cash needed" value={numbers.cash ? numbers.cash.replace(/ cash in$/, "") : "—"} sub={project.level === "full" ? `on a bridge, ${project.months} months of works` : `${project.months} months of works`} />
        {left && <Fig label="Money left in" value={left.replace(/ left in after refinance$/, "")} sub={`after refinancing at ${project.refinancePct ?? 75}% of the value`} />}
        <Fig label="Value after works" value={gbp(project.value)} sub={project.ceilingApplied ? "capped by nearby sold prices" : null} />
      </dl>

      {!opened ? (
        <p className="mt-3 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">Open the deal to see the working: each line of works, why we priced it, and the photos it rests on. You can change any line and keep your own figures.</p>
      ) : !e ? (
        <p className="mt-3 text-xs text-muted-foreground">The line-by-line working for this project is not available just now.</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Works</th>
                  <th className="pr-2 font-medium">Quantity</th>
                  <th className="pr-2 text-right font-medium">Cost</th>
                  <th className="pr-2 font-medium">From the photos</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.key} className="border-t border-border align-top">
                    <td className="py-1.5 pr-2 font-medium text-foreground">{l.label}</td>
                    <td className="pr-2 text-muted-foreground">{l.quantity} × {gbp(l.unitCost)}</td>
                    <td className="pr-2 text-right text-foreground">{gbp(lineCost(l))}</td>
                    <td className="pr-2 text-muted-foreground">
                      <span className={"mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold " + STATUS[l.status].tone}>{STATUS[l.status].text}</span>
                      {l.reason}
                      {photoList(l.photos) && <span className="ml-1 text-[11px]">({photoList(l.photos)})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {notNeeded.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">Not needed from the photos: {notNeeded.map((l) => l.label.toLowerCase()).join(", ")}. {GARDEN_NOTE}</p>}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
            <Fig label="Clearly needed" value={gbp(e.works.neededLines)} sub="before contingency" />
            <Fig label="Can’t tell from the photos" value={gbp(e.works.cantTellLines)} sub="counted at the high end" />
            <Fig label="Works range" value={span(e.works)} sub={`with ${e.works.contingencyPct}% contingency`} />
            <Fig label="Value after works" value={gbp(e.value.value)} sub={e.value.ceilingApplied && e.value.ceiling ? `nearby sold prices cap it: ${e.value.ceiling.sales} sales within ${e.value.ceiling.radiusMiles} miles` : "price, twice the visible works, and the rest at cost"} />
            <Fig label="Value added" value={gbp(e.test.valueAdded)} sub={`${e.test.valueAddedPct.toFixed(1)}% of the value, after the works at the high end`} />
            <Fig label="Asking price" value={gbp(e.finance.price)} />
            <Fig label={e.finance.taxName === "SDLT" ? "Stamp duty" : e.finance.taxName} value={gbp(e.finance.stampDuty)} />
            <Fig label="Buying costs" value={gbp(e.finance.buyingCosts)} sub={e.finance.bridge ? "legal, survey and the bridge’s valuation" : "legal and survey"} />
            <Fig label="Holding" value={span(e.finance.holding)} sub={`${e.finance.months} months: bills${e.finance.bridge ? " and the bridge’s interest" : ""}`} />
            <Fig label="Furnishing and setup" value={gbp(e.finance.furnishing)} />
            <Fig label="Total in" value={span(e.finance.totalIn)} />
            <Fig label="Cash needed" value={span(e.finance.cash)} sub={e.finance.bridge ? "the works paid in cash" : "at a 25% deposit"} />
            {e.finance.bridge && <Fig label="Bridging loan" value={gbp(e.finance.bridge.loan)} sub={`${e.finance.bridge.ltvPct}% of the price at ${e.finance.bridge.monthlyPct}% a month, ${gbp(e.finance.bridge.arrangementFee)} arrangement fee`} />}
            {e.finance.refinance && <Fig label="Refinance" value={gbp(e.finance.refinance.loan)} sub={`${e.finance.refinance.pct}% of the value after works`} />}
            {e.finance.refinance && <Fig label="Money left in" value={span(e.finance.refinance.moneyLeftIn)} />}
          </dl>
          {stored && stored.photos.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-foreground">The photos the check looked at</p>
              <ul className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                {stored.photos.map((p, i) => (
                  <li key={p} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p} alt="" loading="lazy" className="aspect-square w-full rounded object-cover" />
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">{i + 1}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {working}
        </>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">{VALUE_DISCLAIMER}</p>
    </section>
  );
}
