// ─── Session Tracking Endpoint ────────────────────────────────────
// Receives session analytics from the STR Estimate Software client.
// Looks up the lead in Monday by postcode, writes time spent + 
// engagement score to the "Time lead spent on analyser" column.

const BOARD_ID = "5891626711";
const TIME_COLUMN = "text_mm1ysvmg";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

async function findMondayItemByPostcode(postcode: string): Promise<string | null> {
  const clean = postcode.trim().toLowerCase();
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_KEY!,
      "API-Version": "2024-01",
    },
    body: JSON.stringify({
      query: `query {
        boards(ids: [${BOARD_ID}]) {
          items_page(limit: 200) {
            items {
              id
              column_values(ids: ["text6"]) { text }
            }
          }
        }
      }`,
    }),
  });

  const data = await res.json();
  const items = data?.data?.boards?.[0]?.items_page?.items ?? [];

  // Match by postcode — check if the address column contains the postcode
  const match = items.find((item: { id: string; column_values: { text: string }[] }) => {
    const address = item.column_values[0]?.text?.toLowerCase() ?? "";
    return address.includes(clean) || address.includes(clean.replace(" ", ""));
  });

  return match?.id ?? null;
}

export async function POST(request: Request) {
  try {
    const data = await request.json();

    const {
      totalTimeSeconds,
      engagementScore,
      postcode,
      propertyAddress,
      scrollDepthPercent,
      sectionsViewed,
      ctaClicks,
    } = data;

    // Find the Monday item
    const itemId = await findMondayItemByPostcode(postcode ?? "");

    if (!itemId) {
      console.warn(`[track] No Monday item found for postcode: ${postcode}`);
      return Response.json({ ok: true, monday: "not_found" });
    }

    // Format the value
    const duration = formatDuration(totalTimeSeconds ?? 0);
    const scrollLabel = `${scrollDepthPercent ?? 0}% scroll`;
    const sectionsLabel = `${(sectionsViewed ?? []).length} sections`;
    const ctaLabel = (ctaClicks ?? []).some((c: { ctaId: string }) => c.ctaId === "book_call")
      ? " · booked call ✓"
      : "";
    const value = `${duration} · score ${engagementScore ?? 0}/100 · ${scrollLabel} · ${sectionsLabel}${ctaLabel}`;

    // Write to Monday
    await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: process.env.MONDAY_API_KEY!,
        "API-Version": "2024-01",
      },
      body: JSON.stringify({
        query: `mutation {
          change_column_value(
            board_id: ${BOARD_ID},
            item_id: ${itemId},
            column_id: "${TIME_COLUMN}",
            value: "${value.replace(/"/g, "'")}"
          ) { id }
        }`,
      }),
    });

    console.log(`[track] ${propertyAddress} (${postcode}) → item ${itemId} → ${value}`);
    return Response.json({ ok: true, itemId, value });
  } catch (err) {
    console.error("[track] Error:", err);
    return Response.json({ ok: false, error: "Tracking failed" }, { status: 500 });
  }
}
