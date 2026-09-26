import type { PipelineStatus } from "@/lib/listing/pipeline";
import type { DealFacts } from "@/lib/pipeline/facts";
import { nextStepFor } from "@/lib/pipeline/server";
import { NextStepCard } from "@/components/pipeline/NextStepCard";

/**
 * The "next step" for a deal at its stage (Batch 7, src/lib/pipeline): what
 * to send the agent, what to check at a viewing, the offer range, what to do
 * once it is secured. On every My deals item (folded) and on the deal page
 * (open).
 *
 * Renders nothing unless the deal is opened (the address and agent details
 * only come with an open) AND is the viewer's own stage to move (not a
 * teammate's item, not a deal they are not tracking). Nothing about the deal
 * is read or sent to the browser before that check.
 */
export async function NextStepSlot(props: {
  stage: PipelineStatus;
  dealId: string | null;
  checkedListingId: string | null;
  opened: boolean;
  /** The My deals key: `d-<dealId>` or `l-<checkedListingId>`. */
  itemKey?: string;
  /** The viewer's own stage: false for a teammate's item or a deal they are not tracking. */
  mine?: boolean;
  /** What the slot shows about the deal (src/lib/pipeline/slot-facts.ts). */
  facts?: DealFacts;
  variant?: "compact" | "full";
}) {
  if (!props.opened || !props.mine || !props.facts) return null;
  const itemKey = props.itemKey ?? (props.dealId ? `d-${props.dealId}` : props.checkedListingId ? `l-${props.checkedListingId}` : null);
  if (!itemKey) return null;
  const view = await nextStepFor({ itemKey, stage: props.stage, facts: props.facts });
  if (!view) return null;
  return <NextStepCard view={view} variant={props.variant ?? "compact"} />;
}
