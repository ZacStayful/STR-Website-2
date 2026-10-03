import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { readFlash } from "../../flash";
import { createEntryAction } from "../../actions";
import { BUTTON, CARD, EntryFields, FlashBox, SiAdminNav } from "../../SiAdmin";

export const metadata: Metadata = { title: "New knowledge entry — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Batch 24: a new knowledge entry, saved as a draft (nothing is live until it is approved). */
export default async function NewKnowledgeEntryPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/intelligence/knowledge/new");
  if (!isAdminEmail(user.email)) notFound();
  const flash = await readFlash();
  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <SiAdminNav current="knowledge" />
      <FlashBox flash={flash} />
      <Link href="/admin/intelligence/knowledge" className="text-sm font-medium text-primary hover:underline">← Knowledge</Link>
      <h1 className="mt-3 text-2xl font-semibold text-foreground">New entry</h1>
      <form action={createEntryAction} className={`mt-4 ${CARD}`}>
        <label className="mb-3 block text-sm font-medium">
          Slug (optional: made from the question; a–z, 0–9 and _; never changes)
          <input name="slug" maxLength={48} pattern="[a-z][a-z0-9_]{1,47}" className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm" />
        </label>
        <EntryFields value={null} />
        <button type="submit" className={`mt-4 ${BUTTON}`}>Save as a draft</button>
      </form>
    </div>
  );
}
