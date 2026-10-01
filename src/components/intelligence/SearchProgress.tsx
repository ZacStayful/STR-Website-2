"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SEARCH_POLL_MS } from "@/lib/intelligence/config";

/**
 * Batch 22, Part G: while the member's own search runs, the view says so and
 * asks how it is getting on; when it finishes the page refreshes, so finds
 * that beat a card appear (today's list was refreshed on the server).
 */
export function SearchProgress({ running }: { running: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(running);
  const stopped = useRef(false);
  useEffect(() => {
    if (!running) return;
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch("/api/intelligence/status", { cache: "no-store" });
        const s = (await r.json()) as { running?: boolean };
        if (!s.running) {
          setOn(false);
          router.refresh();
          return;
        }
      } catch {
        /* try again */
      }
      if (!stopped.current) timer = setTimeout(tick, SEARCH_POLL_MS);
    };
    timer = setTimeout(tick, SEARCH_POLL_MS);
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [running, router]);
  if (!on) return null;
  return (
    <p className="rounded-xl bg-white/5 p-4 text-center text-sm text-[#B9D5C6]" role="status" aria-live="polite">
      I’m still checking your areas — I’ll add anything better here and in Today.
    </p>
  );
}
