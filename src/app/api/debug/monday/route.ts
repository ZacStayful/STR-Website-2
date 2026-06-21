// TEMPORARY diagnostic — exercises the exact Monday upload chain for a
// given ?email= so we can see precisely where it fails (token / find /
// file upload). DELETE once the report→Monday upload is confirmed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Minimal valid one-page PDF.
const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Root 1 0 R/Size 4>>\nstartxref\n0\n%%EOF",
);

export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get("email") || "";
  const token = process.env.MONDAY_API_KEY || process.env.MONDAY_API_TOKEN || null;

  const out: Record<string, unknown> = {
    vercelEnv: process.env.VERCEL_ENV ?? null,
    tokenPresent: Boolean(token),
    tokenLen: token?.length ?? 0,
    email,
  };
  if (!token || !email) return Response.json(out);

  const { findEnquiryByEmail } = await import("@/lib/apis/monday");
  const itemId = await findEnquiryByEmail(email);
  out.itemId = itemId;
  if (!itemId) return Response.json(out);

  try {
    const query = `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "file_mm3aevrs", file: $file) { id } }`;
    const blob = new Blob([new Uint8Array(MINIMAL_PDF)], { type: "application/pdf" });
    const form = new FormData();
    form.append("query", query);
    form.append("variables[file]", blob, "stayful-debug.pdf");
    const res = await fetch("https://api.monday.com/v2/file", {
      method: "POST",
      headers: { Authorization: token, "API-Version": "2024-10" },
      body: form,
    });
    out.uploadStatus = res.status;
    out.uploadBody = (await res.text()).slice(0, 500);
  } catch (err) {
    out.uploadError = String(err);
  }

  // Does @react-pdf actually render in this runtime? (the real flow uses it)
  try {
    const React = await import("react");
    const pdf = await import("@react-pdf/renderer");
    const { Document, Page, Text, View } = pdf as unknown as Record<string, React.ComponentType<Record<string, unknown>>>;
    const el = React.createElement(
      Document,
      null,
      React.createElement(Page, null, React.createElement(View, null, React.createElement(Text, null, "test"))),
    );
    const buf = await (pdf.renderToBuffer as (e: unknown) => Promise<Buffer>)(el);
    out.reactPdfOk = true;
    out.reactPdfBytes = buf.length;
  } catch (err) {
    out.reactPdfOk = false;
    out.reactPdfError = String(err).slice(0, 400);
  }

  return Response.json(out);
}
