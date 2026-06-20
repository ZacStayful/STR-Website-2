"use client";

import { useState } from "react";
import { Icon } from "@/lib/icons";

export function FinalCTA() {
  const [postcode, setPostcode] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    window.location.href = "/signup";
  };
  return (
    <section className="final-cta">
      <div className="wrap-narrow">
        <div className="final-cta-card">
          <div className="eyebrow">Run your first property</div>
          <h2>
            Stop guessing.
            <br />
            <span className="hero-script light">Start analysing.</span>
          </h2>
          <p className="lede">
            Type any UK postcode and get a full 11-section report in under 20
            seconds. Free, no card required.
          </p>
          <form className="postcode-form dark" onSubmit={submit}>
            <label className="postcode-label">
              <Icon name="pin" size={18} color="var(--sage-200)" />
              <input
                value={postcode}
                onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                placeholder="Enter a UK postcode  e.g. YO31 7NU"
                spellCheck={false}
              />
            </label>
            <button type="submit" className="btn btn-light">
              Run free analysis <Icon name="arrow" size={14} />
            </button>
          </form>
          <div className="final-cta-meta">
            <span>
              <Icon name="check" size={13} /> Free trial · No card
            </span>
            <span>
              <Icon name="check" size={13} /> Full 11-section report
            </span>
            <span>
              <Icon name="check" size={13} /> 10–20 second analysis
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
