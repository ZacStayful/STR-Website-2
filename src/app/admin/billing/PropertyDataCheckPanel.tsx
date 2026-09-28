"use client";

import { useState, useTransition } from "react";
import { propertyDataBillingCheckAction, type PdCheckResult } from "./actions";

/**
 * Batch 16, Part H: whether PropertyData bills a failed call, which decides
 * whether logging failed attempts at 0p is right. One known-failing call,
 * at most one credit (~2.5p), house spend.
 */
export function PropertyDataCheckPanel() {
  const [result, setResult] = useState<PdCheckResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">PropertyData: are failed calls billed?</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Failed calls are logged at 0p. This reads the free credit balance, makes one call PropertyData always fails (a rent for S1 2HH), and reads the balance again. At most one credit (~2.5p). Best run when the site is quiet.
      </p>
      <button type="button" disabled={pending} onClick={() => start(async () => setResult(await propertyDataBillingCheckAction()))} className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60">
        {pending ? "Checking…" : "Run the check"}
      </button>
      {result && <p className={`mt-3 text-sm ${result.verdict === "billed" ? "font-medium text-foreground" : "text-muted-foreground"}`}>{result.message}</p>}
    </section>
  );
}
