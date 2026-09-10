/** Toolbar popup: connection status, manual token entry, disconnect. */
import { DEFAULT_SITE, type StatusResult } from './shared.ts';

const app = document.getElementById('app') as HTMLElement;
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function send<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

function connectedView(st: Extract<StatusResult, { connected: true }>): string {
  const me = st.me;
  const plan = me.plan === 'pro' ? 'Pro' : me.runsRemaining !== null ? `Trial · ${me.runsRemaining} free report${me.runsRemaining === 1 ? '' : 's'} left` : 'Member';
  return `
    <p><strong>Connected</strong>${me.email ? ` as ${esc(me.email)}` : ''}</p>
    <p class="muted">${esc(plan)}${me.state !== 'ok' ? ' · your plan does not include listing checks' : ''}</p>
    <p class="muted">Open a Rightmove, Zoopla, OnTheMarket, Airbnb or Booking.com listing and click <em>Check</em> in the Stayful bar.</p>
    <a class="cta" href="${esc(st.site)}/markets?pane=listings" target="_blank" rel="noopener">Open my pipeline</a>
    <button class="cta secondary" id="disconnect">Disconnect</button>`;
}

function disconnectedView(site: string): string {
  return `
    <p><strong>Not connected</strong></p>
    <p class="muted">Connect the extension to your Stayful account to see revenue estimates on listing pages.</p>
    <a class="cta" href="${esc(site)}/extension/connect" target="_blank" rel="noopener">Connect on Stayful</a>
    <label>Or paste a connection token<input id="token" type="password" placeholder="sfx_…" autocomplete="off" /></label>
    <details><summary>Advanced</summary><label>Stayful site<input id="site" value="${esc(site)}" /></label></details>
    <button class="cta" id="save">Save token</button>
    <div id="msg"></div>`;
}

async function render() {
  let st: StatusResult;
  try {
    st = await send<StatusResult>({ type: 'status' });
  } catch (err) {
    app.innerHTML = `<p class="err">${esc((err as Error).message)}</p>`;
    return;
  }
  app.innerHTML = st.connected ? connectedView(st) : disconnectedView(st.site || DEFAULT_SITE);
  document.getElementById('disconnect')?.addEventListener('click', async () => {
    await send({ type: 'disconnect' });
    void render();
  });
  document.getElementById('save')?.addEventListener('click', async () => {
    const token = (document.getElementById('token') as HTMLInputElement).value.trim();
    const site = (document.getElementById('site') as HTMLInputElement).value.trim();
    const msg = document.getElementById('msg') as HTMLElement;
    if (!token) {
      msg.innerHTML = '<p class="err">Paste the token from the connect page first.</p>';
      return;
    }
    const res = await send<{ ok: boolean; error?: string }>({ type: 'setToken', token, site });
    if (res.ok) void render();
    else msg.innerHTML = `<p class="err">${esc(res.error ?? 'That token was not accepted.')}</p>`;
  });
}

void render();
