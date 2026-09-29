"use client";

import { MessageSquare } from "lucide-react";
import { openFeedback } from "@/lib/feedback/client";

/**
 * A "Feedback" button (Batch 18): in the members' header beside the Profile
 * pill and the usage chip (a shortcut, not a nav item), and in the footer of
 * every members-only page; a plain button on "Your feedback". Each opens the
 * page's one feedback form.
 */
export function FeedbackTrigger({ variant }: { variant: "header" | "footer" | "button" }) {
  if (variant === "header") {
    return (
      <button
        type="button"
        onClick={openFeedback}
        aria-haspopup="dialog"
        title="Tell us about a bug, or an idea"
        style={{ background: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 999, padding: "2px 10px", fontWeight: 600, fontSize: 12, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6, border: 0, cursor: "pointer", fontFamily: "inherit", lineHeight: "inherit" }}
      >
        <MessageSquare aria-hidden="true" size={12} strokeWidth={2.5} />
        Feedback
      </button>
    );
  }
  if (variant === "button") {
    return (
      <button type="button" onClick={openFeedback} aria-haspopup="dialog" className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">
        <MessageSquare aria-hidden="true" size={16} />
        Send feedback
      </button>
    );
  }
  return (
    <button type="button" onClick={openFeedback} aria-haspopup="dialog" className="font-medium text-foreground underline underline-offset-2 hover:opacity-80">
      Send feedback
    </button>
  );
}
