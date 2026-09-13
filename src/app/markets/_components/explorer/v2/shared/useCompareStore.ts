"use client";

import { useCallback, useEffect, useState } from "react";
import { MAX_COMPARE } from "../../../CompareBar";

const KEY = "mx.compare";

function read(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string").slice(0, MAX_COMPARE) : [];
  } catch {
    return [];
  }
}

/**
 * The areas picked for comparison, kept in sessionStorage so the pick
 * survives the hop from the find screen to a market page and back. Empty
 * until after mount so the server and first client render agree.
 */
export function useCompareStore() {
  const [codes, setCodes] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off hydration from sessionStorage
    setCodes(read());
    setHydrated(true);
  }, []);

  const write = useCallback((next: string[]) => {
    setCodes(next);
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: in-memory only */ }
  }, []);

  const toggle = useCallback((code: string) => {
    const has = codes.includes(code);
    if (!has && codes.length >= MAX_COMPARE) return;
    write(has ? codes.filter((c) => c !== code) : [...codes, code]);
  }, [codes, write]);

  const remove = useCallback((code: string) => write(codes.filter((c) => c !== code)), [codes, write]);
  const clear = useCallback(() => write([]), [write]);

  return { codes, hydrated, has: (code: string) => codes.includes(code), full: codes.length >= MAX_COMPARE, toggle, remove, clear, max: MAX_COMPARE };
}

export type CompareStore = ReturnType<typeof useCompareStore>;
