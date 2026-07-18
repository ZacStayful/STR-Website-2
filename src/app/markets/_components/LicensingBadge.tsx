import { ShieldCheck, Shield, HelpCircle } from "lucide-react";
import type { LicensingStatus } from "@/lib/data/str-licensing";

const CONFIG: Record<
  LicensingStatus,
  { cls: string; Icon: typeof ShieldCheck; label: string }
> = {
  "confirmed-unrestricted": { cls: "mx-badge--unrestricted", Icon: ShieldCheck, label: "No STR licence required" },
  "confirmed-licensed": { cls: "mx-badge--licensed", Icon: Shield, label: "STR licence / permission required" },
  unconfirmed: { cls: "mx-badge--unconfirmed", Icon: HelpCircle, label: "Licensing unconfirmed" },
};

/**
 * The licensing flag badge. `unconfirmed` gets its own distinct treatment
 * (grey + question icon) — never silently omitted or shown as "unrestricted".
 */
export function LicensingBadge({ status, label }: { status: LicensingStatus; label?: string }) {
  const c = CONFIG[status];
  const Icon = c.Icon;
  return (
    <span className={`mx-badge ${c.cls}`}>
      <Icon aria-hidden />
      {label ?? c.label}
    </span>
  );
}
