"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Icon } from "@/lib/icons";

/**
 * Starts Stripe Checkout for a plan (or opens the portal to switch plans
 * when a subscription already exists). Signed-out visitors go to sign-up.
 */
export function SubscribeButton({ planCode, label, className, signedIn, signupHref = "/signup", current }: { planCode: string; label: string; className?: string; signedIn: boolean; signupHref?: string; current?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <a href={`${signupHref}${signupHref.includes("?") ? "&" : "?"}plan=${encodeURIComponent(planCode)}`} className={className} style={{ width: "100%", justifyContent: "center" }}>
        {label} <Icon name="arrow" size={14} />
      </a>
    );
  }

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planCode, returnTo: window.location.pathname + window.location.search }) });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error || "Couldn't start checkout. Please try again.");
    } catch {
      setError("Couldn't reach the billing service. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => void go()} disabled={busy || current} className={className} style={{ width: "100%", justifyContent: "center", opacity: current ? 0.7 : undefined }}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {current ? "Current plan" : label} {!current && !busy && <Icon name="arrow" size={14} />}
      </button>
      {error && <p style={{ marginTop: 8, fontSize: 12, color: "#b91c1c" }}>{error}</p>}
    </>
  );
}
