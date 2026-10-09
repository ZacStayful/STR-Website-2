import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { requireProfileStart } from "@/lib/profile/server";
import { eyeLevelFor } from "@/lib/home/eye-server";
import { teamCreditSnapshot } from "@/lib/team/credit";
import { chatUi } from "@/lib/chat/turns-server";
import { CreditProvider } from "@/components/credit/CreditProvider";
import { StayfulEye } from "@/components/StayfulEye";
import { QuickAsk } from "@/components/intelligence/chat/QuickAsk";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ask Stayful Intelligence",
  robots: { index: false, follow: false },
};

const ON_DARK = {
  "--si-eye": "#8ab382",
  "--si-eye-bright": "#b5d9ab",
  "--si-eye-glow": "#1a3018",
  "--si-eye-iris": "#2e3d2b",
  "--si-eye-iris-deep": "#0f150e",
} as CSSProperties;

/**
 * Batch 26: on a phone, the header eye opens quick answers full screen (Zac,
 * 29 Sep): the quick box at the top and "Open full view" to switch. While the
 * chat is off this is the view itself.
 */
export default async function AskPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/intelligence/ask");
  const profile = await requireProfileStart(user.id, "/intelligence/ask");
  const chat = await chatUi();
  if (!chat) redirect("/intelligence");
  const admin = isAdminEmail(user.email);
  const [credit, level] = await Promise.all([teamCreditSnapshot({ id: user.id, admin }).catch(() => null), eyeLevelFor(profile)]);

  return (
    <CreditProvider initial={credit}>
      <div className="min-h-screen bg-[#2E3D2B] text-white" style={ON_DARK}>
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/10 bg-[#2E3D2B]/95 px-4 py-2 backdrop-blur">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <StayfulEye size={24} level={level} />
            Stayful Intelligence
          </span>
          <Link href="/today" className="rounded-full border border-white/25 px-3 py-1 text-sm font-semibold text-white hover:bg-white/10">
            Close
          </Link>
        </div>
        <main className="mx-auto max-w-xl space-y-5 px-4 pb-16 pt-6">
          <h1 className="text-lg font-semibold">Ask me something quick</h1>
          <QuickAsk hintPence={chat.quickHintPence} fullHintPence={chat.fullHintPence} floorPence={chat.quickFloorPence} autoFocus />
          <Link href="/intelligence#si-ask" className="inline-block rounded-full bg-[#B9D5C6] px-4 py-2 text-sm font-semibold text-[#1a2118] hover:opacity-90">
            Open full view
          </Link>
          <p className="text-xs text-[#B9D5C6]/80">Stayful Intelligence is software, not a person. I describe deals; the decision is yours.</p>
        </main>
      </div>
    </CreditProvider>
  );
}
