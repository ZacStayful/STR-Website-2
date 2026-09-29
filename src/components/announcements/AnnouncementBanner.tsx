"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { BANNER_FOLD_AFTER } from "@/lib/feedback/config";
import { announcementKindLabel, type LiveAnnouncement } from "@/lib/feedback/announcements";

/**
 * What's new (Batch 18): the announcements a member has not yet dismissed or
 * opened, as one banner at the top of the members' pages, newest first
 * (after the third, the rest fold under "N more"). It stays, page after
 * page, until they tap Dismiss or "Take a look"; then it never returns.
 *
 * The banner reports back only once it is really on screen (never from a
 * prefetch). What was dismissed or opened is also remembered in this tab, so
 * Back, Forward or a cached page never shows it again before the server
 * knows. `preview`: admin's editor draws the banner exactly as members will
 * see it, and nothing is reported.
 */

const hidden = new Set<string>();
const reported = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function hide(ids: string[]) {
  for (const id of ids) hidden.add(id);
  version += 1;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => version;
// The server never hides anything, and neither does the first render in the
// browser, so the two always match; what this tab hid is applied just after.
const getServerSnapshot = () => -1;

function post(action: "shown" | "dismiss" | "click", ids: string[]) {
  try {
    void fetch("/api/announcements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ids }), keepalive: true, credentials: "same-origin" }).catch(() => undefined);
  } catch {
    /* never let the banner break the page */
  }
}

export function AnnouncementBanner({ items, preview = false }: { items: LiveAnnouncement[]; preview?: boolean }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [unfolded, setUnfolded] = useState(false);
  const [previewHidden, setPreviewHidden] = useState(false);
  const visible = preview ? (previewHidden ? [] : items) : snapshot === -1 ? items : items.filter((a) => !hidden.has(a.id));
  const listed = unfolded ? visible : visible.slice(0, BANNER_FOLD_AFTER);
  const folded = visible.length - listed.length;
  // Only what is on screen counts as shown: folded ones count once unfolded.
  const listedKey = listed.map((a) => a.id).join(",");

  useEffect(() => {
    if (preview || !listedKey) return;
    const fresh = listedKey.split(",").filter((id) => !reported.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) reported.add(id);
    post("shown", fresh);
  }, [preview, listedKey]);

  if (visible.length === 0) return null;

  const dismiss = () => {
    if (preview) {
      setPreviewHidden(true);
      return;
    }
    const ids = visible.map((a) => a.id);
    hide(ids);
    post("dismiss", ids);
  };

  return (
    <aside aria-label="What’s new" className="border-b border-[#c9d6bf] bg-[#eef3e8] px-4 py-3 text-[#2e3d2b]">
      <div className="mx-auto flex max-w-5xl items-start gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          {(visible.length > 1 || preview) && (
            <p className="text-xs font-semibold uppercase tracking-widest text-[#5d8156]">
              What’s new{preview ? " · preview" : ""}
            </p>
          )}
          {listed.map((a) => (
            <div key={a.id}>
              <p className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.kind === "feature" ? "bg-[#2e3d2b] text-white" : "bg-[#d7e4f2] text-[#1e3a5f]"}`}>{announcementKindLabel(a.kind)}</span>
                <strong className="text-sm">{a.title}</strong>
              </p>
              <p className="mt-1 whitespace-pre-line break-words text-sm text-[#3d4a38]">{a.body}</p>
              {a.linkPath && (
                <Link
                  href={a.linkPath}
                  prefetch={false}
                  onClick={(e) => {
                    if (preview) {
                      e.preventDefault();
                      return;
                    }
                    hide([a.id]);
                    post("click", [a.id]);
                  }}
                  className="mt-2 inline-flex h-8 items-center rounded-lg bg-[#2e3d2b] px-3 text-xs font-semibold text-white hover:opacity-90"
                >
                  Take a look
                </Link>
              )}
            </div>
          ))}
          {folded > 0 && (
            <button type="button" onClick={() => setUnfolded(true)} className="text-xs font-semibold text-[#5d8156] underline underline-offset-2">
              {folded} more
            </button>
          )}
        </div>
        <button type="button" onClick={dismiss} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#5d8156] hover:bg-[#dfe9d7]">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Dismiss
        </button>
      </div>
    </aside>
  );
}
