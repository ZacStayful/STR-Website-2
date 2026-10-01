"use client";

import { useEffect } from "react";
import { publishThinking } from "@/lib/intelligence/thinking-signal";
import { ThinkingBackgroundMount } from "@/app/welcome/_components/ThinkingBackgroundMount";

/** Batch 22 (Q50): the thinking background carries on into the view at the member's level, half strength. */
export function ViewBackground({ level }: { level: 0 | 1 | 2 | 3 }) {
  useEffect(() => {
    publishThinking({ level, nextAt: null });
  }, [level]);
  return <ThinkingBackgroundMount strength={0.5} />;
}
