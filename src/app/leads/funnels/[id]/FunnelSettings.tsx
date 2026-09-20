"use client";

import { useActionState, useState } from "react";
import type { FunnelBrand } from "@/lib/funnels/brand";
import type { LeadRules } from "@/lib/leads/rules";
import { activationBlockers } from "@/lib/funnels/brand";
import { saveBrandAction, saveRulesAction, rotateTokenAction, toggleFunnelAction, uploadLogoAction, type FunnelState } from "../../actions";

interface FunnelView {
  id: string;
  name: string;
  brand: FunnelBrand;
  leadRules: LeadRules;
  reportDepth: "standard" | "enhanced";
  unqualifiedPolicy: "crm_flagged" | "hold";
  dailyCap: number;
  dailySpendCapPence: number;
  active: boolean;
}

interface Props {
  funnel: FunnelView;
  publicUrl: string;
  rotatedAt: string | null;
  saturationGuide: Array<{ level: string; range: string; headline: string; meaning: string }>;
}

const INITIAL: FunnelState = {};
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground";
const labelCls = "block text-xs font-medium text-foreground";
const hint = "mt-1 text-xs text-muted-foreground";

function Banner({ state }: { state: FunnelState }) {
  if (state.error) {
    return <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p>;
  }
  if (state.saved) {
    return <p className="mt-3 rounded-md border border-success/40 bg-success/10 p-3 text-sm text-foreground">Saved.</p>;
  }
  return null;
}

