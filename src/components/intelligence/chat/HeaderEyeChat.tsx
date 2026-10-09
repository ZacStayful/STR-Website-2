"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import type { EyeLevel } from "@/components/StayfulEye";
import { EYE_NAV } from "@/lib/nav";
import type { ChatUi } from "@/lib/chat/reply";
import { ChatEye } from "./ChatEye";
import { QuickChat } from "./QuickChat";

/**
 * Batch 26: the header eye once the chat is on (Zac, 29 Sep). On a phone it
 * opens quick answers full screen (/intelligence/ask, with "Full view"). On
 * a desktop it drops a panel under the eye: the eye that thinks, listens and
 * speaks, the answers, and the box (type or talk) pinned at its foot. Without
 * JavaScript it is still the link to the view.
 */
export function HeaderEyeChat({ level, style, onDark, chat }: { level: EyeLevel; style?: CSSProperties; onDark: CSSProperties; chat: ChatUi }) {
  const [open, setOpen] = useState(false);
  // Once opened, the panel stays mounted while closed, so an answer on its way isn't lost.
  const [opened, setOpened] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    // Reopening a kept panel: back to the box (autoFocus only works the first time).
    wrap.current?.querySelector<HTMLTextAreaElement>("[role=dialog] textarea")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const eye = (
    <span style={{ lineHeight: 0 }}>
      <ChatEye size={24} level={level} />
    </span>
  );
  // No inline display: the classes below decide which link shows (an inline display would beat them).
  const linkStyle: CSSProperties = { ...onDark, ...style, alignItems: "center", gap: 6, whiteSpace: "nowrap" };

  return (
    <span ref={wrap} style={{ position: "relative", display: "inline-flex" }}>
      {/* Phone: full screen. */}
      <Link href="/intelligence/ask" aria-label={EYE_NAV.label} title={EYE_NAV.label} className="inline-flex sm:hidden" style={linkStyle}>
        {eye}
        <span aria-hidden="true">{EYE_NAV.shortLabel}</span>
      </Link>
      {/* Desktop: the panel under the eye. */}
      <Link
        href={EYE_NAV.href}
        aria-label={EYE_NAV.label}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={EYE_NAV.label}
        className="hidden sm:inline-flex"
        style={linkStyle}
        onClick={(e) => {
          e.preventDefault();
          setOpened(true);
          setOpen((o) => !o);
        }}
      >
        {eye}
        <span aria-hidden="true">{EYE_NAV.label}</span>
      </Link>
      {opened && (
        <div
          role="dialog"
          aria-label="Ask Stayful Intelligence"
          hidden={!open}
          className={`absolute left-0 top-full z-50 mt-2 h-[min(560px,75vh)] w-[400px] flex-col rounded-2xl border border-white/10 bg-[#2E3D2B] p-4 text-left text-white shadow-2xl ${open ? "hidden sm:flex" : "hidden"}`}
          style={{ ...onDark, whiteSpace: "normal" }}
        >
          <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <ChatEye size={32} level={level} />
              Ask Stayful Intelligence
            </span>
            <span className="flex items-center gap-3">
              <Link href={`${EYE_NAV.href}#si-ask`} className="text-xs font-semibold text-[#B9D5C6] underline underline-offset-4" onClick={() => setOpen(false)}>
                Full view
              </Link>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-full p-1 text-[#B9D5C6] hover:bg-white/10">
                <X className="size-4" aria-hidden />
              </button>
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <QuickChat hintPence={chat.quickHintPence} fullHintPence={chat.fullHintPence} floorPence={chat.quickFloorPence} voice={chat.voice} inputId="si-quick-panel-q" autoFocus />
          </div>
        </div>
      )}
    </span>
  );
}
