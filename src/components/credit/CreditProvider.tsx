"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CREDIT_CHANGED_EVENT, OUT_OF_CREDIT_EVENT, type OutOfCreditDetail } from "@/lib/credit/client";
import { OutOfCreditModal } from "./OutOfCreditModal";

/** Mirrors CreditSummary from src/lib/credit/summary.ts (plus `admin`). */
export interface CreditSnapshot {
  buckets: { planPence: number; welcomePence: number; topupPence: number; adjustmentPence: number };
  totalPence: number;
  spendableBasePence: number;
  reservedBasePence: number;
  rates: { plan: number; welcome: number; topup: number; adjustment: number };
  cycle: { planCode: string | null; planName: string | null; allowancePence: number; usedPence: number; endsAt: string | null } | null;
  state: "ok" | "low" | "out";
  lowBalance: boolean;
  outOfCredit: boolean;
  enforcing: boolean;
  hasSavedCard: boolean;
  autoTopup: { amountPence: number | null; thresholdPence: number };
  topupPresetsPence: number[];
  welcomeWithheldReason: string | null;
  admin?: boolean;
}

interface CreditContextValue {
  credit: CreditSnapshot | null;
  refresh: () => Promise<void>;
  openOutOfCredit: (detail?: OutOfCreditDetail) => void;
  toast: (message: string) => void;
}

const CreditContext = createContext<CreditContextValue | null>(null);

export function useCredit(): CreditContextValue {
  const ctx = useContext(CreditContext);
  if (!ctx) throw new Error("useCredit must be used inside <CreditProvider>");
  return ctx;
}

export function useCreditOptional(): CreditContextValue | null {
  return useContext(CreditContext);
}

export function CreditProvider({ initial, children }: { initial: CreditSnapshot | null; children: React.ReactNode }) {
  const [credit, setCredit] = useState<CreditSnapshot | null>(initial);
  const [modal, setModal] = useState<OutOfCreditDetail | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/credit/balance", { cache: "no-store" });
      if (!res.ok) return;
      setCredit((await res.json()) as CreditSnapshot);
    } catch {
      /* keep the last snapshot */
    }
  }, []);

  const openOutOfCredit = useCallback((detail: OutOfCreditDetail = {}) => setModal(detail), []);

  const toast = useCallback((message: string) => {
    setToastMsg(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 4000);
  }, []);

  useEffect(() => {
    const onOut = (e: Event) => setModal((e as CustomEvent<OutOfCreditDetail>).detail ?? {});
    const onChanged = () => void refresh();
    window.addEventListener(OUT_OF_CREDIT_EVENT, onOut);
    window.addEventListener(CREDIT_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(OUT_OF_CREDIT_EVENT, onOut);
      window.removeEventListener(CREDIT_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);

  // Returning from Stripe Checkout (?topup=1 / ?subscribed=1) — pull the fresh balance.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (!p.has("topup") && !p.has("subscribed")) return;
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  const value = useMemo(() => ({ credit, refresh, openOutOfCredit, toast }), [credit, refresh, openOutOfCredit, toast]);

  return (
    <CreditContext.Provider value={value}>
      {children}
      <OutOfCreditModal detail={modal} onClose={() => setModal(null)} />
      {toastMsg && (
        <div role="status" className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-lg">
          {toastMsg}
        </div>
      )}
    </CreditContext.Provider>
  );
}
