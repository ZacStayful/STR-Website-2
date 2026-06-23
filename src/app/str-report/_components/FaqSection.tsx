"use client";

import { useState } from "react";
import { C } from "../_lib/brand";
import { FAQS } from "../_lib/faqs";

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ fontSize: 16, fontWeight: 500, color: C.gray900, marginBottom: 10 }}>
        Questions, answered
      </div>
      <div style={{ border: `1px solid ${C.gray200}`, borderRadius: 12, overflow: "hidden" }}>
        {FAQS.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q} style={{ borderTop: i === 0 ? "none" : `1px solid ${C.gray200}` }}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  padding: "14px 16px",
                  minHeight: 44,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 500,
                  color: C.gray900,
                }}
              >
                {f.q}
                <span style={{ color: C.gray400, flexShrink: 0, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                  ⌄
                </span>
              </button>
              {isOpen ? (
                <p style={{ fontSize: 13, color: C.gray500, lineHeight: 1.7, margin: 0, padding: "0 16px 16px" }}>
                  {f.a}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
