"use client";

import { useEffect, useState } from "react";
import type { SessionData } from "@/lib/tracker";
import { getStoredSessions } from "@/lib/tracker";

// ─── Heatmap Overlay ──────────────────────────────────────────────
// Developer-only visual overlay showing click positions, scroll stops,
// and engagement score. Activated via ?heatmap=true in the URL.

export default function HeatmapOverlay() {
  const [active, setActive] = useState(false);
  const [session, setSession] = useState<SessionData | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("heatmap") !== "true") return;

    setActive(true);

    // Load most recent session from localStorage
    const sessions = getStoredSessions();
    if (sessions.length > 0) {
      setSession(sessions[sessions.length - 1]);
    }

    // Refresh every 3 seconds to pick up live data
    const interval = setInterval(() => {
      const updated = getStoredSessions();
      if (updated.length > 0) {
        setSession(updated[updated.length - 1]);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  if (!active || !session) return null;

  const now = Date.now();

  return (
    <>
      {/* Click dots */}
      {session.clicks.map((click, i) => {
        const age = (now - click.timestamp) / 1000;
        // Red = recent (<30s), orange = medium, blue = old
        const color =
          age < 30
            ? "rgba(239, 68, 68, 0.7)"
            : age < 120
              ? "rgba(249, 115, 22, 0.6)"
              : "rgba(59, 130, 246, 0.5)";

        return (
          <div
            key={`click-${i}`}
            style={{
              position: "absolute",
              left: click.x - 6,
              top: click.y - 6,
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: color,
              border: "1px solid rgba(255,255,255,0.5)",
              zIndex: 9998,
              pointerEvents: "none",
            }}
            title={`Click: ${click.elementId} (${Math.round(age)}s ago)`}
          />
        );
      })}

      {/* Scroll stop lines */}
      {session.scrollStops.map((stop, i) => (
        <div
          key={`stop-${i}`}
          style={{
            position: "absolute",
            left: 0,
            top: stop.y,
            width: "100%",
            height: Math.min(6, Math.max(2, stop.durationSeconds)),
            backgroundColor: "rgba(168, 85, 247, 0.3)",
            zIndex: 9997,
            pointerEvents: "none",
          }}
          title={`Scroll stop: ${stop.durationSeconds}s`}
        />
      ))}

      {/* Engagement score badge */}
      <div
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          zIndex: 9999,
          backgroundColor:
            session.engagementScore >= 60
              ? "rgba(34, 197, 94, 0.9)"
              : session.engagementScore >= 30
                ? "rgba(234, 179, 8, 0.9)"
                : "rgba(239, 68, 68, 0.9)",
          color: "#fff",
          padding: "8px 14px",
          borderRadius: 8,
          fontFamily: "monospace",
          fontSize: 13,
          lineHeight: 1.4,
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          pointerEvents: "none",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          Engagement: {session.engagementScore}/100
        </div>
        <div>Time: {session.totalTimeSeconds}s</div>
        <div>Scroll: {session.scrollDepthPercent}%</div>
        <div>Clicks: {session.clicks.length}</div>
        <div>CTAs: {session.ctaClicks.length}</div>
        <div>Sections: {session.sectionsViewed.filter((s) => s.timeSeconds > 0).length}</div>
      </div>
    </>
  );
}
