"use client";

import { useState } from "react";
import { VerifyNumber } from "@/app/account/notifications/VerifyNumber";

/**
 * Batch 22, Part C: the call box. Unticked by default. With a verified mobile,
 * ticking it is all (saved on Continue). Without one, ticking opens the code
 * check (texts stay off: purpose "calls"); verifying switches calls on.
 * "Skip — leave calls off" closes it and saves nothing.
 */
export function CallBox({ form, label, note, verified, phone, available, on }: { form: string; label: string; note: string; verified: boolean; phone: string | null; available: boolean; on: boolean }) {
  const [ticked, setTicked] = useState(on);
  const [verifying, setVerifying] = useState(false);
  return (
    <div className="space-y-2">
      <label className={`flex items-start gap-3 ${available || verified ? "" : "opacity-60"}`}>
        <input
          type="checkbox"
          form={form}
          name="calls"
          value="1"
          className="mt-1 h-5 w-5"
          checked={ticked}
          disabled={!available && !verified}
          onChange={(e) => {
            const next = e.target.checked;
            if (next && !verified) {
              setVerifying(true);
              return;
            }
            setTicked(next);
          }}
        />
        <span className="text-sm font-medium">{label}</span>
      </label>
      <p className="pl-8 text-xs text-muted-foreground">{note}</p>
      {!available && !verified && <p className="pl-8 text-xs text-muted-foreground">Calls need a verified mobile, and we can’t send codes right now. You can switch calls on later in Account → Notifications.</p>}
      {verifying && !verified && (
        <div className="space-y-2 rounded-lg border border-border bg-background p-3">
          <p className="text-sm">First I need to check this mobile is yours. I’ll text a 6-digit code{phone ? ` to ${phone}` : ""}.</p>
          <VerifyNumber defaultPhone={phone ?? ""} purpose="calls" source="welcome" />
          <button type="button" onClick={() => setVerifying(false)} className="text-xs underline underline-offset-4">
            Skip — leave calls off
          </button>
        </div>
      )}
    </div>
  );
}
