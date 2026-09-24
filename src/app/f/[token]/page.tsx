import type { Metadata } from "next";
import { cache } from "react";
import { after } from "next/server";
import { notFound } from "next/navigation";
import EstimatePage from "@/app/estimate/page";
import { funnelPageByToken, ownPublicFunnelByToken, type PublicFunnel } from "@/lib/funnels";
import { raiseFunnelAlertById } from "@/lib/funnels/alerts";
import { firstPausedHit } from "@/lib/funnels/caps";
import { brandCssVars, brandName } from "@/lib/funnels/brand";
import { parseFunnelPrefill, previewMode, type FunnelMode, type PreviewMode } from "@/lib/funnels/mode";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEMO_MAP } from "@/lib/demo-data";

export const dynamic = "force-dynamic";

/**
 * A customer's white-label lead funnel.
 *
 * Public by design: the token in the URL is the whole credential, there is no
 * session, and the prospect filling this in never gets an account. The run is
 * charged to the funnel's OWNER — see the analyse route for the guards that
 * makes necessary.
 *
 * `noindex` for the same reason /p and /deal are: a customer's funnel hosted
 * on our domain must never compete with their own site in search results.
 *
 * Three outcomes, and the order they are resolved in is load-bearing:
 *
 *   - LIVE: the form, branded. One query, no session read — a prospect on a
 *     working funnel must not pay for a cookie read or an auth round trip.
 *   - MISSING: 404, as before.
 *   - PAUSED: the owner gets their preview (?preview=1 the form,
 *     ?preview=report the finished report against demo data, neither of which
 *     spends anything); everyone else gets a plain "not taking enquiries"
 *     page. Customers put these links on their own sites and in email
 *     sequences, so a pause mid-campaign should not look broken to their
 *     prospects — but it must not look OPEN either, so there is no form on it.
 *
 * The preview is why the owner branch exists at all: going live is gated on
 * the customer supplying a company name and privacy policy, and the preview
 * is how they check how those look. Gate them on each other and neither ever
 * happens.
 *
 * Do NOT add `revalidate`, `unstable_cache` or a cached fetch here. The owner
 * branch returns a different page from the one a stranger gets at the very
 * same URL, so a cache keyed on the URL alone would serve a customer's paused
 * funnel to the internet. `force-dynamic` above is what keeps that safe.
 */

function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * The signed-in owner of this token, or null for everyone else.
 *
 * `cache` so the page and its metadata share one session lookup and one query
 * per request, the same reason getMarketAccess in lib/market/gate.ts does.
 *
 * The configured check is not optional: createSupabaseServerClient asserts
 * NEXT_PUBLIC_SUPABASE_URL is set, so without it an environment with Supabase
 * unconfigured would turn a clean paused page into a 500.
 */
const ownerOf = cache(async (token: string): Promise<PublicFunnel | null> => {
  if (!supabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  return ownPublicFunnelByToken(user.id, token);
});

type Resolved =
  | { view: "live"; funnel: PublicFunnel }
  | { view: "preview"; funnel: PublicFunnel; paused: boolean }
  | { view: "paused"; funnel: PublicFunnel }
  | { view: "missing" };

const resolve = cache(async (token: string, mode: PreviewMode): Promise<Resolved> => {
  const lookup = await funnelPageByToken(token);
  if (lookup.state === "missing") return { view: "missing" };
  if (lookup.state === "live") {
    return mode === "none"
      ? { view: "live", funnel: lookup.funnel }
      : { view: "preview", funnel: lookup.funnel, paused: false };
  }
  // Paused. Only its owner sees anything but the closed page, and only when
  // they asked for a preview — a bare link is a not-found page for them too,
  // so pausing stays a real off switch rather than an off switch with a hole.
  if (mode !== "none") {
    const owned = await ownerOf(token);
    if (owned) return { view: "preview", funnel: owned, paused: true };
  }
  return { view: "paused", funnel: lookup.funnel };
});

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  // Resolved the same way as the page, so an owner checking their branding
  // sees their own name and favicon in the tab rather than ours — which is
  // half of what they opened the preview to look at.
  const resolved = await resolve(token, previewMode(query.preview));
  const funnel = resolved.view === "missing" ? null : resolved.funnel;
  const name = funnel ? brandName(funnel.brand) : "Property income analysis";
  return {
    title: name,
    description: `Find out what a property could earn as a short-term let, from ${name}.`,
    robots: { index: false, follow: false },
    // The root layout's Stayful favicons would otherwise carry through onto a
    // page that is supposed to look like someone else's.
    icons: funnel?.brand.logoUrl ? { icon: funnel.brand.logoUrl } : { icon: "/favicon.ico" },
  };
}

