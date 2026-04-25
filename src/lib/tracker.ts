// ─── Session Analytics Tracker ────────────────────────────────────
// Lightweight client-side tracker for lead engagement with property
// analysis reports. Captures scroll depth, section dwell time, CTA
// clicks, click positions, and scroll stops. Calculates an overall
// engagement score (0-100). Sends data to /api/track on page unload.

export interface SessionData {
  sessionId: string;
  startTime: string;
  totalTimeSeconds: number;
  propertyAddress: string;
  postcode: string;
  scrollDepthPercent: number;
  sectionsViewed: { sectionId: string; timeSeconds: number }[];
  ctaClicks: { ctaId: string; timestamp: string }[];
  deviceType: "desktop" | "mobile" | "tablet";
  referrer: string;
  clicks: { x: number; y: number; elementId: string; timestamp: number }[];
  scrollStops: { y: number; durationSeconds: number }[];
  engagementScore: number;
}

// ─── Internal State ───────────────────────────────────────────────

let sessionId = "";
let startTime = "";
let startMs = 0;
let propertyAddress = "";
let postcode = "";
let scrollDepthPercent = 0;
let totalTimeSeconds = 0;

const sectionsMap = new Map<string, number>(); // sectionId -> accumulated ms
const ctaClicks: { ctaId: string; timestamp: string }[] = [];
const clicks: { x: number; y: number; elementId: string; timestamp: number }[] = [];
const scrollStops: { y: number; durationSeconds: number }[] = [];

let timerInterval: ReturnType<typeof setInterval> | null = null;
let scrollThrottleTimer: ReturnType<typeof setTimeout> | null = null;
let lastScrollY = 0;
let lastScrollTime = 0;
let scrollStopTimer: ReturnType<typeof setTimeout> | null = null;
let sectionObserver: IntersectionObserver | null = null;
let visibleSections = new Set<string>();
let sectionTimers = new Map<string, number>(); // sectionId -> timestamp when became visible
let initialized = false;

// ─── Helpers ──────────────────────────────────────────────────────

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getDeviceType(): "desktop" | "mobile" | "tablet" {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w < 768) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

function getMaxScrollPercent(): number {
  if (typeof document === "undefined") return 0;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  if (docHeight <= 0) return 100;
  return Math.min(100, Math.round((window.scrollY / docHeight) * 100));
}

function flushVisibleSections(): void {
  const now = Date.now();
  for (const sectionId of visibleSections) {
    const start = sectionTimers.get(sectionId);
    if (start) {
      const elapsed = now - start;
      sectionsMap.set(sectionId, (sectionsMap.get(sectionId) || 0) + elapsed);
      sectionTimers.set(sectionId, now);
    }
  }
}

// ─── Engagement Score ─────────────────────────────────────────────

function calculateEngagementScore(): number {
  let score = 0;

  // Time scoring
  if (totalTimeSeconds > 180) score += 30;
  else if (totalTimeSeconds > 60) score += 15;

  // Scroll depth
  if (scrollDepthPercent > 80) score += 20;
  else if (scrollDepthPercent > 50) score += 10;

  // CTA clicks
  const clickedIds = new Set(ctaClicks.map((c) => c.ctaId));
  if (clickedIds.has("view_presentation")) score += 20;
  if (clickedIds.has("book_call")) score += 30;

  // Sections viewed (those with >0 time)
  const viewedCount = Array.from(sectionsMap.values()).filter((ms) => ms > 500).length;
  if (viewedCount >= 5) score += 10;

  return Math.min(100, score);
}

// ─── Event Handlers ───────────────────────────────────────────────

function handleScroll(): void {
  if (scrollThrottleTimer) return;
  scrollThrottleTimer = setTimeout(() => {
    scrollThrottleTimer = null;

    const currentY = window.scrollY;
    const currentPercent = getMaxScrollPercent();
    if (currentPercent > scrollDepthPercent) {
      scrollDepthPercent = currentPercent;
    }

    // Scroll stop detection
    if (scrollStopTimer) clearTimeout(scrollStopTimer);
    lastScrollY = currentY;
    lastScrollTime = Date.now();

    scrollStopTimer = setTimeout(() => {
      // User paused scrolling for >2 seconds
      const stopY = Math.round(lastScrollY);
      const duration = (Date.now() - lastScrollTime) / 1000;
      if (duration >= 2) {
        scrollStops.push({ y: stopY, durationSeconds: Math.round(duration * 10) / 10 });
      }
    }, 2000);
  }, 500);
}

function handleClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  const elementId = target.id || target.closest("[id]")?.id || target.tagName.toLowerCase();
  clicks.push({
    x: Math.round(e.clientX),
    y: Math.round(e.clientY + window.scrollY),
    elementId,
    timestamp: Date.now(),
  });
}

function handleBeforeUnload(): void {
  const data = endSession();
  try {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    navigator.sendBeacon("/api/track", blob);
  } catch {
    // Silently fail — best effort
  }
}

// ─── Section Observer ─────────────────────────────────────────────

function setupSectionObserver(): void {
  if (typeof IntersectionObserver === "undefined") return;

  sectionObserver = new IntersectionObserver(
    (entries) => {
      const now = Date.now();
      for (const entry of entries) {
        const id = entry.target.id;
        if (!id) continue;

        if (entry.isIntersecting) {
          visibleSections.add(id);
          if (!sectionTimers.has(id)) {
            sectionTimers.set(id, now);
          }
        } else {
          if (visibleSections.has(id)) {
            const start = sectionTimers.get(id);
            if (start) {
              const elapsed = now - start;
              sectionsMap.set(id, (sectionsMap.get(id) || 0) + elapsed);
            }
            visibleSections.delete(id);
            sectionTimers.delete(id);
          }
        }
      }
    },
    { threshold: [0, 0.25, 0.5] }
  );

  // Observe all sections with IDs, slight delay for DOM to settle
  setTimeout(() => {
    const sections = document.querySelectorAll("section[id]");
    sections.forEach((section) => {
      sectionObserver?.observe(section);
    });
  }, 200);
}

// ─── Local Storage ────────────────────────────────────────────────

const STORAGE_KEY = "stayful_sessions";
const MAX_SESSIONS = 50;

function storeSession(data: SessionData): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const sessions: SessionData[] = raw ? JSON.parse(raw) : [];
    sessions.push(data);
    // Keep only last 50 sessions
    while (sessions.length > MAX_SESSIONS) {
      sessions.shift();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage unavailable or full — silently fail
  }
}

export function getStoredSessions(): SessionData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ─── Public API ───────────────────────────────────────────────────

export function initTracker(propAddress: string, propPostcode: string): void {
  if (initialized) return;
  initialized = true;

  sessionId = uuid();
  startTime = new Date().toISOString();
  startMs = Date.now();
  propertyAddress = propAddress;
  postcode = propPostcode;
  scrollDepthPercent = 0;
  totalTimeSeconds = 0;

  // Clear any prior state
  sectionsMap.clear();
  ctaClicks.length = 0;
  clicks.length = 0;
  scrollStops.length = 0;
  visibleSections.clear();
  sectionTimers.clear();

  // Timer to update total time
  timerInterval = setInterval(() => {
    totalTimeSeconds = Math.round((Date.now() - startMs) / 1000);
  }, 1000);

  // Event listeners
  window.addEventListener("scroll", handleScroll, { passive: true });
  window.addEventListener("click", handleClick, { passive: true });
  window.addEventListener("beforeunload", handleBeforeUnload);

  // Section visibility tracking
  setupSectionObserver();
}

export function trackCtaClick(ctaId: string): void {
  ctaClicks.push({ ctaId, timestamp: new Date().toISOString() });
}

export function getSessionData(): SessionData {
  flushVisibleSections();
  totalTimeSeconds = Math.round((Date.now() - startMs) / 1000);

  const sectionsViewed = Array.from(sectionsMap.entries()).map(([sectionId, ms]) => ({
    sectionId,
    timeSeconds: Math.round(ms / 1000),
  }));

  return {
    sessionId,
    startTime,
    totalTimeSeconds,
    propertyAddress,
    postcode,
    scrollDepthPercent,
    sectionsViewed,
    ctaClicks: [...ctaClicks],
    deviceType: getDeviceType(),
    referrer: typeof document !== "undefined" ? document.referrer : "",
    clicks: [...clicks],
    scrollStops: [...scrollStops],
    engagementScore: calculateEngagementScore(),
  };
}

export function endSession(): SessionData {
  const data = getSessionData();

  // Cleanup
  if (timerInterval) clearInterval(timerInterval);
  if (scrollThrottleTimer) clearTimeout(scrollThrottleTimer);
  if (scrollStopTimer) clearTimeout(scrollStopTimer);
  if (sectionObserver) sectionObserver.disconnect();

  window.removeEventListener("scroll", handleScroll);
  window.removeEventListener("click", handleClick);
  window.removeEventListener("beforeunload", handleBeforeUnload);

  // Store to localStorage
  storeSession(data);

  initialized = false;
  return data;
}
