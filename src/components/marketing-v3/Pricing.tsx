import Link from "next/link";
import { Icon } from "@/lib/icons";

interface Plan {
  name: string;
  price: string;
  priceSub?: string;
  sub: string;
  features: string[];
  cta: string;
  hl?: boolean;
  tag?: string;
}

const PLANS: Plan[] = [
  {
    name: "5 free reports",
    price: "Free",
    priceSub: "5 reports",
    sub: "Full access — no card required",
    features: [
      "Full 11-section report",
      "5 free reports to start",
      "Live comparables",
      "Forecast & risk",
      "Setup cost quote",
      "Growth playbook",
    ],
    cta: "Start free trial",
  },
  {
    name: "Analyser",
    price: "£39.99",
    priceSub: "/month",
    sub: "Unlimited analyses · cancel any time",
    features: [
      "Everything in Free",
      "Unlimited reports",
      "Saved properties",
      "PDF export with branding",
      "Priority data refresh",
      "Email support",
    ],
    cta: "Start free trial",
    hl: true,
    tag: "Most popular",
  },
  {
    name: "Annual",
    price: "£360",
    priceSub: "/year",
    sub: "Save 25% paid annually",
    features: [
      "Everything in Analyser",
      "Save 25% · pay annually",
      "Quarterly market briefing",
      "Phone support",
      "Early access to new modules",
    ],
    cta: "Start free trial",
  },
];

export function Pricing() {
  return (
    <section className="pricing section" id="pricing">
      <div className="wrap-narrow">
        <div className="pricing-head">
          <div className="eyebrow">Pricing</div>
          <h2>
            One report. £0.
            <br />
            Unlimited reports. £39.99.
          </h2>
          <p className="lede">
            No sales call to start. Run your first property free, then subscribe
            if you want more.
          </p>
        </div>
        <div className="pricing-grid">
          {PLANS.map((p) => (
            <div key={p.name} className={"plan" + (p.hl ? " hl" : "")}>
              {p.tag && <div className="plan-tag">{p.tag}</div>}
              <div className="plan-name">{p.name}</div>
              <div className="plan-price-row">
                <span className="plan-price">{p.price}</span>
                {p.priceSub && <span className="plan-price-sub">{p.priceSub}</span>}
              </div>
              <div className="plan-sub">{p.sub}</div>
              <ul className="plan-features">
                {p.features.map((f) => (
                  <li key={f}>
                    <Icon name="check" size={13} color="var(--sage-500)" /> {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className={"btn " + (p.hl ? "btn-primary" : "btn-ghost")}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {p.cta} <Icon name="arrow" size={14} />
              </Link>
            </div>
          ))}
        </div>
        <div className="pricing-foot muted">
          All prices ex VAT · Cancel any time, no contract · UK businesses can pay
          annually by invoice
        </div>
      </div>
    </section>
  );
}
