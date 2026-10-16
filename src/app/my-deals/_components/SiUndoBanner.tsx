import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { readActionConfig, recentUndoable } from "@/lib/si-actions/store-server";
import { cardView, summaryLine } from "@/lib/si-actions/view";
import { SiUndoButton } from "./SiUndoButton";

/** What the eye changed in the Undo window, newest first (at most three); empty when it can't be read. */
async function undoableFor(userId: string): Promise<{ id: string; line: string }[]> {
  if (!hasServiceRole()) return [];
  try {
    const admin = createAdminClient();
    const config = await readActionConfig(admin);
    const now = new Date();
    const recent = await recentUndoable(admin, userId, new Date(now.getTime() - config.undoHours * 60 * 60 * 1000));
    return recent
      .map(({ instruction, steps }) => ({ id: instruction.id, open: Boolean(cardView(instruction, steps, { now, undoHours: config.undoHours }).undo), line: summaryLine(steps) }))
      .filter((x) => x.open && x.line)
      .slice(0, 3)
      .map(({ id, line }) => ({ id, line }));
  } catch (err) {
    console.error("[my-deals] SI undo banner:", (err as Error)?.message ?? err);
    return [];
  }
}

/**
 * Batch 27: what Stayful Intelligence changed here for the member in the
 * Undo window ("Stayful Intelligence: Passed 4 deals · Undo"), so Undo is one
 * tap from My deals as well as from the chat. Charges are never undone.
 */
export async function SiUndoBanner({ userId }: { userId: string }) {
  const items = await undoableFor(userId);
  if (items.length === 0) return null;
  return (
    <section aria-label="Changed by Stayful Intelligence" className="space-y-2">
      {items.map((x) => (
        <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
          <span className="min-w-0">
            <span className="font-medium">Stayful Intelligence:</span> {x.line}
          </span>
          <SiUndoButton instructionId={x.id} />
        </div>
      ))}
    </section>
  );
}
