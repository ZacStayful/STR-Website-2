"use client";

import Link from "next/link";
import { useState } from "react";
import type { Answer } from "@/lib/intelligence/answers";
import { recordSiViewAction } from "./actions";

/**
 * Batch 22, Part E: the question chips. Every answer is already on the page
 * (worked out on the server from settings and the member's state), so a chip
 * answers instantly; the look is recorded in the background (record-only).
 */
export function AnswerChips({ answers, surface }: { answers: Answer[]; surface: "header" | "reveal" | "today" }) {
  const [open, setOpen] = useState<string | null>(null);
  if (answers.length === 0) return null;
  const current = answers.find((a) => a.key === open) ?? null;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {answers.map((a) => (
          <button
            key={a.key}
            type="button"
            aria-expanded={open === a.key}
            onClick={() => {
              const next = open === a.key ? null : a.key;
              setOpen(next);
              if (next) recordSiViewAction({ surface, step: "question", chip: a.key }).catch(() => {});
            }}
            className={`rounded-full border px-3 py-1.5 text-left text-sm font-medium ${open === a.key ? "border-[#B9D5C6] bg-[#B9D5C6] text-[#1a2118]" : "border-white/25 text-white hover:bg-white/10"}`}
          >
            {a.question}
          </button>
        ))}
      </div>
      {current && (
        <div className="mt-3 rounded-xl bg-white/10 p-4 text-sm leading-relaxed text-white" aria-live="polite">
          <p>{current.answer}</p>
          {current.action && (
            <Link href={current.action.href} className="mt-3 inline-block rounded-md bg-[#B9D5C6] px-3 py-1.5 text-sm font-semibold text-[#1a2118] hover:opacity-90">
              {current.action.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
