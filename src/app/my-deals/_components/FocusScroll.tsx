"use client";

import { useEffect } from "react";

/** Brings the item a `?focus=` points at into view once, on arrival. */
export function FocusScroll({ targetId }: { targetId: string | null }) {
  useEffect(() => {
    if (!targetId) return;
    document.getElementById(targetId)?.scrollIntoView({ block: "center" });
  }, [targetId]);
  return null;
}
