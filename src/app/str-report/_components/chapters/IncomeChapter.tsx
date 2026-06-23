"use client";

import { useEffect, useState } from "react";
import { C, gbp } from "../../_lib/brand";
import type { IncomeData } from "../../_lib/types";
import { ChapterHeader } from "../ui/ChapterHeader";
import { StatTile } from "../ui/StatTile";

interface Row {
  label: string;
  amount: number; // signed for display; magnitude used for width
  kind: "gross" | "deduction" | "net" | "excluded";
}

function BarRow({ row, gross, mounted }: { row: Row; gross: number; mounted: boolean }) {
  const pct = row.kind === "gross" ? 100 : Math.max(0, (Math.abs(row.amount) / gross) * 100);
  const isGross = row.kind === "gross";
  const isNet = row.kind === "net";
  const isExcluded = row.kind === "excluded";

  const fill =
    isGross ? C.green : isNet ? C.greenDk : isExcluded ? C.greenLt : C.gray100;
  const textColor = isGross || isNet ? C.white : isExcluded ? C.greenTx : C.gray500;
  const border = isGross || isNet || isExcluded ? "none" : `1px solid ${C.gray200}`;

  const displayAmount = isGross
    ? `${gbp(row.amount)}/mo`
    : isNet
      ? `${gbp(row.amount)}/mo`
      : isExcluded
        ? "excluded"
        : `−${gbp(Math.abs(row.amount))}`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <div className="sr-wf-label" style={{ fontSize: 12, color: C.gray500, flexShrink: 0 }}>
        {row.label}
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            minWidth: 60,
            width: mounted ? `${isExcluded ? 100 : Math.max(pct, isGross || isNet ? 100 : 8)}%` : "0%",
            maxWidth: "100%",
            height: 26,
            borderRadius: 4,
            padding: "0 10px",
            background: fill,
            border,
            color: textColor,
            fontSize: 12,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            transition: "width 0.6s ease",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <span style={{ opacity: 0.85 }}>{isNet ? "Net" : ""}</span>
          <span>{displayAmount}</span>
        </div>
      </div>
    </div>
  );
}

export function IncomeChapter({
  income,
  baseManagement,
  selfManaged,
  onToggle,
}: {
  income: IncomeData;
  baseManagement: number;
  selfManaged: boolean;
  onToggle: (v: boolean) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const rows: Row[] = [
    { label: "Gross STR income", amount: income.gross, kind: "gross" },
    selfManaged
      ? { label: "Management (self-managed)", amount: baseManagement, kind: "excluded" }
      : { label: "Management (15%+VAT)", amount: -baseManagement, kind: "deduction" },
    { label: "Cleaning", amount: -income.cleaning, kind: "deduction" },
    { label: "Consumables", amount: -income.consumables, kind: "deduction" },
    { label: "Void allowance (8%)", amount: -income.voidAllowance, kind: "deduction" },
    { label: "Your net income", amount: income.net, kind: "net" },
  ];

  return (
    <div className="sr-chapter-enter">
      <ChapterHeader
        number="02"
        title="Your income"
        subtitle="How gross STR revenue flows through to your actual take-home — every real cost accounted for."
      />

      <div style={{ border: `1px solid ${C.gray200}`, borderRadius: 12, padding: "1rem 1.25rem", marginTop: 16 }}>
        {rows.map((row, i) => (
          <div key={row.label}>
            {i === rows.length - 1 ? (
              <hr style={{ border: 0, borderTop: `1px solid ${C.gray200}`, margin: "4px 0 12px" }} />
            ) : null}
            <BarRow row={row} gross={income.gross} mounted={mounted} />
          </div>
        ))}

        {/* The self-managed toggle — present income without the management fee. */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 6,
            fontSize: 13,
            color: C.gray800,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={selfManaged}
            onChange={(e) => onToggle(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: C.green, cursor: "pointer" }}
          />
          I&apos;ll self-manage — remove the management fee
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
        <StatTile label="Net multiplier" value={`${income.netMultiplier.toFixed(2)}×`} />
        <StatTile label="Annual net income" value={gbp(income.annualNet)} valueColor={C.green} />
      </div>
    </div>
  );
}
