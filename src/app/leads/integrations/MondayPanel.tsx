"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  saveMondayAction, saveMondayMappingAction, testConnectionAction, deleteConnectionAction,
  loadMondayBoards, loadMondayGroups, loadMondayFields, type CrmState,
} from "./actions";
import { MONDAY_FIELDS, parseMondayConfig } from "@/lib/crm/monday-map";
import type { CrmField } from "@/lib/crm/types";

const INITIAL: CrmState = {};

interface Props {
  connection: {
    id: string;
    config: Record<string, unknown>;
    status: "unverified" | "ok" | "error";
    lastError: string | null;
    hasCredential: boolean;
    blockers: string[];
  } | null;
}

/**
 * Connecting a customer's own Monday board.
 *
 * The mapping step is the part that cannot be skipped: every board has
 * different column ids, so the board's real columns are read from Monday and
 * the customer says which of theirs receives each field. The option value
 * carries the column's TYPE alongside its id, because Monday's accepted
 * value shape depends on the type and a wrong shape rejects the whole push.
 */
export function MondayPanel({ connection }: Props) {
  const [saveState, saveAction, saving] = useActionState(saveMondayAction, INITIAL);
  const [mapState, mapAction, mapping] = useActionState(saveMondayMappingAction, INITIAL);
  const [testState, testAction, testing] = useActionState(testConnectionAction, INITIAL);
  const [, deleteAction, deleting] = useActionState(deleteConnectionAction, INITIAL);

  const config = parseMondayConfig(connection?.config);
  const [boards, setBoards] = useState<Array<{ id: string; name: string }>>([]);
  const [groups, setGroups] = useState<Array<{ id: string; title: string }>>([]);
  const [fields, setFields] = useState<CrmField[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const id = connection?.id;
  const boardId = config.boardId;

  // Boards are fetched once a token is stored, and the columns once a board
  // is chosen — both from Monday, because neither can be guessed.
  useEffect(() => {
    if (!id || !connection?.hasCredential) return;
    startLoading(async () => {
      const noGroups: { groups: Array<{ id: string; title: string }>; error?: string } = { groups: [] };
      const noFields: { fields: CrmField[]; error?: string } = { fields: [] };
      const [b, g, f] = await Promise.all([
        loadMondayBoards(id),
        boardId ? loadMondayGroups(id) : Promise.resolve(noGroups),
        boardId ? loadMondayFields(id) : Promise.resolve(noFields),
      ]);
      setBoards(b.boards);
      setGroups(g.groups);
      setFields(f.fields);
      setLoadError(b.error ?? f.error ?? null);
    });
  }, [id, boardId, connection?.hasCredential]);

  return (
    <section className="rounded-xl border border-border p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Monday.com</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Leads land as items on a board you choose, with the report PDF attached.
          </p>
        </div>
        <StatusBadge status={connection?.status ?? null} />
      </header>

      {connection?.lastError ? (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {connection.lastError}
        </p>
      ) : null}

      <form action={saveAction} className="mt-4 space-y-3">
        <input type="hidden" name="id" value={connection?.id ?? ""} />
        <label className="block">
          <span className="text-xs font-medium text-foreground">API token</span>
          <input
            name="token"
            type="password"
            autoComplete="off"
            placeholder={connection?.hasCredential ? "••••••••  (stored — leave blank to keep it)" : "Paste your Monday API token"}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            In Monday: your avatar → Developers → My access tokens. It is encrypted before it is stored, and we
            never show it back to you.
          </span>
        </label>

        {connection?.hasCredential ? (
          <>
            <label className="block">
              <span className="text-xs font-medium text-foreground">Board</span>
              <select
                name="boardId"
                defaultValue={config.boardId ?? ""}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">{loading ? "Loading your boards…" : "Choose a board"}</option>
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>

            {groups.length > 0 ? (
              <label className="block">
                <span className="text-xs font-medium text-foreground">Group</span>
                <select
                  name="groupId"
                  defaultValue={config.groupId ?? ""}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Top of the board</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-foreground">Label for a qualified lead</span>
                <input
                  name="labelYes"
                  defaultValue={config.qualifiedLabels.yes}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-foreground">…and one that missed your rules</span>
                <input
                  name="labelNo"
                  defaultValue={config.qualifiedLabels.no}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
            </div>
          </>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : connection ? "Save" : "Connect Monday"}
          </button>
        </div>
        <Feedback state={saveState} />
      </form>

      {connection?.hasCredential && boardId ? (
        <form action={mapAction} className="mt-6 border-t border-border pt-5">
          <input type="hidden" name="id" value={connection.id} />
          <h3 className="text-sm font-semibold text-foreground">Which of your columns gets what</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Read live from your board. Anything you leave unmapped is simply not sent — the rest of the lead
            still arrives.
          </p>
          {loadError ? (
            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">{loadError}</p>
          ) : null}

          <div className="mt-3 space-y-2">
            {MONDAY_FIELDS.map((f) => {
              const current = config.columns[f.id];
              const options = f.id === "file"
                ? fields.filter((c) => c.type === "file")
                : fields.filter((c) => c.type !== "file");
              return (
                <div key={f.id} className="grid grid-cols-[1fr_1.2fr] items-center gap-3">
                  <div>
                    <span className="text-xs font-medium text-foreground">{f.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{f.hint}</span>
                  </div>
                  <select
                    name={`col_${f.id}`}
                    defaultValue={current ? `${current.id}|${current.type}` : ""}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  >
                    <option value="">Don&apos;t send this</option>
                    {options.map((c) => (
                      // The type rides along with the id: Monday's accepted
                      // value shape depends on it, and the wrong shape fails
                      // the entire push rather than the one column.
                      <option key={c.id} value={`${c.id}|${c.type}`}>
                        {c.title} ({c.type})
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <button
            type="submit"
            disabled={mapping || fields.length === 0}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {mapping ? "Saving…" : "Save mapping"}
          </button>
          <Feedback state={mapState} />
        </form>
      ) : null}

      {connection ? (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <form action={testAction}>
            <input type="hidden" name="id" value={connection.id} />
            <button
              type="submit"
              disabled={testing}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
          </form>
          <form action={deleteAction}>
            <input type="hidden" name="id" value={connection.id} />
            <button
              type="submit"
              disabled={deleting}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
            >
              Disconnect
            </button>
          </form>
          <Feedback state={testState} />
        </div>
      ) : null}

      {connection && connection.blockers.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {connection.blockers.map((b) => (
            <li key={b}>• {b}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function StatusBadge({ status }: { status: "unverified" | "ok" | "error" | null }) {
  if (status === null) return null;
  const map = {
    ok: { text: "Connected", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
    error: { text: "Needs attention", cls: "bg-destructive/15 text-destructive" },
    unverified: { text: "Not tested", cls: "bg-muted text-muted-foreground" },
  }[status];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${map.cls}`}>{map.text}</span>;
}

export function Feedback({ state }: { state: CrmState }) {
  if (state.error) {
    return <p className="mt-2 w-full rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">{state.error}</p>;
  }
  if (state.notice) {
    return <p className="mt-2 w-full rounded-md border border-border bg-muted p-3 text-xs text-foreground">{state.notice}</p>;
  }
  return null;
}
