import { REASON_GROUPS, reasonsInGroup, reasonLabel, PICK_REASONS, type PickReason } from "@/lib/listing/picks";

/**
 * The "why not?" chips, grouped so a member can find their answer at a
 * glance, with what each one changes underneath. Plain checkboxes inside
 * whatever form wraps them: no client JavaScript.
 *
 * `tone` picks the palette: the public response page has its own colours,
 * the in-app pages use the design tokens.
 */
export function ReasonChips({ selected, tone }: { selected: PickReason[]; tone: "public" | "app" }) {
  const pub = tone === "public";
  const groupLabel = pub ? "text-[11px] font-semibold uppercase tracking-wide text-[#7a8274]" : "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
  const chip = pub ? "flex cursor-pointer items-start gap-1.5 rounded-xl border border-[#e4e7dc] bg-[#f7f8f4] px-3 py-2 text-xs" : "flex cursor-pointer items-start gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs";
  const effect = pub ? "block text-[11px] text-[#7a8274]" : "block text-[11px] text-muted-foreground";
  // An answer given before these groups existed has no chip of its own. Show
  // it, ticked, so submitting again never silently erases it.
  const shown = new Set<string>(PICK_REASONS.map((r) => r.key));
  const legacy = selected.filter((r) => !shown.has(r));
  return (
    <div className="mt-3 space-y-3">
      {REASON_GROUPS.map((g) => (
        <div key={g.key}>
          <p className={groupLabel}>{g.label}</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {reasonsInGroup(g.key).map((r) => (
              <label key={r.key} className={chip}>
                <input type="checkbox" name="reasons" value={r.key} defaultChecked={selected.includes(r.key)} className="mt-0.5" />
                <span>
                  {r.label}
                  {r.effect && <span className={effect}>{r.effect}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
      {legacy.length > 0 && (
        <div>
          <p className={groupLabel}>You told us before</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {legacy.map((r) => (
              <label key={r} className={chip}>
                <input type="checkbox" name="reasons" value={r} defaultChecked className="mt-0.5" />
                <span>{reasonLabel(r)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
