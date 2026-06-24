"use client";

import { use } from "react";
import Link from "next/link";
import { C } from "../_lib/brand";
import type { Beds, PropertyInput, PropertyType } from "../_lib/types";
import { PresentationDeck } from "../_components/presentation/PresentationDeck";

const TYPES: PropertyType[] = ["apartment", "terraced", "semi-detached", "detached"];

function parseInput(sp: Record<string, string | string[] | undefined>): PropertyInput | null {
  const get = (k: string): string => {
    const v = sp[k];
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  };
  const postcode = get("postcode").trim();
  const beds = Number(get("beds")) as Beds;
  const type = get("type") as PropertyType;
  const mortgage = Number(get("mortgage"));
  if (!postcode || ![1, 2, 3, 4].includes(beds) || !TYPES.includes(type) || !Number.isFinite(mortgage)) {
    return null;
  }
  return {
    postcode: postcode.toUpperCase(),
    beds,
    propertyType: type,
    monthlyMortgage: mortgage,
    ownerName: get("name").trim() || undefined,
  };
}

export default function PresentationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = use(searchParams);
  const input = parseInput(sp);

  if (!input) {
    return (
      <main style={{ maxWidth: 520, margin: "0 auto", padding: "4rem 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: C.gray900 }}>No property details</h1>
        <p style={{ fontSize: 14, color: C.gray500, lineHeight: 1.7, marginTop: 10 }}>
          This presentation is generated from a completed report. Run the report first, then use the
          &ldquo;View as presentation&rdquo; button.
        </p>
        <Link href="/str-report" style={{ display: "inline-block", marginTop: 16, color: C.green, fontWeight: 500, textDecoration: "none" }}>
          ← Start a report
        </Link>
      </main>
    );
  }

  return (
    <main className="sr-pres-page" style={{ maxWidth: 820, margin: "0 auto", padding: "1.5rem 1.5rem 4rem" }}>
      <PresentationDeck input={input} />
    </main>
  );
}
