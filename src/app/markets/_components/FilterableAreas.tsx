"use client";

import { useMemo, useState } from "react";
import type { AreaCardData } from "@/lib/market/explorer";
import { AreaCard } from "./AreaCard";

type Region = "any" | "England" | "Scotland" | "Wales" | "Northern Ireland";
type Budget = "any" | "u200" | "200-350" | "350-500" | "500+";
type Beds = "any" | "1" | "2" | "3" | "4+";
type Conf = "any" | "confirmed" | "building+";

const REGIONS: { key: Region; label: string }[] = [
  { key: "any", label: "Anywhere in UK" },
  { key: "England", label: "England" },
  { key: "Scotland", label: "Scotland" },
  { key: "Wales", label: "Wales" },
  { key: "Northern Ireland", label: "N. Ireland" },
];

function inBudget(valueMid: number | null, b: Budget): boolean {
  if (b === "any") return true;
  if (valueMid === null) return false; // a budget search only surfaces areas we can confirm fit
  if (b === "u200") return valueMid < 200_000;
  if (b === "200-350") return valueMid >= 200_000 && valueMid < 350_000;
  if (b === "350-500") return valueMid >= 350_000 && valueMid < 500_000;
  return valueMid >= 500_000;
}

function hasBeds(available: number[], b: Beds): boolean {
  if (b === "any") return true;
  if (b === "4+") return available.some((n) => n >= 4);
  return available.includes(Number(b));
}

function passesConfidence(tier: string, c: Conf): boolean {
  if (c === "any") return true;
  if (c === "confirmed") return tier === "confirmed";
  return tier === "confirmed" || tier === "building"; // building+
}

export function FilterableAreas({ cards }: { cards: AreaCardData[] }) {
  const [region, setRegion] = useState<Region>("any");
  const [budget, setBudget] = useState<Budget>("any");
  const [beds, setBeds] = useState<Beds>("any");
  const [conf, setConf] = useState<Conf>("any");

  const filtered = useMemo(
    () =>
      cards.filter((c) => {
        if (region !== "any" && c.licensing.nation !== region) return false;
        if (!inBudget(c.yieldOnCost?.propertyValueMid ?? null, budget)) return false;
        if (!hasBeds(c.headline.bedroomsAvailable, beds)) return false;
        if (!passesConfidence(c.confidence.tier, conf)) return false;
        return true;
      }),
    [cards, region, budget, beds, conf],
  );

  return (
    <>
      <div className="mx-filters" role="group" aria-label="Filter areas">
        <div className="mx-filter-group" role="group" aria-label="Region">
          {REGIONS.map((r) => (
            <button
              key={r.key}
              type="button"
              className="mx-pill"
              aria-pressed={region === r.key}
              onClick={() => setRegion(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <select className="mx-select" aria-label="Budget" value={budget} onChange={(e) => setBudget(e.target.value as Budget)}>
          <option value="any">Any budget</option>
          <option value="u200">Under £200k</option>
          <option value="200-350">£200k–£350k</option>
          <option value="350-500">£350k–£500k</option>
          <option value="500+">£500k+</option>
        </select>

        <select className="mx-select" aria-label="Bedrooms" value={beds} onChange={(e) => setBeds(e.target.value as Beds)}>
          <option value="any">Any bedrooms</option>
          <option value="1">1 bed</option>
          <option value="2">2 bed</option>
          <option value="3">3 bed</option>
          <option value="4+">4+ bed</option>
        </select>

        <select className="mx-select" aria-label="Data confidence" value={conf} onChange={(e) => setConf(e.target.value as Conf)}>
          <option value="any">Any confidence</option>
          <option value="building+">Building &amp; up</option>
          <option value="confirmed">Confirmed only</option>
        </select>

        <span className="mx-result-count">
          {filtered.length} {filtered.length === 1 ? "area" : "areas"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="mx-empty">
          <h2>No areas match those filters</h2>
          <p>
            Try widening your budget, region, or data-confidence filter.
          </p>
        </div>
      ) : (
        <div className="mx-grid">
          {filtered.map((c) => (
            <AreaCard key={c.code} card={c} />
          ))}
        </div>
      )}
    </>
  );
}
