"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PIPELINE_STATUSES, stageNeedsOpen, type PipelineStatus } from "@/lib/listing/pipeline";
import { formatOpenPrice } from "@/lib/marketplace/ladder";
import { openDealAction } from "@/app/deals/actions";
import { setDealStageAction, type StageActionResult } from "../actions";

const ERRORS: Record<Exclude<StageActionResult, { ok: true }>["error"], string> = {
  signed_out: "Sign in again to do that.",
  missing: "This deal is no longer available.",
  gone: "This deal has gone off the market, so it can’t be opened.",
  failed: "That didn’t save. Please try again.",
  needs_open: "Open this deal first.",
};

/**
 * The stage dropdown on a My deals item and on the deal page. Free, and every
 * change sends the stage asked for (never "next"), so a replay lands in the
 * same place.
 *
 * A deal nobody on the team has opened can only be Kept or Passed: choosing a
 * later stage does not save anything, it shows what opening costs and the
 * button that opens it (openDealAction, carrying the stage and where to come
 * back to). The server refuses the stage too, whatever this shows.
 */
export function StageSelect({
  itemKey,
  stage,
  opened,
  dealId = null,
  dealLive = true,
  openPence = null,
  back,
  compact = false,
  untracked = false,
}: {
  /** The My deals key: `d-<dealId>` or `l-<checkedListingId>`. */
  itemKey: string;
  stage: PipelineStatus;
  /** The member may see the address (their team opened it, or it is their own listing). */
  opened: boolean;
  /** For an unopened marketplace deal: what the open button opens. */
  dealId?: string | null;
  dealLive?: boolean;
  /** What opening costs this member, for an unopened deal. */
  openPence?: number | null;
  /** Where to land after opening (a My deals focus path, or the deal page). */
  back: string;
  compact?: boolean;
  /** Not on My deals yet (the deal page, for a deal the member has not kept): the dropdown starts on "Not in My deals". */
  untracked?: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<PipelineStatus | "">(untracked ? "" : stage);
  const [wanted, setWanted] = useState<PipelineStatus | null>(null);
  const [price, setPrice] = useState<number | null>(openPence);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: PipelineStatus) {
    if (pending || next === current) return;
    setError(null);
    if (!opened && stageNeedsOpen(next)) {
      setWanted(next);
      return;
    }
    setWanted(null);
    const before = current;
    setCurrent(next);
    startTransition(async () => {
      const res = await setDealStageAction(itemKey, next);
      if (res.ok) {
        router.refresh();
        return;
      }
      setCurrent(before);
      if (res.error === "needs_open") {
        setPrice(res.openPence);
        setWanted(next);
      } else setError(ERRORS[res.error]);
    });
  }

  const label = PIPELINE_STATUSES.find((s) => s.key === current)?.label ?? "Not in My deals";

  return (
    <div className={compact ? "" : "space-y-2"}>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={compact ? "sr-only" : ""}>Stage</span>
        <select
          value={current}
          disabled={pending}
          onChange={(e) => choose(e.target.value as PipelineStatus)}
          aria-label={`Stage: ${label}`}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-sm font-medium text-foreground disabled:opacity-60 sm:flex-none"
        >
          {current === "" && (
            <option value="" disabled>
              Not in My deals
            </option>
          )}
          {PIPELINE_STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
              {!opened && stageNeedsOpen(s.key) ? " (open first)" : ""}
            </option>
          ))}
        </select>
      </label>

      {wanted && (
        <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-sm" role="status">
          {dealId && dealLive ? (
            <form action={openDealAction}>
              <input type="hidden" name="id" value={dealId} />
              <input type="hidden" name="stage" value={wanted} />
              <input type="hidden" name="back" value={back} />
              <p className="font-semibold text-foreground">Contacting the agent needs the deal opened</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The address and the listing link come with the open. We check it is still on the market before charging, then move it to “{PIPELINE_STATUSES.find((s) => s.key === wanted)?.label}”.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
                  Open this deal to contact the agent{price !== null ? ` · ${formatOpenPrice(price)}` : ""}
                </button>
                <button type="button" onClick={() => setWanted(null)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                  Not now
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="text-foreground">This deal is off the market, so it can’t be opened. It can stay Kept or be Passed.</p>
              <button type="button" onClick={() => setWanted(null)} className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                OK
              </button>
            </>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
