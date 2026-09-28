import { setFilterModeAction } from "../actions";

/**
 * Batch 14: an answer's Must-have / Nice-to-have switch. Two submit buttons
 * in one form, so it works without JavaScript; the current mode is pressed.
 */
export function FilterModeSwitch({ criterion, question, mode, label }: { criterion: string; question: string; mode: "must" | "nice"; label: string }) {
  const button = (value: "must" | "nice", text: string) => (
    <button
      type="submit"
      name="mode"
      value={value}
      aria-pressed={mode === value}
      className={`min-h-9 px-3 text-xs font-semibold ${mode === value ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60"}`}
    >
      {text}
    </button>
  );
  return (
    <form action={setFilterModeAction} className="flex shrink-0 overflow-hidden rounded-md border border-border" aria-label={`${label}: must-have or nice-to-have`}>
      <input type="hidden" name="criterion" value={criterion} />
      <input type="hidden" name="question" value={question} />
      {button("must", "Must-have")}
      {button("nice", "Nice-to-have")}
    </form>
  );
}
