"use client";

import { useActionState } from "react";
import { managementEnquiryAction, type EnquiryState } from "../../actions";

const initial: EnquiryState = { error: null, sent: false };

export function ManagedEnquiry({ areaCode, areaName, email }: { areaCode: string; areaName: string; email: string | null }) {
  const [state, action, pending] = useActionState(managementEnquiryAction, initial);
  if (state.sent) {
    return <p className="mx-note mx-note--ok">Thanks — we’ll be in touch about managing in {areaName}.</p>;
  }
  return (
    <form action={action} className="mx-enquiry">
      <input type="hidden" name="area" value={areaCode} />
      <div className="mx-goals-grid">
        <label><span>Your name</span><input name="name" required className="mx-input" autoComplete="name" /></label>
        <label><span>Email</span><input name="email" type="email" required defaultValue={email ?? ""} className="mx-input" autoComplete="email" /></label>
        <label><span>Phone (optional)</span><input name="phone" type="tel" className="mx-input" autoComplete="tel" /></label>
      </div>
      <label><span>Anything we should know?</span><textarea name="message" rows={3} className="mx-input" placeholder="Property type, timing, whether you already own it…" /></label>
      {state.error && <p className="mx-note mx-note--error">{state.error}</p>}
      <button type="submit" className="mx-cta mx-cta--sm" disabled={pending}>{pending ? "Sending…" : "Talk to us about managing here"}</button>
    </form>
  );
}