export default async function FunnelPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const mode = previewMode(query.preview);
  const resolved = await resolve(token, mode);
  if (resolved.view === "missing") notFound();

  // Setting the raw custom properties on this wrapper re-themes everything
  // underneath: `@theme inline` in globals.css bridges them to every
  // bg-background / text-primary / border-border utility, so the analyser and
  // even the address autocomplete pick up the customer's colours with no
  // component changes at all.
  const style = brandCssVars(resolved.funnel.brand) as React.CSSProperties;

  if (resolved.view === "paused") {
    // Somebody just tried to use this funnel and got nothing. If its link is on
    // the customer's website or in a sequence they are sending, those enquiries
    // are not reaching them and they have no other way to find out.
    //
    // `after` so a prospect is not kept waiting on our bookkeeping, and behind
    // `firstPausedHit` because this runs on an unauthenticated public GET —
    // otherwise hammering a paused link would make us do an upsert, a profile
    // read and an email attempt per request. The owner's own preview never
    // reaches here, so checking their own funnel does not alert them.
    after(async () => {
      if (await firstPausedHit(resolved.funnel.id)) {
        await raiseFunnelAlertById("paused_hit", resolved.funnel.id);
      }
    });
    return (
      <div style={style}>
        <ClosedNotice funnel={resolved.funnel} />
      </div>
    );
  }

  const isPreview = resolved.view === "preview";
  const previewReport = mode === "report";
  const funnelMode: FunnelMode = {
    token,
    brand: resolved.funnel.brand,
    reportDepth: resolved.funnel.reportDepth,
    preview: isPreview,
  };

  // Details the customer already held, handed over in their own link. Parsed
  // here rather than in the browser so nothing unvalidated reaches the form,
  // and never including consent.
  const prefill = parseFunnelPrefill(query);

  return (
    <div style={style}>
      {isPreview ? (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-foreground px-4 py-2 text-center text-xs font-medium text-background">
          <span>
            Preview of your {previewReport ? "report" : "form"} — nothing here is charged or saved.
          </span>
          <a
            href={`?preview=${previewReport ? "1" : "report"}`}
            className="underline underline-offset-2"
          >
            {previewReport ? "See the form instead" : "See the report instead"}
          </a>
          {resolved.paused ? (
            <span>
              Paused, so only you can see this — anyone else gets a closed page until you go live.{" "}
              <a href={`/leads/funnels/${resolved.funnel.id}`} className="underline underline-offset-2">
                Go live
              </a>
            </span>
          ) : null}
        </div>
      ) : null}
      <EstimatePage
        funnel={funnelMode}
        prefill={prefill}
        initialResult={previewReport ? DEMO_MAP.manchester : undefined}
      />
    </div>
  );
}

/**
 * What a prospect meets on a paused funnel.
 *
 * Deliberately says nothing about why, and carries no form: a paused funnel
 * must not collect anybody's details. It does carry the customer's branding
 * when they have set any, because to the prospect this is the customer's
 * page, not ours — and stays neutral when they have not.
 */
function ClosedNotice({ funnel }: { funnel: PublicFunnel }) {
  const name = brandName(funnel.brand);
  const replyTo = funnel.brand.replyToEmail;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
        {funnel.brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- an arbitrary customer host cannot go through next/image.
          <img src={funnel.brand.logoUrl} alt={name} className="mx-auto mb-4 h-10 w-auto object-contain" />
        ) : null}
        <h1 className="text-lg font-semibold text-foreground">Not taking enquiries right now</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This form is closed at the moment, so nothing you enter here would reach anyone.
          {replyTo ? " Please get in touch directly instead." : " Please try again later."}
        </p>
        {replyTo ? (
          <p className="mt-4 text-sm">
            <a href={`mailto:${replyTo}`} className="font-medium text-primary underline underline-offset-2">
              {replyTo}
            </a>
          </p>
        ) : null}
      </div>
    </main>
  );
}
