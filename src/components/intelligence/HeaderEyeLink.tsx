import Link from "next/link";
import type { CSSProperties } from "react";
import { StayfulEye, type EyeLevel } from "@/components/StayfulEye";
import { EYE_NAV } from "@/lib/nav";
import type { ChatUi } from "@/lib/chat/reply";
import { HeaderEyeChat } from "./chat/HeaderEyeChat";

/**
 * Batch 22: the eye in the app header, first in the row as the brand mark;
 * it opens the Stayful Intelligence view. Batch 22e gives it its words:
 * "Talk" on a phone, "Talk to Stayful Intelligence" from the sm breakpoint. The header is the dark brand
 * surface in both themes, so the eye takes the dark-theme tokens here.
 */
const ON_DARK = {
  "--si-eye": "#8ab382",
  "--si-eye-bright": "#b5d9ab",
  "--si-eye-glow": "#1a3018",
  "--si-eye-iris": "#2e3d2b",
  "--si-eye-iris-deep": "#0f150e",
} as CSSProperties;

export function HeaderEyeLink({ level, style, chat = null }: { level: EyeLevel; style?: CSSProperties; chat?: ChatUi | null }) {
  // Batch 26: with the typed chat on, the eye opens quick answers (full screen on a phone, a panel on a desktop).
  if (chat) return <HeaderEyeChat level={level} style={style} onDark={ON_DARK} chat={chat} />;
  return (
    <Link href={EYE_NAV.href} aria-label={EYE_NAV.label} title={EYE_NAV.label} style={{ ...ON_DARK, ...style, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span style={{ lineHeight: 0 }}>
        <StayfulEye size={24} level={level} />
      </span>
      <span aria-hidden="true" className="sm:hidden">{EYE_NAV.shortLabel}</span>
      <span aria-hidden="true" className="hidden sm:inline">{EYE_NAV.label}</span>
    </Link>
  );
}
