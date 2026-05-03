import { TRUST } from "@/lib/brand";

export function TrustSignals({ caption = TRUST.caption }: { caption?: string }) {
  return (
    <div className="sf-trust-signals">
      <div className="sf-trust-signals__stat">
        <span className="sf-trust-signals__value">{TRUST.propertiesManaged}</span>
        <span className="sf-trust-signals__label">UK properties managed</span>
      </div>
      <div className="sf-trust-signals__stat">
        <span className="sf-trust-signals__value">{TRUST.revenueEarned}</span>
        <span className="sf-trust-signals__label">Earned for owners</span>
      </div>
      <div className="sf-trust-signals__stat">
        <span className="sf-trust-signals__value">{TRUST.googleRating}★</span>
        <span className="sf-trust-signals__label">Google rating</span>
      </div>
      <p className="sf-trust-signals__caption">{caption}</p>
    </div>
  );
}
