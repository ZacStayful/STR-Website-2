"use client";

import type { LineItemState } from "./lineItemDefaults";
import { CATEGORY_ORDER } from "./lineItemDefaults";

interface Props {
  items: LineItemState[];
  onChange: (items: LineItemState[]) => void;
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

export function LineItemsEditor({ items, onChange }: Props) {
  const update = (id: string, patch: Partial<LineItemState>) => {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const toggleCategory = (category: string, active: boolean) => {
    onChange(items.map((it) => (it.category === category ? { ...it, active } : it)));
  };

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    items: items.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      {grouped.map((group) => {
        const allActive = group.items.every((i) => i.active);
        const someActive = group.items.some((i) => i.active);

        return (
          <div key={group.category}>
            {/* Category header with toggle */}
            <div className="mb-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={allActive}
                ref={(el) => { if (el) el.indeterminate = someActive && !allActive; }}
                onChange={(e) => toggleCategory(group.category, e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-primary-foreground"
                aria-label={`Toggle all ${group.category}`}
              />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/70">
                {group.category}
              </p>
            </div>
            <div className="overflow-hidden rounded-lg border border-primary-foreground/15">
              <table className="w-full">
                <thead className="bg-primary-foreground/10">
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-primary-foreground/60">
                    <th className="w-8 py-2 pl-3 pr-1"></th>
                    <th className="py-2 pr-2">Item</th>
                    <th className="w-16 py-2 pr-2 text-right">Qty</th>
                    <th className="w-24 py-2 pr-2 text-right">Unit £</th>
                    <th className="w-24 py-2 pr-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((it) => {
                    const lineTotal = it.qty * it.unitCost;
                    return (
                      <tr
                        key={it.id}
                        className={`border-t border-primary-foreground/10 ${it.active ? "" : "opacity-40"}`}
                      >
                        <td className="py-2 pl-3 pr-1 align-top">
                          <input
                            type="checkbox"
                            checked={it.active}
                            onChange={(e) => update(it.id, { active: e.target.checked })}
                            className="h-4 w-4 cursor-pointer accent-primary-foreground"
                            aria-label={`Include ${it.name}`}
                          />
                        </td>
                        <td className="py-2 pr-2 align-top">
                          <p className="text-sm font-medium text-primary-foreground">{it.name}</p>
                          <p className="text-[10px] text-primary-foreground/50">{it.supplier}</p>
                        </td>
                        <td className="py-2 pr-2 align-top text-right">
                          {it.computedTotal ? (
                            <span className="text-sm text-primary-foreground/50">—</span>
                          ) : (
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={it.qty}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                if (Number.isFinite(n) && n >= 0) update(it.id, { qty: Math.round(n) });
                              }}
                              disabled={!it.active}
                              className="w-14 rounded border border-primary-foreground/30 bg-primary-foreground/10 px-2 py-1 text-right text-sm text-primary-foreground outline-none disabled:opacity-60"
                            />
                          )}
                        </td>
                        <td className="py-2 pr-2 align-top text-right">
                          {it.computedTotal ? (
                            <span className="text-sm text-primary-foreground/50">—</span>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-xs text-primary-foreground/70">£</span>
                              <input
                                type="number"
                                min={0}
                                step={5}
                                value={it.unitCost}
                                onChange={(e) => {
                                  const n = Number(e.target.value);
                                  if (Number.isFinite(n) && n >= 0) update(it.id, { unitCost: n });
                                }}
                                disabled={!it.active}
                                className="w-20 rounded border border-primary-foreground/30 bg-primary-foreground/10 px-2 py-1 text-right text-sm text-primary-foreground outline-none disabled:opacity-60"
                              />
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 align-top text-right">
                          <p className={`text-sm font-semibold ${it.active ? "text-primary-foreground" : "text-primary-foreground/50"}`}>
                            {gbp(lineTotal)}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
