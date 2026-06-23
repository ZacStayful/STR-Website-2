"use client";

import { useState } from "react";
import { C } from "../../_lib/brand";
import type { Beds, PropertyInput, PropertyType } from "../../_lib/types";

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 44,
  border: `1px solid ${C.gray200}`,
  borderRadius: 8,
  padding: "0 12px",
  fontSize: 14,
  color: C.gray900,
  background: C.white,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: C.gray800,
  marginBottom: 6,
};

export function InputChapter({ onSubmit }: { onSubmit: (input: PropertyInput) => void }) {
  const [postcode, setPostcode] = useState("");
  const [beds, setBeds] = useState<Beds>(2);
  const [propertyType, setPropertyType] = useState<PropertyType>("terraced");
  const [mortgage, setMortgage] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pc = postcode.trim();
    if (!pc || !/[a-z]/i.test(pc) || !/\d/.test(pc)) {
      setError("Enter a valid UK postcode.");
      return;
    }
    const monthlyMortgage = parseInt(mortgage.replace(/[£,\s]/g, ""), 10);
    if (!Number.isFinite(monthlyMortgage) || monthlyMortgage <= 0) {
      setError("Enter your monthly mortgage or rent.");
      return;
    }
    setError(null);
    onSubmit({ postcode: pc.toUpperCase(), beds, propertyType, monthlyMortgage });
  }

  return (
    <div className="sr-chapter-enter">
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "0.08em",
          color: C.gray400,
          textTransform: "uppercase",
        }}
      >
        Property intelligence
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 500, color: C.gray900, lineHeight: 1.25, margin: "10px 0 0" }}>
        Is this property worth short letting?
      </h1>
      <p style={{ fontSize: 15, color: C.gray500, lineHeight: 1.6, margin: "10px 0 0" }}>
        Enter your property details and we&apos;ll build a personalised intelligence report on its
        short-let potential.
      </p>

      <form onSubmit={handleSubmit}>
        <div
          style={{
            border: `1px solid ${C.gray200}`,
            borderRadius: 12,
            padding: "1rem 1.25rem",
            marginTop: 20,
            display: "grid",
            gap: 16,
          }}
        >
          <div>
            <label style={labelStyle} htmlFor="sr-postcode">
              Postcode
            </label>
            <input
              id="sr-postcode"
              style={inputStyle}
              placeholder="LE11 3DT"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              autoComplete="postal-code"
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="sr-beds">
              Bedrooms
            </label>
            <select
              id="sr-beds"
              style={inputStyle}
              value={beds}
              onChange={(e) => setBeds(Number(e.target.value) as Beds)}
            >
              <option value={1}>1 bedroom</option>
              <option value={2}>2 bedrooms</option>
              <option value={3}>3 bedrooms</option>
              <option value={4}>4 bedrooms</option>
            </select>
          </div>

          <div>
            <label style={labelStyle} htmlFor="sr-type">
              Property type
            </label>
            <select
              id="sr-type"
              style={inputStyle}
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value as PropertyType)}
            >
              <option value="apartment">Apartment</option>
              <option value="terraced">Terraced house</option>
              <option value="semi-detached">Semi-detached house</option>
              <option value="detached">Detached house</option>
            </select>
          </div>

          <div>
            <label style={labelStyle} htmlFor="sr-mortgage">
              Monthly mortgage / rent
            </label>
            <input
              id="sr-mortgage"
              style={inputStyle}
              inputMode="numeric"
              placeholder="£850"
              value={mortgage}
              onChange={(e) => setMortgage(e.target.value)}
            />
          </div>

          {error ? <div style={{ fontSize: 13, color: C.red }}>{error}</div> : null}
        </div>

        <button
          type="submit"
          style={{
            width: "100%",
            minHeight: 48,
            marginTop: 16,
            background: C.green,
            color: C.white,
            border: "none",
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Discover my property&apos;s potential →
        </button>
        <p style={{ fontSize: 11, color: C.gray400, textAlign: "center", marginTop: 10 }}>
          Personalised to your postcode · Takes about 5 seconds
        </p>
      </form>
    </div>
  );
}
