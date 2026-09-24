import { buildScreenReport, screenReportCsv, passRateLine } from "@/lib/listing/screen-report";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Income screening report ───────────────────────────────────────────
// Measurement only. Screens every stored sourced_listings row against the
// screening tests in src/lib/listing/screen.ts and returns the ranked table
// plus the band distribution. Writes nothing, sends nothing, charges nobody, and
// makes no provider calls of its own. It does read the shared market snapshot,
// which is normally warm (the market-warm cron builds it daily, cached an hour);
// a COLD snapshot is rebuilt by that read, which costs dozens of PropertyData
// calls. `snapshotWasWarm` in the response says which happened. Not on a cron:
// run it by hand.
//
//   ?format=csv     the rows as a spreadsheet (sort and pivot by hand)
//   ?limit=<n>      cap the rows returned; the summary always covers everything
//   ?summary=1      the summary only, no rows
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/screen-report?summary=1"
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/screen-report?format=csv" -o screening.csv

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const rawLimit = Number(params.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : undefined;

  let report;
  try {
    report = await buildScreenReport({ limit });
  } catch (err) {
    const message = (err as Error)?.message ?? "Screening failed";
    console.error("[screen-report] failed:", message);
    return Response.json({ error: message }, { status: 503 });
  }

  console.log("[screen-report]", passRateLine(report));

  if (params.get("format") === "csv") {
    return new Response(screenReportCsv(report), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="screening-${report.generatedAt.slice(0, 10)}.csv"`,
      },
    });
  }

  if (params.get("summary") === "1") {
    const { rows, ...rest } = report;
    return Response.json({ ...rest, rowsOmitted: rows.length });
  }

  return Response.json(report);
}
