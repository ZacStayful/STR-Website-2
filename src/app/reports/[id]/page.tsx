import type { Metadata } from "next";
import { notFound } from "next/navigation";
import EstimatePage from "@/app/estimate/page";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AnalysisResult } from "@/lib/types";

export const metadata: Metadata = {
  title: "Saved report — Stayful Intelligence",
  robots: { index: false, follow: false },
};

/** Reopens a saved report. RLS restricts the row to its owner; anything else is a 404. */
export default async function SavedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("saved_searches").select("result").eq("id", id).maybeSingle();
  const result = data?.result as AnalysisResult | undefined;
  if (!result || !result.property || !result.financials) notFound();
  return <EstimatePage initialResult={{ ...result, reportId: id }} />;
}
