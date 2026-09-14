"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A filter chip with a small popover under it (Region, Bedrooms, Budget,
 * Confidence, Sub-market). Closes on outside click or Escape; the children
 * get a `close` callback so picking an option can dismiss it.
 */
export function ChipMenu({
  label,
  active = false,
  dashed = false,
  icon,
  ariaLabel,
  children,
  className = "",
}: {
  label: ReactNode;
  active?: boolean;
  /** The dashed "set this up" style (the goals chip before goals exist). */
  dashed?: boolean;
  icon?: ReactNode;
  ariaLabel?: string;
  children: (close: () => void) => ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`mx2-chipmenu ${className}`} ref={ref}>
      <button type="button" className={`mx2-btn mx2-btn--secondary mx2-chip${active ? " is-on" : ""}${dashed ? " is-dashed" : ""}`} aria-expanded={open} aria-controls={id} aria-label={ariaLabel} onClick={() => setOpen((o) => !o)}>
        {icon}{label}<ChevronDown size={14} aria-hidden />
      </button>
      {open && <div className="mx2-pop" id={id} role="dialog" aria-label={ariaLabel}>{children(() => setOpen(false))}</div>}
    </div>
  );
}
