"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The Cloudflare Turnstile challenge on a public funnel form.
 *
 * Renders nothing at all when no site key is configured, so a funnel that
 * was live before Turnstile existed keeps working unchanged.
 *
 * The widget is rendered explicitly rather than by Cloudflare's automatic
 * scan of the page. The analyser is a long-lived client component whose form
 * mounts and unmounts as the prospect moves around, and the automatic mode
 * only scans once on script load — so a widget that appeared after that
 * would silently never be drawn.
 */

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    onloadTurnstileCallback?: () => void;
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** One shared load across every mount; the script must not be added twice. */
let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("turnstile script failed")));
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("turnstile script failed"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface TurnstileWidgetProps {
  siteKey: string | null;
  /** Called with the solved token, or null when it expires or is reset. */
  onToken: (token: string | null) => void;
  /** Light or dark, to match the customer's branding. */
  theme?: "light" | "dark" | "auto";
}

export function TurnstileWidget({ siteKey, onToken, theme = "auto" }: TurnstileWidgetProps) {
  const holder = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  // onToken is read through a ref so the effect keeps an empty dependency
  // list. A parent that re-creates the callback each render would otherwise
  // tear down and re-draw the widget on every keystroke, losing a solved
  // token the prospect has already waited for.
  const onTokenRef = useRef(onToken);
  // Updated in an effect, not during render: assigning to a ref while
  // rendering is a React rule violation, and the initial useRef value
  // already holds the first callback, so nothing is missed on mount.
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey || !holder.current) return;
    let cancelled = false;

    loadTurnstile()
      .then(() => {
        if (cancelled || !holder.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(holder.current, {
          sitekey: siteKey,
          theme,
          callback: (token: string) => onTokenRef.current(token),
          // Both of these mean "the token you hold is no longer good".
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        if (cancelled) return;
        // The script is blocked or unreachable. The server fails open in
        // that case, so the prospect is told nothing and the form still
        // submits — being unable to load an anti-bot check is not their
        // problem to solve.
        setFailed(true);
        onTokenRef.current(null);
      });

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          // Already gone; nothing to clean up.
        }
      }
      widgetId.current = null;
    };
  }, [siteKey, theme]);

  if (!siteKey || failed) return null;

  return <div ref={holder} className="mt-3" data-testid="turnstile" />;
}

/**
 * Clears a spent challenge so the prospect can submit again.
 *
 * Turnstile tokens are single-use. If a submission is rejected for any other
 * reason — a bad postcode, an out-of-credit funnel — the token is already
 * burnt, and without this the retry fails the security check instead of
 * showing the real problem.
 */
export function resetTurnstile(): void {
  if (typeof window !== "undefined" && window.turnstile) {
    try {
      window.turnstile.reset();
    } catch {
      // Nothing rendered; nothing to reset.
    }
  }
}
