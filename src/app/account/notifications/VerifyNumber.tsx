"use client";

import { useActionState, useState } from "react";
import { requestSmsCodeAction, verifySmsCodeAction, type SmsFormState } from "./sms-actions";

const INITIAL: SmsFormState = { step: "number" };
const input = "h-10 rounded-lg border border-[#e4e7dc] bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#5d8156]/40";
const primary = "rounded-full bg-[#5d8156] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4c6b46] disabled:opacity-60";
const link = "text-sm font-semibold text-[#5d8156] underline disabled:opacity-60";

/**
 * Add, verify or change the texting number: type the number, get a 6-digit
 * code by text, type the code. The number only becomes the texting number
 * once the code matches; until then any current number keeps its texts.
 */
export function VerifyNumber({ defaultPhone, label = "Send code", onCancel }: { defaultPhone: string; label?: string; onCancel?: () => void }) {
  const [sendState, send, sending] = useActionState(requestSmsCodeAction, INITIAL);
  const [checkState, check, checking] = useActionState(verifySmsCodeAction, INITIAL);
  const [phone, setPhone] = useState(defaultPhone);

  if (checkState.done) {
    return <p className="rounded-lg bg-[#eef3ea] px-3 py-2 text-sm text-[#3f5c3a]" role="status">{checkState.notice}</p>;
  }

  // The code step runs off the latest code sent; a check's error only shows while it is about that code.
  const verificationId = sendState.step === "code" ? sendState.verificationId : undefined;
  const checkError = checkState.error && checkState.verificationId === verificationId ? checkState.error : null;

  if (!verificationId) {
    return (
      <form action={send} className="space-y-2">
        <label className="block text-sm font-medium" htmlFor="sms-phone">UK mobile number</label>
        <div className="flex flex-wrap gap-2">
          <input id="sms-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="07700 900000" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${input} min-w-48 flex-1`} />
          <button type="submit" disabled={sending} className={primary}>{sending ? "Sending…" : label}</button>
          {onCancel && (
            <button type="button" onClick={onCancel} className={link}>Cancel</button>
          )}
        </div>
        {sendState.error && <p className="text-sm text-[#b3261e]" role="alert">{sendState.error}</p>}
        <p className="text-xs text-[#7a8274]">We will text a 6-digit code to check it is yours. UK mobiles only.</p>
      </form>
    );
  }

  return (
    <div className="space-y-2">
      <form action={check} className="space-y-2">
        <input type="hidden" name="verificationId" value={verificationId} />
        <label className="block text-sm font-medium" htmlFor="sms-code">Code from the text</label>
        <div className="flex flex-wrap gap-2">
          <input id="sms-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 \-]{6,7}" maxLength={7} required placeholder="123456" className={`${input} w-36 tracking-widest`} />
          <button type="submit" disabled={checking} className={primary}>{checking ? "Checking…" : "Verify"}</button>
        </div>
      </form>
      {sendState.notice && !checkError && <p className="text-sm text-[#7a8274]" role="status">{sendState.notice}</p>}
      {checkError && <p className="text-sm text-[#b3261e]" role="alert">{checkError}</p>}
      {sendState.error && <p className="text-sm text-[#b3261e]" role="alert">{sendState.error}</p>}
      <form action={send}>
        <input type="hidden" name="phone" value={phone} />
        <button type="submit" disabled={sending} className={link}>{sending ? "Sending…" : "Send a new code"}</button>
      </form>
    </div>
  );
}

/** "Change number": the verify flow behind a button, so the verified number stays on screen until they choose to change it. */
export function ChangeNumber() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={link}>Change number</button>
    );
  }
  return <VerifyNumber defaultPhone="" label="Send code to new number" onCancel={() => setOpen(false)} />;
}