export function FunnelSettings({ funnel, publicUrl, rotatedAt, saturationGuide }: Props) {
  const [brandState, brandAction, brandPending] = useActionState(saveBrandAction, INITIAL);
  const [rulesState, rulesAction, rulesPending] = useActionState(saveRulesAction, INITIAL);
  const [rotateState, rotateAction, rotatePending] = useActionState(rotateTokenAction, INITIAL);
  const [toggleState, toggleAction, togglePending] = useActionState(toggleFunnelAction, INITIAL);
  const [copied, setCopied] = useState(false);

  const url = rotateState.token ? publicUrl.replace(/\/f\/.*$/, `/f/${rotateState.token}`) : publicUrl;
  const blockers = activationBlockers(funnel.brand);

  return (
    <div className="space-y-6">
      {/* ── Live or paused ── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{funnel.active ? "Live" : "Paused"}</h2>
            <p className={hint}>
              {funnel.active
                ? "The link is accepting enquiries and each one is charged to your credit."
                : "The link returns a not-found page. Nothing is charged while it is paused."}
            </p>
          </div>
          <form action={toggleAction}>
            <input type="hidden" name="id" value={funnel.id} />
            <button
              type="submit"
              disabled={togglePending}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
            >
              {togglePending ? "Working…" : funnel.active ? "Pause" : "Go live"}
            </button>
          </form>
        </div>
        {blockers.length > 0 && !funnel.active ? (
          <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
            Before this funnel can go live, add {blockers.join(" and ")} under Branding. Whoever fills in your form is
            handing their details to you, not to us, so they need somewhere to read how you will use them.
          </p>
        ) : null}
        <Banner state={toggleState} />
      </section>

      {/* ── The link ── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Your funnel link</h2>
        <p className={hint}>
          Point your enquiry form here. You can pass details you already have as{" "}
          <code className="rounded bg-muted px-1">?name=&amp;email=&amp;phone=</code> and the form will arrive prefilled.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input readOnly value={url} className={`${field} min-w-0 flex-1 font-mono text-xs`} />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
            className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-3">
          <a
            href={`${url}?preview=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Preview your funnel
          </a>
          <span className={`ml-2 ${hint}`}>
            Opens the branded page with a sample report. Nothing is charged and no lead is recorded.
          </span>
        </p>
        <form action={rotateAction} className="mt-3">
          <input type="hidden" name="id" value={funnel.id} />
          <button
            type="submit"
            disabled={rotatePending}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
          >
            {rotatePending ? "Changing…" : "Change link"}
          </button>
          <span className={`ml-2 ${hint}`}>
            Replaces the link if it has leaked. Leads you already have are kept; the old link stops working immediately.
            {rotatedAt ? ` Last changed ${new Date(rotatedAt).toLocaleDateString("en-GB")}.` : ""}
          </span>
        </form>
        <Banner state={rotateState} />
      </section>

      {/* ── Branding ── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Branding</h2>
        <p className={hint}>How the page and the PDF look to your prospect. Anything you leave blank stays neutral.</p>
        <form action={brandAction} className="mt-3 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={funnel.id} />
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="name">Funnel name</label>
            <input id="name" name="name" defaultValue={funnel.name} maxLength={80} className={`${field} mt-1`} />
            <p className={hint}>Only you see this.</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="companyName">Your company name</label>
            <input id="companyName" name="companyName" defaultValue={funnel.brand.companyName ?? ""} maxLength={80} className={`${field} mt-1`} />
          </div>
          <div>
            <label className={labelCls} htmlFor="replyToEmail">Reply-to email</label>
            <input id="replyToEmail" name="replyToEmail" type="email" defaultValue={funnel.brand.replyToEmail ?? ""} className={`${field} mt-1`} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="privacyUrl">
              Privacy policy link <span className="text-muted-foreground">(required to go live)</span>
            </label>
            <input id="privacyUrl" name="privacyUrl" type="url" defaultValue={funnel.brand.privacyUrl ?? ""} placeholder="https://yourcompany.com/privacy" className={`${field} mt-1`} />
            <p className={hint}>
              Shown beside the consent box your prospect ticks. They are giving their details to you, so the policy has
              to be yours.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="logoUrl">Logo URL</label>
            <input id="logoUrl" name="logoUrl" type="url" defaultValue={funnel.brand.logoUrl ?? ""} placeholder="https://…/logo.png" className={`${field} mt-1`} />
            <p className={hint}>
              PNG or JPEG, served over https. Those are the only formats that render both on the page and inside the PDF
              report — a PDF or SVG logo would show on one and not the other. Or upload a file below.
            </p>
          </div>
          <div>
            <label className={labelCls} htmlFor="primary">Brand colour</label>
            <div className="mt-1 flex items-center gap-2">
              <input id="primary" name="primary" defaultValue={funnel.brand.primary ?? ""} placeholder="#1a73e8" className={`${field} font-mono`} />
              {funnel.brand.primary ? (
                <span aria-hidden className="h-8 w-8 shrink-0 rounded-md border border-border" style={{ background: funnel.brand.primary }} />
              ) : null}
            </div>
            <p className={hint}>Six-digit hex. Buttons and highlights. Text on top is picked for you so it stays readable.</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="background">Page background</label>
            <div className="mt-1 flex items-center gap-2">
              <input id="background" name="background" defaultValue={funnel.brand.background ?? ""} placeholder="#ffffff" className={`${field} font-mono`} />
              {funnel.brand.background ? (
                <span aria-hidden className="h-8 w-8 shrink-0 rounded-md border border-border" style={{ background: funnel.brand.background }} />
              ) : null}
            </div>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={brandPending} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
              {brandPending ? "Saving…" : "Save branding"}
            </button>
            <Banner state={brandState} />
          </div>
        </form>

        <LogoUpload funnelId={funnel.id} current={funnel.brand.logoUrl} />
      </section>

      {/* ── Which leads you want ── */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Which leads you want</h2>
        <p className={hint}>
          Leave anything blank to accept it. A rule we cannot measure never loses you a lead — it arrives flagged instead.
        </p>
        <form action={rulesAction} className="mt-3 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={funnel.id} />
          <div>
            <label className={labelCls} htmlFor="bedroomsMin">Bedrooms, from</label>
            <input id="bedroomsMin" name="bedroomsMin" type="number" min={0} max={10} defaultValue={funnel.leadRules.bedroomsMin ?? ""} className={`${field} mt-1`} />
          </div>
          <div>
            <label className={labelCls} htmlFor="bedroomsMax">Bedrooms, to</label>
            <input id="bedroomsMax" name="bedroomsMax" type="number" min={0} max={10} defaultValue={funnel.leadRules.bedroomsMax ?? ""} className={`${field} mt-1`} />
          </div>
          <div>
            <label className={labelCls} htmlFor="grossRevenueMin">Minimum projected gross (£/yr)</label>
            <input id="grossRevenueMin" name="grossRevenueMin" inputMode="numeric" defaultValue={funnel.leadRules.grossRevenueMin ?? ""} placeholder="60000" className={`${field} mt-1`} />
          </div>
          <div>
            <label className={labelCls} htmlFor="maxAvgReviewCount">Maximum average reviews</label>
            <input id="maxAvgReviewCount" name="maxAvgReviewCount" type="number" min={0} defaultValue={funnel.leadRules.maxAvgReviewCount ?? ""} placeholder="100" className={`${field} mt-1`} />
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2">
                Why reviews measure how crowded a market is
              </summary>
              <div className="mt-2 space-y-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                <p>
                  Reviews accumulate, so the average review count of nearby listings tells you how long the hosts around
                  a property have been booking — and therefore how hard it is to break in.
                </p>
                <ul className="space-y-1">
                  {saturationGuide.map((g) => (
                    <li key={g.level}>
                      <span className="font-medium text-foreground">{g.range} — {g.headline}:</span> {g.meaning}
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </div>
          <div>
            <label className={labelCls} htmlFor="postcodeAreas">Only these postcode areas</label>
            <input id="postcodeAreas" name="postcodeAreas" defaultValue={(funnel.leadRules.postcodeAreas ?? []).join(", ")} placeholder="M, LS, BD" className={`${field} mt-1`} />
            <p className={hint}>Area letters only. Blank means anywhere.</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="excludePostcodeAreas">Never these areas</label>
            <input id="excludePostcodeAreas" name="excludePostcodeAreas" defaultValue={(funnel.leadRules.excludePostcodeAreas ?? []).join(", ")} className={`${field} mt-1`} />
            <p className={hint}>Wins over the list above.</p>
          </div>

          <div>
            <label className={labelCls} htmlFor="unqualifiedPolicy">Leads that miss your filter</label>
            <select id="unqualifiedPolicy" name="unqualifiedPolicy" defaultValue={funnel.unqualifiedPolicy} className={`${field} mt-1`}>
              <option value="crm_flagged">Send to my CRM, flagged as not qualified</option>
              <option value="hold">Hold them here for me to review</option>
            </select>
            <p className={hint}>Either way the prospect still gets their report, and you can promote a held lead later.</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="reportDepth">Report depth</label>
            <select id="reportDepth" name="reportDepth" defaultValue={funnel.reportDepth} className={`${field} mt-1`}>
              <option value="standard">Standard — £2.12 a lead</option>
              <option value="enhanced">Enhanced, with a second opinion — £4.37 a lead</option>
            </select>
            <p className={hint}>Charged to your credit when a lead completes the form.</p>
          </div>

          <div>
            <label className={labelCls} htmlFor="dailyCap">Most leads per day</label>
            <input id="dailyCap" name="dailyCap" type="number" min={1} max={10000} defaultValue={funnel.dailyCap} className={`${field} mt-1`} />
          </div>
          <div>
            <label className={labelCls} htmlFor="dailySpendCapPounds">Most to spend per day (£)</label>
            <input id="dailySpendCapPounds" name="dailySpendCapPounds" inputMode="decimal" defaultValue={(funnel.dailySpendCapPence / 100).toFixed(2)} className={`${field} mt-1`} />
            <p className={hint}>A hard ceiling. Once it is reached, further leads are captured but their reports wait.</p>
          </div>

          <div className="sm:col-span-2">
            <button type="submit" disabled={rulesPending} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
              {rulesPending ? "Saving…" : "Save rules"}
            </button>
            <Banner state={rulesState} />
          </div>
        </form>
      </section>
    </div>
  );
}

/**
 * Uploading a logo file, as an alternative to pasting a URL.
 *
 * Its own form rather than a field on the branding one: the branding form
 * posts text to a server action, and a file needs its own submission. That
 * also means uploading a logo does not make a customer re-save every other
 * branding field to keep it.
 *
 * The current logo is shown rather than described. A customer checking their
 * branding wants to see what is live, not read a URL and guess.
 */
function LogoUpload({ funnelId, current }: { funnelId: string; current: string | null }) {
  const [state, action, pending] = useActionState(uploadLogoAction, INITIAL);

  return (
    <div className="mt-4 rounded-lg border border-border bg-background p-3">
      <p className="text-xs font-medium text-foreground">Or upload a logo file</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {current ? (
          <span className="flex h-12 w-28 shrink-0 items-center justify-center rounded-md border border-border bg-card p-1">
            {/* A plain img, not next/image: a customer's logo can be on any
                host, and next/image refuses anything missing from
                images.remotePatterns. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current} alt="Your current logo" className="max-h-10 max-w-full object-contain" />
          </span>
        ) : (
          <span className="flex h-12 w-28 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            No logo
          </span>
        )}

        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={funnelId} />
          <input
            type="file"
            name="logo"
            accept="image/png,image/jpeg"
            required
            className="text-xs text-muted-foreground file:mr-2 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
          >
            {pending ? "Uploading…" : "Upload"}
          </button>
        </form>
      </div>
      <p className={hint}>PNG or JPEG, up to 2 MB. Replacing a logo removes the old one.</p>
      <Banner state={state} />
    </div>
  );
}
