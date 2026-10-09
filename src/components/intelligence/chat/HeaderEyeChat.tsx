"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { StayfulEye, type EyeLevel } from "@/components/StayfulEye";
import { EYE_NAV } from "@/lib/nav";
import type { ChatUi } from "@/lib/chat/reply";
import { QuickAsk } from "./QuickAsk";

/**
 * Batch 26: the header eye once the chat is on (Zac, 29 Sep). On a phone it
 * opens quick answers full screen (/intelligence/ask, with "Open full view").
 * On a desktop it drops a small panel under the eye with the quick box and
 * "Open full view". Without JavaScript it is still the link to the view.
 */
export function HeaderEyeChat({ level, style, onDark, chat }: { level: EyeLevel; style?: CSSProperties; onDark: CSSProperties; chat: ChatUi }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
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
      <StayfulEye size={24} level={level} />
    </span>
  );
  const linkStyle: CSSProperties = { ...onDark, ...style, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" };

  return (
    <span ref={wrap} style={{ position: "relative", display: "inline-flex" }}>
      {/* Phone: full screen. */}
      <Link href="/intelligence/ask" aria-label={EYE_NAV.label} title={EYE_NAV.label} className="sm:hidden" style={linkStyle}>
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
          setOpen((o) => !o);
        }}
      >
        {eye}
        <span aria-hidden="true">{EYE_NAV.label}</span>
      </Link>
      {open && (
        <div
          role="dialog"
          aria-label="Ask Stayful Intelligence"
          className="absolute left-0 top-full z-50 mt-2 hidden w-[380px] rounded-2xl border border-white/10 bg-[#2E3D2B] p-4 text-left text-white shadow-2xl sm:block"
          style={{ ...onDark, whiteSpace: "normal" }}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Ask Stayful Intelligence</span>
            <Link href={`${EYE_NAV.href}#si-ask`} className="text-xs font-semibold text-[#B9D5C6] underline underline-offset-4" onClick={() => setOpen(false)}>
              Open full view
            </Link>
          </div>
          <QuickAsk hintPence={chat.quickHintPence} fullHintPence={chat.fullHintPence} floorPence={chat.quickFloorPence} autoFocus />
        </div>
      )}
    </span>
  );
}
