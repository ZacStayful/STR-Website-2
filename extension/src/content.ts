/**
 * Content script: on a listing page, mounts a small Stayful bar (in a shadow
 * root so site CSS cannot touch it). Nothing is sent anywhere until the
 * member clicks Check; the page HTML then goes to the service worker, which
 * calls the Stayful API, and the bar expands into the quick-view panel.
 * Single-page sites (Airbnb) change the URL without reloading, so the bar
 * follows the current listing id.
 */
import { detectListingUrl, SOURCE_LABELS } from '../../src/lib/listing/detect.ts';
import { formatListingPrice } from '../../src/lib/listing/format.ts';
import { esc, send, type CheckResponse, type CheckResult, type StatusResult } from './shared.ts';

const HOST_ID = 'stayful-intelligence-root';

const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .bar { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 340px; max-width: calc(100vw - 32px); background: #fff; color: #2e3d2b; border: 1px solid #e4e7dc; border-radius: 14px; box-shadow: 0 12px 32px rgba(46,61,43,.18); font-size: 13px; line-height: 1.4; overflow: hidden; }
  .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #f7f8f4; border-bottom: 1px solid #e4e7dc; }
  .logo { width: 22px; height: 22px; border-radius: 6px; background: #5d8156; color: #fff; font-weight: 800; font-size: 13px; display: grid; place-items: center; }
  .brand { font-weight: 700; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: #5d8156; }
  .spacer { flex: 1; }
  .x { border: 0; background: transparent; color: #7a8274; font-size: 16px; cursor: pointer; padding: 0 4px; }
  .body { padding: 12px; }
  .title { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { color: #7a8274; font-size: 12px; margin-top: 2px; }
  .cta { display: inline-block; margin-top: 10px; border: 0; border-radius: 999px; background: #5d8156; color: #fff; font-weight: 600; font-size: 13px; padding: 8px 14px; cursor: pointer; text-decoration: none; }
  .cta.secondary { background: #fff; color: #2e3d2b; border: 1px solid #e4e7dc; }
  .cta[disabled] { opacity: .6; cursor: default; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
  .tile { background: #f7f8f4; border-radius: 10px; padding: 8px 10px; }
  .tile .k { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #7a8274; }
  .tile .v { font-weight: 700; font-size: 15px; margin-top: 2px; }
  .tile .s { font-size: 11px; color: #7a8274; margin-top: 1px; }
  .deal { margin-top: 10px; padding: 8px 10px; border-radius: 10px; border: 1px solid #e4e7dc; font-size: 12px; }
  .deal strong { color: #5d8156; }
  .note { margin-top: 8px; font-size: 11px; color: #7a8274; }
  .err { margin-top: 8px; font-size: 12px; color: #b3261e; }
  .lock { margin-top: 8px; font-size: 12px; }
  a.link { color: #5d8156; text-decoration: underline; }
`;

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'result'; data: CheckResponse }
  | { kind: 'error'; message: string; code?: string; upgradeUrl?: string }
  | {
      kind: 'locked';
      site: string;
      reason: 'not_connected' | 'no_access';
      // Supplied by the server for the no_access case. A paused member needs a
      // different message and a different destination from someone who never
      // subscribed — sending them to checkout would start a second
      // subscription. Falls back to the generic upgrade copy when absent.
      message?: string;
      href?: string;
      cta?: string;
    };

let currentUrl = '';
let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
/** The listing the member dismissed the bar on; it stays closed until they open a different listing. */
let closedFor: string | null = null;

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

function mount(): ShadowRoot {
  if (root && host?.isConnected) return root;
  host = document.createElement('div');
  host.id = HOST_ID;
  // Open so tests can reach the bar; site CSS cannot cross the boundary either way.
  root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);
  document.documentElement.appendChild(host);
  return root;
}

function unmount() {
  host?.remove();
  host = null;
  root = null;
}

function header(): string {
  return `<div class="head"><span class="logo">S</span><span class="brand">Stayful</span><span class="spacer"></span><button class="x" data-act="close" aria-label="Close">×</button></div>`;
}

function tile(k: string, v: string, s?: string): string {
  return `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`;
}

function resultHtml(site: string, r: CheckResponse): string {
  const snap = r.snapshot;
  const q = r.quick;
  const est = q.estimate;
  const area = q.area;
  const price = snap.price ? formatListingPrice(snap.price) : null;
  const meta = [price, snap.bedrooms !== undefined ? `${snap.bedrooms} bed` : null, snap.displayAddress ?? snap.postcode ?? null].filter(Boolean).join(' · ');

  const tiles: string[] = [];
  if (snap.source === 'booking') {
    const nightly = snap.price?.period === 'night' ? snap.price.amount : null;
    const areaAdr = est?.adr ?? q.pmiMarket?.adr ?? null;
    const diff = nightly && areaAdr ? Math.round(((nightly - areaAdr) / areaAdr) * 100) : null;
    tiles.push(tile('Rate benchmark', nightly ? `${gbp(nightly)} / night` : '—', areaAdr ? `Area average ${gbp(areaAdr)}${diff !== null ? ` (${diff > 0 ? '+' : ''}${diff}%)` : ''}` : 'No area rate yet'));
  } else {
    tiles.push(tile('Est. revenue / yr', est ? gbp(est.grossRevenue) : '—', est ? `${est.adr ? `${gbp(est.adr)} / night` : ''}${est.occupancy !== null ? ` · ${Math.round(est.occupancy)}% occ.` : ''}` : 'No area data yet'));
  }
  tiles.push(tile('Area score', area?.score !== null && area?.score !== undefined ? `${area.score} · ${area.grade ?? ''}` : '—', area ? `${area.name}${area.competition ? ` · ${area.competition.label} competition` : ''}` : undefined));
  if (snap.source === 'airbnb') {
    tiles.push(q.tracked ? tile('This listing earns', gbp(q.tracked.annualRevenue), `${gbp(q.tracked.adr)} / night · ${Math.round(q.tracked.occupancy * 100)}% · ${q.tracked.reviewCount} reviews`) : tile('This listing', 'Not tracked', 'Estimate uses the area figure'));
  } else if (area?.trend) {
    tiles.push(tile('Trend', area.trend.label, area.directBooking ? `${area.directBooking.label} direct-booking potential` : undefined));
  }
  tiles.push(tile('Licensing', area?.licensing.status === 'confirmed-licensed' ? 'Licence required' : area?.licensing.status === 'confirmed-unrestricted' ? 'No licence today' : 'Unconfirmed', area?.licensing.headline));

  let deal = '';
  const d = q.deal;
  if (d?.kind === 'purchase') deal = `<div class="deal">At ${gbp(d.askingPrice)}: <strong>${d.grossYieldPct.toFixed(1)}% gross yield</strong> · ${gbp(d.cashflowMonthly)}/mo after mortgage · max price for ${d.targetYieldPct}%: ${gbp(d.maxPriceForTargetYield)}</div>`;
  if (d?.kind === 'rent-to-rent') deal = `<div class="deal">Rent-to-rent at ${gbp(d.advertisedRentPcm)} pcm: <strong>${gbp(d.monthlyMargin)}/mo margin</strong>${d.breakevenOccupancyPct !== null ? ` · breakeven ${Math.round(d.breakevenOccupancyPct)}% occupancy` : ''}</div>`;

  const report = `${site}/estimate?listing=${encodeURIComponent(snap.canonicalUrl)}`;
  const explorer = r.checkedListingId ? `${site}/markets?pane=listings&listing=${encodeURIComponent(r.checkedListingId)}` : `${site}/markets?check=${encodeURIComponent(snap.canonicalUrl)}`;
  return `${header()}<div class="body">
    <div class="title">${esc(snap.title)}</div>
    <div class="meta">${esc(meta)}</div>
    <div class="tiles">${tiles.join('')}</div>
    ${deal}
    <div class="row">
      <a class="cta" href="${esc(report)}" target="_blank" rel="noopener">Full report</a>
      <a class="cta secondary" href="${esc(explorer)}" target="_blank" rel="noopener">Open in explorer</a>
    </div>
    <div class="note">${r.checkedListingId ? 'Saved to your pipeline. ' : ''}${q.limited ? 'Some lookups are paused for today. ' : ''}${est ? esc(est.note) : ''}</div>
  </div>`;
}

function render(state: State, site: string) {
  if (closedFor === currentUrl) return;
  const r = mount();
  let body = '';
  const source = detectListingUrl(currentUrl)?.source;
  const label = source ? SOURCE_LABELS[source] : 'this site';
  switch (state.kind) {
    case 'idle':
      body = `${header()}<div class="body"><div class="title">What would this earn as a short-term let?</div><div class="meta">Free quick view for members · no report used</div><button class="cta" data-act="check">Check this ${esc(label)} listing</button></div>`;
      break;
    case 'busy':
      body = `${header()}<div class="body"><div class="title">Reading the listing…</div><div class="meta">Estimating revenue and running the deal maths.</div><button class="cta" disabled>Checking…</button></div>`;
      break;
    case 'result':
      body = resultHtml(site, state.data);
      break;
    case 'error':
      body = `${header()}<div class="body"><div class="title">Could not check this listing</div><div class="err">${esc(state.message)}</div>${state.upgradeUrl ? `<a class="cta" href="${esc(site + state.upgradeUrl)}" target="_blank" rel="noopener">Upgrade</a>` : `<button class="cta secondary" data-act="${state.code === 'status' ? 'retry' : 'check'}">Try again</button>`}</div>`;
      break;
    case 'locked':
      body =
        state.reason === 'not_connected'
          ? `${header()}<div class="body"><div class="title">See what this would earn as a short-term let</div><div class="lock">Estimated revenue, area score and deal maths for every listing you open. Connect the extension to your Stayful account to unlock it.</div><a class="cta" href="${esc(site)}/extension/connect" target="_blank" rel="noopener">Connect Stayful</a></div>`
          : `${header()}<div class="body"><div class="title">${esc(state.message ?? 'Your plan does not include listing checks')}</div><div class="lock">${esc(state.message ? 'Open your Stayful account to sort it out.' : 'Upgrade to see revenue estimates and deal maths on every listing.')}</div><a class="cta" href="${esc(site + (state.href ?? '/upgrade'))}" target="_blank" rel="noopener">${esc(state.cta ?? 'Upgrade')}</a></div>`;
      break;
  }
  let bar = r.querySelector('.bar') as HTMLElement | null;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'bar';
    r.appendChild(bar);
    bar.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      if (t.dataset.act === 'close') {
        closedFor = currentUrl;
        unmount();
      }
      if (t.dataset.act === 'check') void runCheck();
      if (t.dataset.act === 'retry') void start(true);
    });
  }
  bar.innerHTML = body;
}

let site = 'https://intelligence.stayful.co.uk';

async function runCheck() {
  render({ kind: 'busy' }, site);
  try {
    const res = await send<CheckResult>({ type: 'check', url: currentUrl, html: document.documentElement.outerHTML });
    if (res.ok) render({ kind: 'result', data: res.data }, site);
    else if (res.error.code === 'not_connected') render({ kind: 'locked', site, reason: 'not_connected' }, site);
    else if (res.error.code === 'no_access')
      render(
        {
          kind: 'locked',
          site,
          reason: 'no_access',
          message: res.error.reason === 'paused' ? res.error.error : undefined,
          href: res.error.reason === 'paused' ? res.error.upgradeUrl : undefined,
          cta: res.error.reason === 'paused' ? 'Restart my plan' : undefined,
        },
        site,
      );
    else render({ kind: 'error', message: res.error.error, code: res.error.code, upgradeUrl: res.error.upgradeUrl }, site);
  } catch (err) {
    render({ kind: 'error', message: (err as Error).message || 'Could not reach Stayful.' }, site);
  }
}

async function start(force = false) {
  const detected = detectListingUrl(location.href);
  if (!detected) {
    unmount();
    return;
  }
  // Same listing (date pickers and the like only change the query string): leave the bar as it is.
  if (!force && detected.canonicalUrl === currentUrl) return;
  currentUrl = detected.canonicalUrl;
  if (closedFor === currentUrl) return;
  try {
    const st = await send<StatusResult>({ type: 'status' });
    site = st.site;
    if (!st.connected) render({ kind: 'locked', site, reason: 'not_connected' }, site);
    else if (st.me === null) render({ kind: 'error', message: st.error, code: 'status' }, site);
    else if (st.me.state !== 'ok') render({ kind: 'locked', site, reason: 'no_access' }, site);
    else render({ kind: 'idle' }, site);
  } catch (err) {
    render({ kind: 'error', message: (err as Error).message || 'Could not reach the extension.', code: 'status' }, site);
  }
}

void start();
// Single-page navigation (Airbnb keeps the tab open and swaps the listing).
let lastHref = location.href;
setInterval(() => {
  if (location.href === lastHref) return;
  lastHref = location.href;
  void start();
}, 1000);
