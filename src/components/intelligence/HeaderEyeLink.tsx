import Link from "next/link";
import type { CSSProperties } from "react";
import { StayfulEye, type EyeLevel } from "@/components/StayfulEye";

/**
 * Batch 22: the eye in the app header, first in the row as the brand mark;
 * it opens the Stayful Intelligence view. The header is the dark brand
 * surface in both themes, so the eye takes the dark-theme tokens here.
 */
const ON_DARK = {
  "--si-eye": "#8ab382",
  "--si-eye-bright": "#b5d9ab",
  "--si-eye-glow": "#1a3018",
  "--si-eye-iris": "#2e3d2b",
  "--si-eye-iris-deep": "#0f150e",
} as CSSProperties;

export function HeaderEyeLink({ level }: { level: EyeLevel }) {
  return (
    <Link href="/intelligence" aria-label="Stayful Intelligence" title="Stayful Intelligence" style={{ ...ON_DARK, display: "inline-flex", alignItems: "center", lineHeight: 0 }}>
      <StayfulEye size={24} level={level} />
    </Link>
  );
}
