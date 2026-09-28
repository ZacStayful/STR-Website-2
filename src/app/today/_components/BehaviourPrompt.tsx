import { acceptPromptAction, dismissPromptAction } from "../tailoring-actions";
import type { Prompt } from "@/lib/tailoring/behaviour";

/**
 * Batch 14: "You’ve kept 4 houses but said flats only. Update your profile?"
 * Two plain forms: works without JavaScript, and the change is worked out
 * again on the server from the member’s own Keeps.
 */
export function BehaviourPrompt({ prompt }: { prompt: Pick<Prompt, "question" | "text" | "accept" | "keep"> }) {
  return (
    <section aria-labelledby="profile-check" className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <h2 id="profile-check" className="text-xs font-semibold uppercase tracking-wide text-primary">
        A quick check
      </h2>
      <p className="mt-1 text-sm text-foreground">{prompt.text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <form action={acceptPromptAction}>
          <input type="hidden" name="question" value={prompt.question} />
          <button type="submit" className="min-h-10 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            {prompt.accept}
          </button>
        </form>
        <form action={dismissPromptAction}>
          <input type="hidden" name="question" value={prompt.question} />
          <button type="submit" className="min-h-10 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/60">
            {prompt.keep}
          </button>
        </form>
      </div>
    </section>
  );
}
