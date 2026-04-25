import { NextRequest, NextResponse } from "next/server";

const MONDAY_API_KEY = process.env.MONDAY_API_KEY!;
const BOARD_ID = "5891626711";
const EMAIL_COLUMN_ID = "text_mkygb5xx";
const FILE_COLUMN_ID = "file_mm1daxvv";

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  try {
    // Search Monday board for matching email
    const query = `
      query {
        boards(ids: [${BOARD_ID}]) {
          items_page(limit: 10, query_params: {
            rules: [{
              column_id: "${EMAIL_COLUMN_ID}",
              compare_value: ["${email.toLowerCase().trim()}"]
            }]
          }) {
            items {
              id
              name
              column_values(ids: ["${FILE_COLUMN_ID}", "${EMAIL_COLUMN_ID}"]) {
                id
                value
                text
              }
            }
          }
        }
      }
    `;

    const mondayRes = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: MONDAY_API_KEY,
      },
      body: JSON.stringify({ query }),
    });

    const mondayData = await mondayRes.json();
    const items = mondayData?.data?.boards?.[0]?.items_page?.items ?? [];

    if (items.length === 0) {
      return NextResponse.json({ error: "No lead found with that email address." }, { status: 404 });
    }

    const item = items[0];
    const fileColumn = item.column_values.find((c: { id: string }) => c.id === FILE_COLUMN_ID);

    if (!fileColumn?.value) {
      return NextResponse.json({ error: "No report has been generated for this lead yet. Please contact Stayful." }, { status: 404 });
    }

    // Parse the file column value
    let fileUrl: string | null = null;
    let fileName: string | null = null;

    try {
      const parsed = JSON.parse(fileColumn.value);
      const files = parsed?.files ?? [];
      if (files.length > 0) {
        fileUrl = files[files.length - 1]?.url ?? null;
        fileName = files[files.length - 1]?.name ?? "Stayful-Analyser.pdf";
      }
    } catch {
      return NextResponse.json({ error: "Could not parse report file." }, { status: 500 });
    }

    if (!fileUrl) {
      return NextResponse.json({ error: "No report file found for this lead." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      leadName: item.name,
      fileUrl,
      fileName,
    });
  } catch (err) {
    console.error("Monday API error:", err);
    return NextResponse.json({ error: "Failed to fetch report. Please try again." }, { status: 500 });
  }
}
