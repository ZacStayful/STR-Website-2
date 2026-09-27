"use client";

import { useEffect } from "react";

/**
 * Tells the server, once, that a Full analysis reminder is on screen
 * (POST /api/deals/[id]/reminder, logged as reminder_shown). Pass null while
 * it is not shown. Remembered in this browser once sent; the server keeps
 * one per member, deal, place and stage in any case.
 */
export function useReminderSeen(seen: { dealId: string; where: "stage" | "kept_step"; stage: string } | null): void {
  const dealId = seen?.dealId ?? null;
  const where = seen?.where ?? null;
  const stage = seen?.stage ?? null;
  useEffect(() => {
    if (!dealId || !where || !stage) return;
    const key = `sf:analysis-reminder-seen:${where}:${dealId}:${stage}`;
    try {
      if (window.localStorage.getItem(key) === "1") return;
    } catch {
      /* storage blocked: send it; the server keeps one */
    }
    void fetch(`/api/deals/${encodeURIComponent(dealId)}/reminder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ where, stage }),
      keepalive: true,
    })
      .then((res) => {
        if (!res.ok) return;
        try {
          window.localStorage.setItem(key, "1");
        } catch {
          /* storage blocked */
        }
      })
      .catch(() => undefined);
  }, [dealId, where, stage]);
}

/** The same, for a server component to drop in beside a reminder it renders. */
export function ReminderSeen(props: { dealId: string; where: "stage" | "kept_step"; stage: string }): null {
  useReminderSeen(props);
  return null;
}
