"use client";

import type { FurnishingState } from "./lineItemDefaults";
import { FURNISHING_LABELS } from "./lineItemDefaults";

interface Props {
  furnishing: FurnishingState;
  bedrooms: number;
  onFurnishingChange: (v: FurnishingState) => void;
  onBedroomsChange: (n: number) => void;
}

const FURNISHING_OPTIONS: { value: FurnishingState; hint: string }[] = [
  { value: "fully",       hint: "Property already has beds, sofas, tables etc." },
  { value: "part",        hint: "Some items present, some missing" },
  { value: "unfurnished", hint: "Completely bare" },
];

const BEDROOM_OPTIONS = [1, 2, 3, 4, 5];

export function PropertyConfig({ furnishing, bedrooms, onFurnishingChange, onBedroomsChange }: Props) {
  return (
    <div className="space-y-4">
      {/* Furnishing state */}
      <div>
        <p className="mb-2 text-xs font-semibold text-primary-foreground/80">Furnishing state</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {FURNISHING_OPTIONS.map((opt) => {
            const active = furnishing === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onFurnishingChange(opt.value)}
                aria-pressed={active}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-primary-foreground bg-primary-foreground/20 text-primary-foreground"
                    : "border-primary-foreground/20 bg-primary-foreground/5 text-primary-foreground/80 hover:bg-primary-foreground/10"
                }`}
              >
                <p className="text-sm font-semibold">{FURNISHING_LABELS[opt.value]}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-primary-foreground/70">{opt.hint}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bedrooms — pill buttons */}
      <div>
        <p className="mb-2 text-xs font-semibold text-primary-foreground/80">Number of bedrooms</p>
        <div className="flex gap-2">
          {BEDROOM_OPTIONS.map((n) => {
            const active = bedrooms === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => onBedroomsChange(n)}
                aria-pressed={active}
                className={`flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-bold transition-colors ${
                  active
                    ? "border-primary-foreground bg-primary-foreground/20 text-primary-foreground"
                    : "border-primary-foreground/20 bg-primary-foreground/5 text-primary-foreground/80 hover:bg-primary-foreground/10"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
