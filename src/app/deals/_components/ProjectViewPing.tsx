"use client";

import { useEffect } from "react";

/**
 * Records that a Project deal's section was on screen (project_view, once a
 * member, deal and UK day: the server keeps the count). Sent after the page
 * has rendered in the browser, so a prefetch never counts.
 */
export function ProjectViewPing({ dealId }: { dealId: string }) {
  useEffect(() => {
    void fetch(`/api/deals/${dealId}/project`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "view" }), keepalive: true }).catch(() => {});
  }, [dealId]);
  return null;
}

/** The same, for what the member does in the working (opening it, changing or adding a line). */
export function pingProject(dealId: string, event: "working" | "line_edit" | "line_add", line?: string): void {
  void fetch(`/api/deals/${dealId}/project`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, line }), keepalive: true }).catch(() => {});
}
