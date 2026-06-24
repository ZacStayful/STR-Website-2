"use client";

import { useSyncExternalStore } from "react";
import type { AnalysisResult } from "@/lib/types";
import type { PdfExpenses } from "@/lib/pdf/derive";
import { DEMO_MAP } from "@/lib/demo-data";
import { PresentationDeck } from "./PresentationDeck";
import { C } from "./_lib/tokens";
import "./styles.css";

interface Handoff {
  result: AnalysisResult;
  expenses?: PdfExpenses;
  mortgage: number | null;
}

const STORAGE_KEY = "stayful_presentation";

// Read the analyser handoff. Primary source is localStorage (written by the
// "Presentation view" button on the analyser). A `?demo=<key>` URL param loads
// a seeded analysis instead, so the presentation can be previewed/shared
// without running a live report. Cached by a composite key so getSnapshot
// returns a stable reference; getServerSnapshot returns null for clean SSR.
let cacheKey: string | null = null;
let cacheVal: Handoff | null = null;

function readHandoff(): Handoff | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  let demoKey = "";
  try {
    demoKey = new URLSearchParams(window.location.search).get("demo") ?? "";
  } catch {
    demoKey = "";
  }
  const key = `${raw ?? ""}|${demoKey}`;
  if (key === cacheKey) return cacheVal;
  cacheKey = key;

  try {
    if (raw) {
      const parsed = JSON.parse(raw) as Handoff;
      if (parsed?.result?.property) {
        cacheVal = parsed;
        return cacheVal;
      }
    }
  } catch {
    // fall through to demo / empty
  }
  if (demoKey && DEMO_MAP[demoKey]) {
    cacheVal = { result: DEMO_MAP[demoKey], mortgage: null };
    return cacheVal;
  }
  cacheVal = null;
  return cacheVal;
}

const subscribe = () => () => {};

export default function PresentationPage() {
  const data = useSyncExternalStore(subscribe, readHandoff, () => null);

  if (!data) {
    return (
      <main style={{ maxWidth: 520, margin: "0 auto", padding: "4rem 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: C.gray900 }}>No analysis to present</h1>
        <p style={{ fontSize: 14, color: C.gray500, lineHeight: 1.7, marginTop: 10 }}>
          Open this from a completed analysis using the <strong>Presentation view</strong> button next to
          Download&nbsp;PDF.
        </p>
      </main>
    );
  }

  return (
    <main className="sr-pres-page" style={{ maxWidth: 820, margin: "0 auto", padding: "1.5rem 1.5rem 4rem", fontFamily: "var(--font-sans), system-ui, sans-serif", color: C.gray900, background: C.white, minHeight: "100vh" }}>
      <PresentationDeck result={data.result} expenses={data.expenses} mortgage={data.mortgage} />
    </main>
  );
}
