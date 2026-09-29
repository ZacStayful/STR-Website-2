"use client";

import { useActionState, useMemo, useState } from "react";
import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { LIMITS, SETTING_BOUNDS, type AnnouncementKind } from "@/lib/feedback/config";
import { maxAgeAction, publishAction, saveAction, type EditorState } from "./actions";

/**
 * The announcement editor (Batch 18): the fields, a live preview drawn by the
 * members' own banner (so what admin sees is what members will see; the
 * preview reports nothing), then Publish or take it down.
 */

const field = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";
const primary = "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";
const secondary = "inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50";

function Said({ state }: { state: EditorState }) {
  if (!state) return null;
  return (
    <p role="status" className={`text-sm ${state.ok ? "text-foreground" : "text-[#991b1b]"}`}>
      {state.message}
    </p>
  );
}

export interface EditorInitial {
  id: string | null;
  kind: AnnouncementKind;
  title: string;
  body: string;
  link: string;
  refs: string;
  state: "draft" | "live" | "ended" | "unpublished";
}

export function AnnouncementEditor({ initial }: { initial: EditorInitial }) {
  const [kind, setKind] = useState<AnnouncementKind>(initial.kind);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [link, setLink] = useState(initial.link);
  const [saveState, save, saving] = useActionState(saveAction, null);
  const [pubState, publish, publishing] = useActionState(publishAction, null);
  const errors = saveState?.errors ?? {};
  const [previewAt] = useState(() => new Date().toISOString());
  const preview = useMemo(
    () => [{ id: "preview", kind, title: title.trim() || "A short title", body: body.trim() || "Two or three lines about what’s new.", linkPath: link.trim() || null, publishedAt: previewAt }],
    [kind, title, body, link, previewAt],
  );
  const err = (k: keyof typeof errors) => (errors[k] ? <span className="text-xs text-[#991b1b]">{errors[k]}</span> : null);

  return (
    <div className="space-y-5">
      <form action={save} className="space-y-3 rounded-xl border border-border bg-card p-5">
        {initial.id && <input type="hidden" name="id" value={initial.id} />}
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1 text-xs text-muted-foreground">Type</legend>
          {(
            [
              ["feature", "New feature"],
              ["fix", "Bug fix"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
              {label}
            </label>
          ))}
          {err("kind")}
        </fieldset>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Title ({title.length}/{LIMITS.announcementTitleMax})
          <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.announcementTitleMax} className={field} required />
          {err("title")}
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Two or three lines ({body.length}/{LIMITS.announcementBodyMax})
          <textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={LIMITS.announcementBodyMax} rows={3} className={field} required />
          {err("body")}
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
            “Take a look” goes to (optional, a page on this site)
            <input name="link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="/today" className={field} />
            {err("link")}
          </label>
          <label className="flex min-w-[10rem] flex-col gap-1 text-xs text-muted-foreground">
            Reports it answers (optional)
            <input name="refs" defaultValue={initial.refs} placeholder="#12, #15" className={field} />
            {err("refs")}
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className={primary}>
            {saving ? "Saving…" : initial.id ? "Save changes" : "Save draft"}
          </button>
          <Said state={saveState} />
        </div>
      </form>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Preview: what members will see</p>
        <div className="overflow-hidden rounded-xl border border-border">
          <AnnouncementBanner items={preview} preview />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">A member with more than one unseen announcement sees them in one banner, newest first.</p>
      </div>

      {initial.id && (
        <form action={publish} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-5">
          <input type="hidden" name="id" value={initial.id} />
          {initial.state === "live" ? (
            <button type="submit" name="intent" value="unpublish" disabled={publishing} className={secondary}>
              Take it down
            </button>
          ) : (
            <button
              type="submit"
              name="intent"
              value="publish"
              disabled={publishing}
              className={primary}
              onClick={(e) => {
                if (!window.confirm(initial.state === "draft" ? "Publish to every member now? They’ll see it on their next page." : "Publish it again, from now?")) e.preventDefault();
              }}
            >
              {initial.state === "draft" ? "Publish" : "Publish again"}
            </button>
          )}
          <span className="text-xs text-muted-foreground">Save your changes before publishing.</span>
          <Said state={pubState} />
        </form>
      )}
    </div>
  );
}

export function MaxAgeForm({ days }: { days: number }) {
  const [state, action, pending] = useActionState(maxAgeAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Show each announcement for (days after publishing)
        <input name="days" type="number" min={SETTING_BOUNDS.announcementMaxAgeDays.min} max={SETTING_BOUNDS.announcementMaxAgeDays.max} defaultValue={days} className={`${field} w-28`} />
      </label>
      <button type="submit" disabled={pending} className={secondary}>
        {pending ? "Saving…" : "Save"}
      </button>
      <Said state={state} />
    </form>
  );
}
