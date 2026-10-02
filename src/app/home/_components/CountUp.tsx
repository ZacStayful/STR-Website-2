"use client";

import { useEffect, useState } from "react";

const DURATION_MS = 900;

/**
 * A Home figure that counts up from 0 once (Batch 22e). With reduced motion
 * asked for, or before the script runs, it shows the figure as it is.
 */
export function CountUp({ value }: { value: number }) {
  const target = Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  const [shown, setShown] = useState(target);

  useEffect(() => {
    if (target === 0) return;
    if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / DURATION_MS);
      setShown(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return <span className="tabular-nums">{shown.toLocaleString("en-GB")}</span>;
}
