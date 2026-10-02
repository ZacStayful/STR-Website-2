/**
 * The deal an analyser report was opened from, as the narrator may mention it
 * (Batch 23, Part 0, P1): the page's own listing, no new fetches. Pure.
 */
export interface NarratorDeal {
  type: "purchase" | "r2r";
  /** Asking price (purchase) or rent (r2r), whole pounds. */
  amount?: number;
  /** The price's period as the listing shows it. */
  period?: "total" | "pcm" | "pw";
}

/** Only well-formed deal context reaches the model; anything else is dropped. */
export function parseNarratorDeal(raw: unknown): NarratorDeal | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.type !== "purchase" && d.type !== "r2r") return null;
  const out: NarratorDeal = { type: d.type };
  const amount = typeof d.amount === "number" && Number.isFinite(d.amount) && d.amount > 0 && d.amount < 100_000_000 ? Math.round(d.amount) : undefined;
  const period = d.period === "total" || d.period === "pcm" || d.period === "pw" ? d.period : undefined;
  if (amount !== undefined) {
    out.amount = amount;
    out.period = period ?? (d.type === "purchase" ? "total" : "pcm");
  }
  return out;
}

