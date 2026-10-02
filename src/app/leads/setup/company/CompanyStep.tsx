"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FunnelBrand } from "@/lib/funnels/brand";
import { BRAND_SWATCHES } from "@/lib/management/setup";
import { createFunnelAction, saveBrandAction, uploadLogoAction, type FunnelState } from "../../actions";
import { recordSetupStepAction } from "../actions";
import { BrandPreview } from "../BrandPreview";
import { BrandHidden, ErrorLine, field, labelCls, primaryBtn } from "../ui";

const INITIAL: FunnelState = {};

/**
 * Batch 22f, step 1: company name, logo and colour. The first save creates
 * the (paused) funnel through createFunnelAction; later ones go through
 * saveBrandAction. The logo can be added once the funnel exists, on this
 * same screen.
 */
export function CompanyStep({ funnel }: { funnel: { id: string; name: string; brand: FunnelBrand } | null }) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState(funnel?.brand.companyName ?? "");
  const [primary, setPrimary] = useState<string>(funnel?.brand.primary ?? BRAND_SWATCHES[0]);
  const [custom, setCustom] = useState(Boolean(funnel?.brand.primary && !BRAND_SWATCHES.some((c) => c.toUpperCase() === funnel.brand.primary?.toUpperCase())));
  const [createState, createAction, creating] = useActionState(createFunnelAction, INITIAL);
  const [saveState, saveAction, saving] = useActionState(saveBrandAction, INITIAL);
  const [logoState, logoAction, uploading] = useActionState(uploadLogoAction, INITIAL);
  const [moving, startMove] = useTransition();

  // Created: the funnel exists (a refresh comes back to it), so the logo can go on. Saved: on to step 2.
  useEffect(() => {
    if (createState.saved || logoState.saved) router.refresh();
  }, [createState.saved, logoState.saved, router]);
  useEffect(() => {
    if (saveState.saved) {
      startMove(async () => {
        await recordSetupStepAction(1);
        router.push("/leads/setup/details");
      });
    }
  }, [saveState.saved, router]);

  const busy = creating || saving || moving;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-5">
        {funnel ? (
          <form action={logoAction} className="space-y-2">
            <input type="hidden" name="id" value={funnel.id} />
            <label className={labelCls} htmlFor="logo">Logo (PNG or JPEG, up to 2 MB)</label>
            <input id="logo" name="logo" type="file" accept="image/png,image/jpeg" className="block w-full text-sm" onChange={(e) => e.currentTarget.form?.requestSubmit()} />
            {uploading ? <p className="text-xs text-muted-foreground">Uploading…</p> : null}
            <ErrorLine state={logoState} />
          </form>
        ) : null}

        <form action={funnel ? saveAction : createAction} className="space-y-5">
          {funnel ? (
            <>
              <input type="hidden" name="id" value={funnel.id} />
              <input type="hidden" name="name" value={funnel.name} />
              <BrandHidden brand={funnel.brand} omit={["companyName", "primary"]} />
            </>
          ) : (
            <>
              <input type="hidden" name="setup" value="1" />
              <input type="hidden" name="name" value="Website lead form" />
            </>
          )}
          <div>
            <label className={labelCls} htmlFor="companyName">Company name</label>
            <input id="companyName" name="companyName" required maxLength={80} value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={field} autoComplete="organization" />
          </div>

          <fieldset>
            <legend className={labelCls}>Brand colour</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {BRAND_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  aria-pressed={!custom && primary.toUpperCase() === c.toUpperCase()}
                  onClick={() => {
                    setCustom(false);
                    setPrimary(c);
                  }}
                  className={`h-9 w-9 rounded-full border-2 ${!custom && primary.toUpperCase() === c.toUpperCase() ? "border-foreground" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
              <button type="button" aria-pressed={custom} onClick={() => setCustom(true)} className={`h-9 rounded-full border px-3 text-xs font-medium ${custom ? "border-foreground" : "border-border"}`}>
                Custom
              </button>
            </div>
            {custom ? (
              <input type="color" aria-label="Pick your colour" value={/^#[0-9a-f]{6}$/i.test(primary) ? primary : "#2E3D2B"} onChange={(e) => setPrimary(e.target.value)} className="mt-3 h-10 w-20 cursor-pointer rounded border border-border bg-background" />
            ) : null}
            <input type="hidden" name="primary" value={primary} />
          </fieldset>

          <ErrorLine state={funnel ? saveState : createState} />
          <button type="submit" disabled={busy || !companyName.trim()} className={primaryBtn}>
            {busy ? "Saving…" : funnel ? "Continue" : "Save and add your logo"}
          </button>
          {!funnel ? <p className="text-xs text-muted-foreground">Your form is created paused: nobody can use it until you go live at the end.</p> : null}
        </form>
      </div>
      <BrandPreview companyName={companyName} logoUrl={funnel?.brand.logoUrl ?? null} primary={primary} />
    </div>
  );
}
