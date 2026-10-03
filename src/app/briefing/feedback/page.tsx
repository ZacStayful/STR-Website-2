import type { Metadata } from "next";
import Link from "next/link";
import { verifyExpiringFromEnv } from "@/lib/crypto/sign";
import { feedbackPayloadId } from "@/lib/briefing/email";
import { isFeedback } from "@/lib/briefing/marks-server";
import { recordBriefingFeedbackAction } from "./actions";

export const metadata: Metadata = { title: "Your morning briefing", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Batch 23b: where the email's "Useful" / "Not for me" land. The link is
 * signed and expires; the answer is recorded only when the button below is
 * pressed, so a mail scanner opening the link records nothing.
 */
export default async function BriefingFeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const done = one(p.done);
  const [b, e, s, a] = [one(p.b), one(p.e), one(p.s), one(p.a)];
  const valid = /^[0-9a-f-]{36}$/i.test(b) && isFeedback(a) && verifyExpiringFromEnv(feedbackPayloadId(b), e, s);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-md space-y-4 px-4 py-12 text-sm">
        <h1 className="text-xl font-semibold text-foreground">Your morning briefing</h1>
        {done === "1" ? (
          <p className="text-foreground">Thanks. Noted for your next briefings.</p>
        ) : done === "0" || !valid ? (
          <p className="text-muted-foreground">This link has expired or is not valid. You can still answer from the briefing on Today.</p>
        ) : (
          <form action={recordBriefingFeedbackAction} className="space-y-3">
            <p className="text-foreground">{a === "useful" ? "Mark this morning's briefing as useful?" : "Mark this morning's briefing as not for you?"}</p>
            <input type="hidden" name="b" value={b} />
            <input type="hidden" name="e" value={e} />
            <input type="hidden" name="s" value={s} />
            <input type="hidden" name="a" value={a} />
            <button type="submit" className="rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-90">
              {a === "useful" ? "Yes, it was useful" : "Yes, not for me"}
            </button>
          </form>
        )}
        <p>
          <Link href="/today" className="text-muted-foreground underline-offset-4 hover:underline">
            Go to Today
          </Link>
        </p>
      </div>
    </main>
  );
}
