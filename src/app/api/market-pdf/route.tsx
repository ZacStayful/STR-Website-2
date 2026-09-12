import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { getAreaCards } from "@/lib/market/cached";
import { accessDenied } from "@/lib/access";
import { getMarketAccess } from "@/lib/market/gate";
import { personaliseScore, personalInputFor } from "@/lib/market/personalise";
import { loadExplorerUser } from "@/app/markets/_lib/loadExplorerUser";
import { AreaReport } from "@/lib/pdf/market/AreaReport";

export const runtime = "nodejs";

// Members-only, like the explorer itself: 401 signed out, 402 without access.
export async function GET(request: Request) {
  const { state, user: authUser, profile } = await getMarketAccess();
  if (state === "anon") return Response.json({ error: "Sign in to download area reports." }, { status: 401 });
  if (state !== "ok") return Response.json(accessDenied(profile, "area reports"), { status: 402 });

  const code = (new URL(request.url).searchParams.get("area") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{1,2}$/.test(code)) return Response.json({ error: "Unknown area" }, { status: 400 });

  const [cards, user] = await Promise.all([getAreaCards(), loadExplorerUser(authUser)]);
  const card = cards.find((c) => c.code === code);
  if (!card) return Response.json({ error: "No data for that area yet" }, { status: 404 });

  const personal = user.goals ? personaliseScore(personalInputFor(card, user.goals), user.goals) : null;

  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const buffer = await renderToBuffer(<AreaReport card={card} personal={personal} generatedAt={generatedAt} />);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Stayful_Market_Explorer_${card.slug}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
