"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { logHomeTapAction } from "../actions";

/** A Home link that records the tap (record only) and goes on at once; a failed log never stops the link. */
export function TapLink({ href, target, className, children, "aria-label": ariaLabel }: { href: string; target: string; className?: string; children: ReactNode; "aria-label"?: string }) {
  return (
    <Link
      href={href}
      className={className}
      aria-label={ariaLabel}
      onClick={() => {
        void logHomeTapAction(target).catch(() => undefined);
      }}
    >
      {children}
    </Link>
  );
}
