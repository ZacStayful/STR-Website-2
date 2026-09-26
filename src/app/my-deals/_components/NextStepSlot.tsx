import type { PipelineStatus } from "@/lib/listing/pipeline";

/**
 * ─── RESERVED FOR BATCH 7 (pipeline actions) ───
 * The "next step" for a deal at its stage: what to say to the agent, what to
 * ask at a viewing, how to frame an offer. Batch 7 fills this with stage-based
 * scripts. It is placed on every My deals item and on the deal page, and
 * deliberately renders nothing until then: no placeholder copy, no scripts.
 */
export function NextStepSlot(props: { stage: PipelineStatus; dealId: string | null; checkedListingId: string | null; opened: boolean }) {
  void props;
  return null;
}
