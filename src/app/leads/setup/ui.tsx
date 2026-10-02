import type { FunnelBrand } from "@/lib/funnels/brand";
import type { FunnelState } from "../actions";

export const field = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground";
export const labelCls = "block text-sm font-medium text-foreground";
export const primaryBtn = "min-h-12 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50";

/**
 * The brand fields a step does not edit, carried through unchanged:
 * saveBrandAction saves the whole brand, and each setup step only shows part of it.
 */
export function BrandHidden({ brand, omit }: { brand: FunnelBrand; omit: Array<keyof FunnelBrand> }) {
  const keep = (k: keyof FunnelBrand) => !omit.includes(k);
  return (
    <>
      {keep("companyName") ? <input type="hidden" name="companyName" value={brand.companyName ?? ""} /> : null}
      {keep("logoUrl") ? <input type="hidden" name="logoUrl" value={brand.logoUrl ?? ""} /> : null}
      {keep("primary") ? <input type="hidden" name="primary" value={brand.primary ?? ""} /> : null}
      {keep("background") ? <input type="hidden" name="background" value={brand.background ?? ""} /> : null}
      {keep("replyToEmail") ? <input type="hidden" name="replyToEmail" value={brand.replyToEmail ?? ""} /> : null}
      {keep("privacyUrl") ? <input type="hidden" name="privacyUrl" value={brand.privacyUrl ?? ""} /> : null}
    </>
  );
}

export function ErrorLine({ state }: { state: FunnelState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {state.error}
    </p>
  );
}
