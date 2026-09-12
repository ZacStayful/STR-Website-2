/**
 * Service worker: keeps the connection token, talks to the Stayful API on
 * behalf of the content script and popup (so page origins never see the
 * token), and accepts the token handed over by /extension/connect.
 */
import { normaliseSite, type CheckResponse, type CheckResult, type Message, type MeResponse, type Reply, type Settings, type StatusResult } from './shared.ts';

const MAX_HTML = 3 * 1024 * 1024;

async function settings(): Promise<Settings> {
  const s = (await chrome.storage.local.get(['token', 'site'])) as Partial<Settings>;
  return { token: typeof s.token === 'string' && s.token ? s.token : null, site: normaliseSite(s.site) };
}

async function api<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; token?: string | null; site?: string } = {}): Promise<{ status: number; data: T }> {
  const s = await settings();
  const token = init.token ?? s.token;
  const site = init.site ?? s.site;
  const res = await fetch(`${site}${path}`, {
    method: init.method ?? 'GET',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  // A non-JSON answer is the platform, not the API: a gateway timeout page, a proxy error.
  const data = (await res.json().catch(() => ({ error: `Stayful is not responding right now (HTTP ${res.status}). Please try again.`, code: 'no_answer' }))) as T;
  return { status: res.status, data };
}

const GATEWAY_TIMEOUT = 'Stayful took too long reading that listing. Please try again in a moment.';

async function status(): Promise<StatusResult> {
  const s = await settings();
  if (!s.token) return { connected: false, site: s.site };
  const { status, data } = await api<MeResponse | { error: string }>('/api/ext/me');
  if (status === 401) {
    await chrome.storage.local.remove('token');
    return { connected: false, site: s.site };
  }
  // Anything but a real answer (5xx, maintenance page, proxy error) is a
  // transient problem to retry, never "your plan does not include this".
  if (status !== 200 || !('state' in data)) return { connected: true, site: s.site, me: null, error: ('error' in data && data.error) || `Stayful returned ${status}.` };
  return { connected: true, site: s.site, me: data };
}

async function check(url: string, html: string, save: boolean): Promise<CheckResult> {
  const s = await settings();
  if (!s.token) return { ok: false, status: 401, error: { error: 'Not connected.', code: 'not_connected' } };
  const { status, data } = await api<CheckResponse & { error?: string; code?: string; reason?: string; upgradeUrl?: string }>('/api/ext/check', {
    method: 'POST',
    body: { url, html: html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html, save },
  });
  if (status === 401) await chrome.storage.local.remove('token');
  if (data.code === 'no_answer' && (status === 504 || status === 502)) return { ok: false, status, error: { error: GATEWAY_TIMEOUT, code: data.code } };
  if (status !== 200 || data.error) return { ok: false, status, error: { error: data.error ?? `Stayful returned ${status}.`, code: data.code, reason: data.reason, upgradeUrl: data.upgradeUrl } };
  return { ok: true, data };
}

async function setToken(token: string, site: string | undefined): Promise<{ ok: boolean; error?: string }> {
  const cleanSite = normaliseSite(site ?? (await settings()).site);
  const { status, data } = await api<MeResponse | { error?: string }>('/api/ext/me', { token, site: cleanSite });
  if (status !== 200) return { ok: false, error: (data as { error?: string }).error ?? 'That token was not accepted.' };
  await chrome.storage.local.set({ token, site: cleanSite });
  return { ok: true };
}

async function disconnect(): Promise<{ ok: boolean }> {
  const s = await settings();
  if (s.token) await api('/api/ext/disconnect', { method: 'POST', body: {} }).catch(() => null);
  await chrome.storage.local.remove('token');
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse: (r: Reply) => void) => {
  (async () => {
    switch (message.type) {
      case 'status':
        return sendResponse(await status());
      case 'check':
        return sendResponse(await check(message.url, message.html, message.save !== false));
      case 'setToken':
        return sendResponse(await setToken(message.token, message.site));
      case 'disconnect':
        return sendResponse(await disconnect());
    }
  })().catch((err) => sendResponse({ ok: false, error: (err as Error).message }));
  return true; // async response
});

/**
 * /extension/connect hands the freshly minted token straight over. Chrome
 * only delivers these messages from pages listed under externally_connectable
 * in the manifest (the Stayful site, plus localhost in --dev builds), so the
 * sender's origin is trusted as the site to talk to; the token is still
 * verified against that site before it is stored.
 */
chrome.runtime.onMessageExternal.addListener((message: { type?: string; token?: string; site?: string }, sender, sendResponse: (r: { ok: boolean; error?: string }) => void) => {
  (async () => {
    if (message?.type !== 'stayful.connect' || typeof message.token !== 'string') return sendResponse({ ok: false, error: 'Unknown message.' });
    let origin: string;
    try {
      origin = new URL(sender.url ?? '').origin;
    } catch {
      return sendResponse({ ok: false, error: 'Unexpected sender.' });
    }
    if (!/^https?:$/.test(new URL(origin).protocol)) return sendResponse({ ok: false, error: 'Unexpected sender.' });
    sendResponse(await setToken(message.token, origin));
  })().catch((err) => sendResponse({ ok: false, error: (err as Error).message }));
  return true;
});
