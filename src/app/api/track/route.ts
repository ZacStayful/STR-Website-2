// ─── Session Tracking Endpoint ────────────────────────────────────
// Receives session analytics data from the client-side tracker.
// Currently logs to console. Will push to Monday.com when configured.

const sessions: Record<string, unknown>[] = [];

export async function POST(request: Request) {
  try {
    const data = await request.json();

    console.log(
      "Session tracked:",
      data.sessionId,
      `${data.engagementScore}/100`,
      `${data.totalTimeSeconds}s`,
      `scroll:${data.scrollDepthPercent}%`,
      `sections:${data.sectionsViewed?.length ?? 0}`,
      `ctas:${data.ctaClicks?.length ?? 0}`
    );

    // Store in memory (resets on server restart)
    sessions.push(data);

    // Keep only last 200 in memory
    while (sessions.length > 200) {
      sessions.shift();
    }

    // Push time-on-site to Monday CRM (silent, fire-and-forget)
    if (data.type === 'time_on_site' && data.email && data.seconds > 0) {
      const { syncTimeOnSiteToMonday } = await import('@/lib/apis/monday');
      void syncTimeOnSiteToMonday(data.email, data.seconds);
    }

    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }
}
