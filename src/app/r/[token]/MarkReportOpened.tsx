"use client";

import { useEffect, useRef } from "react";
import { markReportOpenedAction } from "./actions";

/**
 * The prospect reopening their report counts as the lead still being in use
 * (src/lib/leads/retention.ts). Recorded from the browser rather than the
 * server render, so an email security scanner fetching the link on delivery
 * — which runs no script — does not count as a visit.
 */
export function MarkReportOpened({ token }: { token: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void markReportOpenedAction(token);
  }, [token]);
  return null;
}
