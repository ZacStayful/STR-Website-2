"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PipelineStatus } from "@/lib/listing/pipeline";
import type { StepKind } from "@/lib/pipeline/types";
import { moveFromNextStepAction, type MoveResult } from "@/app/my-deals/next-step-actions";

const ERRORS: Record<Exclude<MoveResult, { ok: true }>["error"], string> = {
  signed_out: "Sign in again to do that.",
  missing: "This deal is no longer available.",
  gone: "This deal has gone off the market.",
  failed: "That didn’t save. Please try again.",
  needs_open: "Open this deal first.",
};

/** The one-tap stage move ("I've sent it → move to Contacted"), through Batch 5's stage rules. */
export function MoveButton({ itemKey, stage, kind, label }: { itemKey: string; stage: PipelineStatus; kind: StepKind; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function move() {
    setError(null);
    start(async () => {
      const res = await moveFromNextStepAction(itemKey, stage, kind);
      if (res.ok) router.refresh();
      else setError(ERRORS[res.error]);
    });
  }

  return (
    <div>
      <button type="button" onClick={move} disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
        {label}
      </button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
