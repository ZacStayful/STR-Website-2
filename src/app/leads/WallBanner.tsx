import Link from "next/link";
import type { FunnelWall } from "@/lib/funnels/alerts";

/**
 * "Your funnel has stopped working, and here is the one thing that fixes it."
 *
 * Every condition behind this was silent before: a customer out of credit kept
 * collecting enquiries that were captured, queued and never reported on, while
 * their prospects were told a report was on the way. The email tells them once;
 * this keeps saying it for as long as it is still true, because the email is
 * about a moment and this is about a state.
 */
export interface WallNotice extends FunnelWall {
  funnelId: string;
  funnelName: string;
}

/** Where a customer goes to fix each wall. Credit is billing, caps are settings. */
function fixFor(notice: WallNotice): { href: string; label: string } {
  return notice.kind === "out_of_credit"
    ? { href: "/account/billing", label: "Top up" }
    : { href: `/leads/funnels/${notice.funnelId}`, label: "Settings" };
}

export function WallBanner({ notices, showFunnelName }: { notices: WallNotice[]; showFunnelName?: boolean }) {
  if (notices.length === 0) return null;
  return (
    <div className="mb-6 space-y-2">
      {notices.map((n) => {
        const fix = fixFor(n);
        return (
          <div
            key={`${n.funnelId}:${n.kind}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4"
          >
            <p className="min-w-0 flex-1 text-sm text-foreground">
              {showFunnelName ? <span className="font-medium">{n.funnelName}: </span> : null}
              {n.message}
            </p>
            <Link
              href={fix.href}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {fix.label}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
