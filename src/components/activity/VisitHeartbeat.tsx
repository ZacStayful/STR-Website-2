"use client";

/**
 * The visit heartbeat. AppShell renders it on every members-only page; it
 * draws nothing. The rules (when to send, what a ping may carry) are in
 * src/lib/activity/heartbeat.ts, the server side in /api/presence.
 *
 *   - a page load says so, with ?via=email|sms when it came from one of our
 *     links (then taken off the address, so a reload is not another click)
 *   - moving between pages is counted here and sent with the next beat;
 *     Today, a deal page or a saved report is sent straight away, as a view
 *   - while the tab is shown and in use, a beat every minute; five minutes
 *     without a click, key, scroll, touch or mouse move and the beats stop,
 *     and the next one of those beats at once. Nothing about the input is
 *     read or sent: it only marks the member as there
 *   - showing the tab again, or coming back to it from the back/forward
 *     cache, says so; hiding or leaving it sends a last beat, but only after
 *     recent use, so time nobody was there never lengthens a visit
 *
 * One heartbeat per tab: each section has its own layout, so moving between
 * sections remounts this component, and its state lives outside it. Nothing
 * is stored in the browser. A heartbeat can never break the page: every
 * failure is swallowed.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { BEAT_MS, MOVE_THROTTLE_MS, beatDue, hideWorthSending, isIdle, pingBody, viaFrom, viewFor, withoutVia, type Ping } from "@/lib/activity/heartbeat";

const ENDPOINT = "/api/presence";

const state = {
  /** The page load has been announced. */
  loaded: false,
  /** Copies on screen: none while on a page without AppShell. */
  mounted: 0,
  lastPath: null as string | null,
  lastInteraction: 0,
  lastSent: 0,
  lastMove: 0,
  lastHide: 0,
  pendingPages: 0,
  /** Signed out: no more pings until the next page load. */
  stopped: false,
  started: false,
};

function visible(): boolean {
  return document.visibilityState === "visible";
}

function takePages(): number {
  const n = state.pendingPages;
  state.pendingPages = 0;
  return n;
}

function send(ping: Ping, beacon = false): void {
  if (state.stopped) return;
  state.lastSent = Date.now();
  try {
    const json = JSON.stringify(ping);
    if (beacon && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(ENDPOINT, new Blob([json], { type: "application/json" }));
      return;
    }
    fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: json, keepalive: true, credentials: "same-origin" })
      .then((res) => {
        if (res.status === 401) state.stopped = true;
      })
      .catch(() => {});
  } catch {
    // Never let a heartbeat break the page.
  }
}

function sendHide(): void {
  const now = Date.now();
  if (state.mounted === 0 || now - state.lastHide < 5_000 || !hideWorthSending(state.lastInteraction, now)) return;
  state.lastHide = now;
  send(pingBody("hide", { pages: takePages() }), true);
}

function sendResume(): void {
  if (state.mounted === 0 || !state.loaded) return;
  state.lastInteraction = Date.now();
  send(pingBody("resume", { pages: takePages() }));
}

function interacted(): void {
  const now = Date.now();
  const wasIdle = isIdle(state.lastInteraction, now);
  state.lastInteraction = now;
  if (wasIdle && visible()) sendResume();
}

function moved(): void {
  const now = Date.now();
  if (now - state.lastMove < MOVE_THROTTLE_MS) return;
  state.lastMove = now;
  interacted();
}

function onVisibility(): void {
  if (visible()) sendResume();
  else sendHide();
}

function onPageShow(e: PageTransitionEvent): void {
  if (e.persisted) sendResume();
}

function tick(): void {
  if (state.mounted === 0 || !state.loaded) return;
  if (beatDue({ visible: visible(), lastInteraction: state.lastInteraction, lastSent: state.lastSent }, Date.now())) {
    send(pingBody("beat", { pages: takePages() }));
  }
}

function start(): void {
  if (state.started) return;
  state.started = true;
  const passive: AddEventListenerOptions = { passive: true };
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) window.addEventListener(type, interacted, passive);
  window.addEventListener("mousemove", moved, passive);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", sendHide);
  window.addEventListener("pageshow", onPageShow);
  setInterval(tick, BEAT_MS);
}

export function VisitHeartbeat() {
  const pathname = usePathname();

  useEffect(() => {
    state.mounted += 1;
    try {
      start();
    } catch {
      // No heartbeat is better than a broken page.
    }
    return () => {
      state.mounted -= 1;
      // Off the members-only pages: what was counted goes now.
      if (state.mounted === 0 && state.pendingPages > 0) send(pingBody("beat", { pages: takePages() }), true);
    };
  }, []);

  useEffect(() => {
    if (!pathname || state.stopped) return;
    try {
      const view = viewFor(pathname);
      state.lastInteraction = Date.now();
      if (!state.loaded) {
        state.loaded = true;
        state.lastPath = pathname;
        const via = viaFrom(window.location.search);
        if (via) {
          const clean = withoutVia(window.location.href);
          if (clean) window.history.replaceState(null, "", clean);
        }
        send(pingBody("load", { via, view }));
        return;
      }
      if (pathname === state.lastPath) return;
      state.lastPath = pathname;
      if (view) send(pingBody("page", { pages: takePages(), view }));
      else state.pendingPages += 1;
    } catch {
      // Never let a heartbeat break the page.
    }
  }, [pathname]);

  return null;
}
