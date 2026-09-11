'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { mintExtensionTokenAction, revokeExtensionTokenAction, type MintResult } from './actions';
import type { ExtensionTokenRow } from '@/lib/extension/tokens';

const initial: MintResult = { token: null, error: null };

type ChromeRuntime = { sendMessage?: (extensionId: string, message: unknown, cb?: (response: unknown) => void) => void; lastError?: { message?: string } };

/** Tries to hand the token to the installed extension; resolves false when it is not there. */
function handToExtension(extensionId: string, token: string, site: string): Promise<boolean> {
  return new Promise((resolve) => {
    const runtime = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
    if (!runtime?.sendMessage) return resolve(false);
    try {
      runtime.sendMessage(extensionId, { type: 'stayful.connect', token, site }, (response) => {
        if (runtime.lastError) return resolve(false);
        resolve(Boolean((response as { ok?: boolean } | undefined)?.ok));
      });
    } catch {
      resolve(false);
    }
    setTimeout(() => resolve(false), 2500);
  });
}

export function ConnectClient({ extensionId, tokens }: { extensionId: string | null; tokens: ExtensionTokenRow[] }) {
  const [state, action, pending] = useActionState(mintExtensionTokenAction, initial);
  // The hand-over result for the token it was attempted with; a token with
  // no result yet is "trying", and without an extension id it is always manual.
  const [handover, setHandover] = useState<{ token: string; ok: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, startRevoke] = useTransition();
  const handed: 'idle' | 'trying' | 'done' | 'manual' = !state.token ? 'idle' : !extensionId ? 'manual' : handover?.token !== state.token ? 'trying' : handover.ok ? 'done' : 'manual';

  useEffect(() => {
    if (!state.token || !extensionId) return;
    const token = state.token;
    let cancelled = false;
    void handToExtension(extensionId, token, window.location.origin).then((ok) => {
      if (!cancelled) setHandover({ token, ok });
    });
    return () => {
      cancelled = true;
    };
  }, [state.token, extensionId]);

  const copy = async () => {
    if (!state.token) return;
    try {
      await navigator.clipboard.writeText(state.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-6 space-y-6">
      <form action={action} className="rounded-2xl border border-[#e4e7dc] bg-white p-5">
        <label className="block text-sm font-medium">
          Name this connection
          <input name="label" defaultValue="Chrome" maxLength={80} className="mt-1 w-full rounded-lg border border-[#e4e7dc] px-3 py-2 text-sm" />
        </label>
        <button type="submit" disabled={pending} className="mt-4 rounded-full bg-[#5d8156] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? 'Creating…' : 'Create a connection token'}
        </button>
        {state.error && <p className="mt-3 text-sm text-[#b3261e]">{state.error}</p>}
        {state.token && handed === 'trying' && <p className="mt-3 text-sm text-[#7a8274]">Handing the token to the extension…</p>}
        {state.token && handed === 'done' && <p className="mt-3 text-sm font-medium text-[#5d8156]">Connected. Open any listing page to see the Stayful panel.</p>}
        {state.token && handed === 'manual' && (
          <div className="mt-4 rounded-lg bg-[#f7f8f4] p-3">
            <p className="text-sm">Copy this token and paste it into the extension popup (click the Stayful icon in your toolbar). It is shown once.</p>
            <code className="mt-2 block break-all rounded border border-[#e4e7dc] bg-white p-2 text-xs">{state.token}</code>
            <button type="button" onClick={copy} className="mt-2 rounded-full border border-[#5d8156] px-4 py-1.5 text-xs font-semibold text-[#5d8156]">
              {copied ? 'Copied' : 'Copy token'}
            </button>
          </div>
        )}
      </form>

      <section className="rounded-2xl border border-[#e4e7dc] bg-white p-5">
        <h2 className="text-base font-bold">Connected browsers</h2>
        {tokens.length === 0 ? (
          <p className="mt-2 text-sm text-[#7a8274]">No connections yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[#e4e7dc]">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{t.label ?? 'Extension'}</p>
                  <p className="text-xs text-[#7a8274]">
                    Connected {new Date(t.createdAt).toLocaleDateString('en-GB')}
                    {t.lastUsedAt ? ` · last used ${new Date(t.lastUsedAt).toLocaleDateString('en-GB')}` : ' · not used yet'}
                  </p>
                </div>
                <button type="button" disabled={revoking} onClick={() => startRevoke(() => revokeExtensionTokenAction(t.id))} className="rounded-full border border-[#e4e7dc] px-3 py-1 text-xs font-semibold text-[#2e3d2b] disabled:opacity-60">
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
