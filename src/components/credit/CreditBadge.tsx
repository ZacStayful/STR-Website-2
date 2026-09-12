"use client";

import Link from "next/link";
import { formatGbp } from "@/lib/credit/client";
import { useCreditOptional } from "./CreditProvider";

/** The "£12.40 credit" pill in the app nav; amber when low, red when out. */
export function CreditBadge() {
  const ctx = useCreditOptional();
  const c = ctx?.credit;
  if (!c) return null;
  const tone = c.admin ? { bg: "rgba(255,255,255,0.12)", fg: "#fff" } : c.outOfCredit ? { bg: "#7f1d1d", fg: "#fecaca" } : c.lowBalance ? { bg: "#78350f", fg: "#fde68a" } : { bg: "rgba(255,255,255,0.12)", fg: "#fff" };
  return (
    <Link
      href="/account/billing"
      title={c.admin ? "Admin account — usage is logged but never charged" : "Your credit balance"}
      style={{ background: tone.bg, color: tone.fg, borderRadius: 999, padding: "2px 10px", fontWeight: 600, textDecoration: "none", fontSize: 12, whiteSpace: "nowrap" }}
    >
      {c.admin ? "Admin · unlimited" : `${formatGbp(c.totalPence)} credit`}
    </Link>
  );
}
