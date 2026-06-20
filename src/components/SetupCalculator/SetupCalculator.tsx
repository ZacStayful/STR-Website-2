"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { FurnishingState, LineItemState } from "./lineItemDefaults";
import { FURNISHING_LABELS, buildDefaultLineItems, computeLabourCost } from "./lineItemDefaults";
import { PropertyConfig } from "./PropertyConfig";
import { LineItemsEditor } from "./LineItemsEditor";
import { QuoteSummary } from "./QuoteSummary";

export interface SetupCalculatorSnapshot {
  furnishing: FurnishingState;
  bedrooms: number;
  items: LineItemState[];
  grandTotal: number;
}

interface Props {
  /** Prefill bedrooms from the analysed property when available */
  defaultBedrooms?: number;
  /** Property address (purely for the copied quote header) */
  propertyAddress?: string;
  /** Called whenever state changes — lets parent snapshot for PDF export etc. */
  onSnapshot?: (snapshot: SetupCalculatorSnapshot) => void;
}

export function SetupCalculator({ defaultBedrooms, propertyAddress, onSnapshot }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [furnishing, setFurnishing] = useState<FurnishingState>("fully");
  const [bedrooms, setBedrooms] = useState<number>(defaultBedrooms ?? 2);
  const [items, setItems] = useState<LineItemState[]>(() => buildDefaultLineItems("fully", defaultBedrooms ?? 2));
  const userEditedRef = useRef(false);

  // Auto-sync bedrooms when the analysis provides a different value
  // (only until the user manually edits something).
  useEffect(() => {
    if (defaultBedrooms != null && !userEditedRef.current && defaultBedrooms !== bedrooms) {
      setBedrooms(defaultBedrooms);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultBedrooms]);

  // Rebuild defaults whenever furnishing or bedrooms change AND the user
  // hasn't yet manually edited line items. Once the user touches anything,
  // we stop auto-rebuilding so their edits persist — except for computed
  // items like Labour which always recalculate from bedroom count.
  useEffect(() => {
    if (!userEditedRef.current) {
      setItems(buildDefaultLineItems(furnishing, bedrooms));
    } else {
      // Even after user edits, recalculate Labour (computed total based on bedrooms)
      setItems((prev) =>
        prev.map((it) =>
          it.id === "labour" ? { ...it, unitCost: computeLabourCost(bedrooms) } : it,
        ),
      );
    }
  }, [furnishing, bedrooms]);

  // Broadcast snapshot to parent on every change (for PDF export etc.)
  useEffect(() => {
    if (!onSnapshot) return;
    const grandTotal = items
      .filter((i) => i.active)
      .reduce((s, i) => s + i.qty * i.unitCost, 0);
    onSnapshot({ furnishing, bedrooms, items, grandTotal });
  }, [furnishing, bedrooms, items, onSnapshot]);

  const handleItemsChange = (next: LineItemState[]) => {
    userEditedRef.current = true;
    setItems(next);
  };

  const handleFurnishingChange = (next: FurnishingState) => {
    setFurnishing(next);
    // Furnishing change resets the "edited" flag so defaults can load
    userEditedRef.current = false;
  };

  const handleBedroomsChange = (n: number) => {
    setBedrooms(n);
    // Bedroom change also reapplies defaults unless user has edited items
    // (the effect above handles this via !userEditedRef.current check)
  };

  const handleReset = () => {
    userEditedRef.current = false;
    setItems(buildDefaultLineItems(furnishing, bedrooms));
  };

  const activeCount = items.filter((i) => i.active).length;
  const grandTotal = items
    .filter((i) => i.active)
    .reduce((s, i) => s + i.qty * i.unitCost, 0);

  return (
    <div className="rounded-xl border border-primary-foreground/15 bg-primary p-5 text-primary-foreground">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true">🛠️</span>
          <span className="text-[14px] font-semibold">Estimate setup costs</span>
        </span>
        <span className="flex items-center gap-3">
          {grandTotal > 0 && (
            <span className="text-sm font-semibold text-primary-foreground/90">
              £{Math.round(grandTotal).toLocaleString("en-GB")}
              <span className="ml-1 text-[10px] font-normal text-primary-foreground/60">({activeCount} items)</span>
            </span>
          )}
          <ChevronDown
            className={`h-3.5 w-3.5 text-primary-foreground/80 transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-5">
          <PropertyConfig
            furnishing={furnishing}
            bedrooms={bedrooms}
            onFurnishingChange={handleFurnishingChange}
            onBedroomsChange={handleBedroomsChange}
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
            <LineItemsEditor items={items} onChange={handleItemsChange} />

            <div className="lg:sticky lg:top-4 lg:self-start">
              <QuoteSummary
                items={items}
                propertyAddress={propertyAddress ?? ""}
                bedrooms={bedrooms}
                furnishingLabel={FURNISHING_LABELS[furnishing]}
                onReset={handleReset}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
