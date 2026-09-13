"use client";

import { ChevronRight } from "lucide-react";
import type { Crumb } from "./types";

/** The Regions › Region › Area › District trail; every earlier step is a button back to it. */
export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length === 0) return null;
  return (
    <nav className="mx-breadcrumb" aria-label="Market levels">
      {crumbs.map((c, i) => (
        <span key={`${i}-${c.label}`} className="mx-breadcrumb-item">
          {i > 0 && <ChevronRight size={12} aria-hidden />}
          {c.onClick ? (
            <button type="button" onClick={c.onClick}>{c.label}</button>
          ) : (
            <b aria-current="location">{c.label}</b>
          )}
        </span>
      ))}
    </nav>
  );
}
