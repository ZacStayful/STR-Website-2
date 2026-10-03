import Link from "next/link";
import { CATEGORY_LABEL, CHANNEL_LABEL, KB_CATEGORIES, KB_CHANNELS, type KbCategory, type KbChannel } from "@/lib/knowledge/config";
import { CONDITIONS } from "@/lib/knowledge/placeholders";
import type { EntryContent } from "@/lib/knowledge/render";
import type { Flash } from "./flash";

/**
 * Batch 24: the Stayful Intelligence admin section's shared pieces: the
 * sub-nav (Overview is Batch 22's reveal figures, Conversations is Batch
 * 23's log), the one-shot message, and the entry form's fields. Server
 * components only.
 */

const TABS = [
  { key: "overview", label: "Overview", href: "/admin/intelligence" },
  { key: "conversations", label: "Conversations", href: "/admin/conversations" },
  { key: "gaps", label: "Gaps", href: "/admin/intelligence/gaps" },
  { key: "knowledge", label: "Knowledge", href: "/admin/intelligence/knowledge" },
  { key: "coverage", label: "Coverage", href: "/admin/intelligence/coverage" },
] as const;

export type SiTab = (typeof TABS)[number]["key"];

export function SiAdminNav({ current }: { current: SiTab }) {
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-1 border-b border-border pb-2 text-sm" aria-label="Stayful Intelligence admin">
      <Link href="/admin" className="mr-3 text-muted-foreground hover:underline">← Dashboard</Link>
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined} className={t.key === current ? "rounded-md bg-muted px-3 py-1.5 font-semibold text-foreground" : "rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted"}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function FlashBox({ flash }: { flash: Flash | null }) {
  if (!flash) return null;
  const tone = flash.kind === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900";
  return (
    <div role="status" className={`mb-4 rounded-md border p-3 text-sm ${tone}`}>
      <p>{flash.message}</p>
      {flash.detail && flash.detail.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {flash.detail.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const INPUT = "mt-1 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm";

/** The fields of an entry: what members see (question, answer), how they ask it, where it may be used. */
export function EntryFields({ value }: { value: EntryContent | null }) {
  const v = value ?? { question: "", variants: [], answer: "", category: "how_it_works", channels: ["call", "chat"], showWhen: null };
  return (
    <div className="grid grid-cols-1 gap-3">
      <label className="text-sm font-medium">
        Question (what a member sees on a chip; may use placeholders)
        <input name="question" required maxLength={200} defaultValue={v.question} className={INPUT} />
      </label>
      <label className="text-sm font-medium">
        Answer (one or two sentences, figure first; every figure a {"{placeholder}"})
        <textarea name="answer" required rows={4} maxLength={600} defaultValue={v.answer} className={INPUT} />
      </label>
      <label className="text-sm font-medium">
        Other ways people ask it (one a line; plain text)
        <textarea name="variants" rows={4} defaultValue={v.variants.join("\n")} className={INPUT} />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Category
          <select name="category" defaultValue={v.category} className={INPUT}>
            {KB_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c as KbCategory]}</option>
            ))}
          </select>
        </label>
        <fieldset className="text-sm font-medium">
          <legend>Where it may be used</legend>
          {KB_CHANNELS.map((c) => (
            <label key={c} className="mr-3 inline-flex items-center gap-1 font-normal">
              <input type="checkbox" name="channels" value={c} defaultChecked={v.channels.includes(c)} /> {CHANNEL_LABEL[c as KbChannel]}
            </label>
          ))}
        </fieldset>
        <label className="text-sm font-medium">
          Show only when
          <select name="showWhen" defaultValue={v.showWhen ?? ""} className={INPUT}>
            <option value="">Always</option>
            {Object.entries(CONDITIONS).map(([k, d]) => (
              <option key={k} value={k}>{d.label}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

export const BUTTON = "rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50";
export const BUTTON_QUIET = "rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";
export const CARD = "rounded-xl border border-border bg-card p-5";

export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "—");
