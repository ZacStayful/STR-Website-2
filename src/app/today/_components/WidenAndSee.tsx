import Link from "next/link";
import { applyWidenAction } from "../tailoring-actions";
import type { WidenOption } from "@/lib/tailoring/widen";
import { GOALS_EDITOR_HREF } from "@/lib/nav";

/**
 * Batch 14: when the must-haves leave today short, what would add more, with
 * real counts. Each is a plain form sending only its key.
 */
export function WidenAndSee({ count, options }: { count: number; options: WidenOption[] }) {
  return (
    <section aria-labelledby="widen" className="rounded-xl border border-border bg-card p-4">
      <h2 id="widen" className="text-sm font-semibold text-foreground">
        {count === 0 ? "Nothing met all your must-haves today" : `Only ${count} deal${count === 1 ? "" : "s"} met all your must-haves today`}
      </h2>
      {options.length > 0 ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">Widen your search and see more today:</p>
          <ul className="mt-3 space-y-2">
            {options.map((o) => (
              <li key={o.key}>
                <form action={applyWidenAction} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <input type="hidden" name="key" value={o.key} />
                  <span className="text-sm text-foreground">
                    <span className="font-medium">{o.label}</span>
                    <span className="text-muted-foreground"> · {o.adds} more deal{o.adds === 1 ? "" : "s"}</span>
                  </span>
                  <button type="submit" className="min-h-9 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
                    Widen
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">No single change would add more today. New deals arrive every morning.</p>
      )}
      <Link href={GOALS_EDITOR_HREF} className="mt-3 inline-block text-sm font-medium text-foreground underline-offset-4 hover:underline">
        Change your must-haves on your profile
      </Link>
    </section>
  );
}
