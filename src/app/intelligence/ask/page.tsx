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
import { ChatEye } from "@/components/intelligence/chat/ChatEye";
import { QuickChat } from "@/components/intelligence/chat/QuickChat";

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
 * 29 Sep), as one screen: the eye (thinking, listening, speaking) at the top,
 * the answers in the middle, the box (type or talk) pinned at the bottom, and
 * "Full view" to switch. While the chat is off this is the view itself.
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
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#2E3D2B] text-white" style={ON_DARK}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ChatEye size={36} level={level} label="Stayful Intelligence" />
            Stayful Intelligence
          </span>
          <span className="flex items-center gap-2">
            <Link href="/intelligence#si-ask" className="rounded-full bg-[#B9D5C6] px-3 py-1 text-sm font-semibold text-[#1a2118] hover:opacity-90">
              Full view
            </Link>
            <Link href="/today" className="rounded-full border border-white/25 px-3 py-1 text-sm font-semibold text-white hover:bg-white/10">
              Close
            </Link>
          </span>
        </div>
        <main className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-4">
          <QuickChat hintPence={chat.quickHintPence} fullHintPence={chat.fullHintPence} floorPence={chat.quickFloorPence} voice={chat.voice} inputId="si-quick-q" autoFocus />
          <p className="mt-2 shrink-0 text-center text-[11px] text-[#B9D5C6]/70">Stayful Intelligence is software, not a person. I describe deals; the decision is yours.</p>
        </main>
      </div>
    </CreditProvider>
  );
}
