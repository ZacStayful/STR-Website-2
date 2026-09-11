"use strict";
(() => {
  // src/lib/listing/detect.ts
  var PATTERNS = [
    {
      source: "rightmove",
      host: /(^|\.)rightmove\.co\.uk$/i,
      path: /^\/properties\/(\d+)(?:[/#?]|$)/i,
      canonical: (id) => `https://www.rightmove.co.uk/properties/${id}`
    },
    {
      source: "onthemarket",
      host: /(^|\.)onthemarket\.com$/i,
      path: /^\/details\/(\d+)(?:[/#?]|$)/i,
      canonical: (id) => `https://www.onthemarket.com/details/${id}/`
    },
    {
      source: "zoopla",
      host: /(^|\.)zoopla\.co\.uk$/i,
      path: /^\/(?:for-sale|to-rent|new-homes)\/details\/(\d+)(?:[/#?]|$)/i,
      canonical: (id) => `https://www.zoopla.co.uk/for-sale/details/${id}/`
    },
    {
      source: "airbnb",
      host: /(^|\.)airbnb\.(?:co\.uk|com|ie|fr|de|es|it|nl|com\.au|ca)$/i,
      path: /^\/rooms\/(?:plus\/)?(\d+)(?:[/#?]|$)/i,
      canonical: (id) => `https://www.airbnb.co.uk/rooms/${id}`
    },
    {
      source: "booking",
      host: /(^|\.)booking\.com$/i,
      path: /^\/hotel\/([a-z]{2}\/[a-z0-9-]+)(?:\.[a-z-]+)?\.html(?:[/#?]|$)/i,
      canonical: (id) => `https://www.booking.com/hotel/${id}.html`
    }
  ];
  function detectListingUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host2 = url.hostname.toLowerCase();
    for (const p of PATTERNS) {
      if (!p.host.test(host2)) continue;
      const m = url.pathname.match(p.path);
      if (!m) return null;
      const id = m[1].toLowerCase();
      return { source: p.source, id, canonicalUrl: p.canonical(id) };
    }
    return null;
  }
  var SOURCE_LABELS = {
    rightmove: "Rightmove",
    onthemarket: "OnTheMarket",
    zoopla: "Zoopla",
    airbnb: "Airbnb",
    booking: "Booking.com"
  };

  // src/lib/listing/format.ts
  function formatListingPrice(price, compact = false) {
    if (!price) return "\u2014";
    const amount = compact && price.amount >= 1e3 ? `\xA3${(price.amount / 1e3).toFixed(price.amount >= 1e5 ? 0 : 1).replace(/\.0$/, "")}k` : `\xA3${Math.round(price.amount).toLocaleString("en-GB")}`;
    const suffix = price.period === "pcm" ? " pcm" : price.period === "pw" ? " pw" : price.period === "night" ? " / night" : "";
    return `${amount}${suffix}`;
  }

  // extension/src/shared.ts
  function esc(v) {
    return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  }

  // extension/src/content.ts
  var HOST_ID = "stayful-intelligence-root";
  var CSS = `
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
  var currentUrl = "";
  var host = null;
  var root = null;
  var closedFor = null;
  var gbp = (n) => `\xA3${Math.round(n).toLocaleString("en-GB")}`;
  function mount() {
    if (root && host?.isConnected) return root;
    host = document.createElement("div");
    host.id = HOST_ID;
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
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
  function header() {
    return `<div class="head"><span class="logo">S</span><span class="brand">Stayful</span><span class="spacer"></span><button class="x" data-act="close" aria-label="Close">\xD7</button></div>`;
  }
  function tile(k, v, s) {
    return `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${s ? `<div class="s">${esc(s)}</div>` : ""}</div>`;
  }
  function resultHtml(site2, r) {
    const snap = r.snapshot;
    const q = r.quick;
    const est = q.estimate;
    const area = q.area;
    const price = snap.price ? formatListingPrice(snap.price) : null;
    const meta = [price, snap.bedrooms !== void 0 ? `${snap.bedrooms} bed` : null, snap.displayAddress ?? snap.postcode ?? null].filter(Boolean).join(" \xB7 ");
    const tiles = [];
    if (snap.source === "booking") {
      const nightly = snap.price?.period === "night" ? snap.price.amount : null;
      const areaAdr = est?.adr ?? q.pmiMarket?.adr ?? null;
      const diff = nightly && areaAdr ? Math.round((nightly - areaAdr) / areaAdr * 100) : null;
      tiles.push(tile("Rate benchmark", nightly ? `${gbp(nightly)} / night` : "\u2014", areaAdr ? `Area average ${gbp(areaAdr)}${diff !== null ? ` (${diff > 0 ? "+" : ""}${diff}%)` : ""}` : "No area rate yet"));
    } else {
      tiles.push(tile("Est. revenue / yr", est ? gbp(est.grossRevenue) : "\u2014", est ? `${est.adr ? `${gbp(est.adr)} / night` : ""}${est.occupancy !== null ? ` \xB7 ${Math.round(est.occupancy)}% occ.` : ""}` : "No area data yet"));
    }
    tiles.push(tile("Area score", area?.score !== null && area?.score !== void 0 ? `${area.score} \xB7 ${area.grade ?? ""}` : "\u2014", area ? `${area.name}${area.competition ? ` \xB7 ${area.competition.label} competition` : ""}` : void 0));
    if (snap.source === "airbnb") {
      tiles.push(q.tracked ? tile("This listing earns", gbp(q.tracked.annualRevenue), `${gbp(q.tracked.adr)} / night \xB7 ${Math.round(q.tracked.occupancy * 100)}% \xB7 ${q.tracked.reviewCount} reviews`) : tile("This listing", "Not tracked", "Estimate uses the area figure"));
    } else if (area?.trend) {
      tiles.push(tile("Trend", area.trend.label, area.directBooking ? `${area.directBooking.label} direct-booking potential` : void 0));
    }
    tiles.push(tile("Licensing", area?.licensing.status === "confirmed-licensed" ? "Licence required" : area?.licensing.status === "confirmed-unrestricted" ? "No licence today" : "Unconfirmed", area?.licensing.headline));
    let deal = "";
    const d = q.deal;
    if (d?.kind === "purchase") deal = `<div class="deal">At ${gbp(d.askingPrice)}: <strong>${d.grossYieldPct.toFixed(1)}% gross yield</strong> \xB7 ${gbp(d.cashflowMonthly)}/mo after mortgage \xB7 max price for ${d.targetYieldPct}%: ${gbp(d.maxPriceForTargetYield)}</div>`;
    if (d?.kind === "rent-to-rent") deal = `<div class="deal">Rent-to-rent at ${gbp(d.advertisedRentPcm)} pcm: <strong>${gbp(d.monthlyMargin)}/mo margin</strong>${d.breakevenOccupancyPct !== null ? ` \xB7 breakeven ${Math.round(d.breakevenOccupancyPct)}% occupancy` : ""}</div>`;
    const report = `${site2}/estimate?listing=${encodeURIComponent(snap.canonicalUrl)}`;
    const explorer = r.checkedListingId ? `${site2}/markets?pane=listings&listing=${encodeURIComponent(r.checkedListingId)}` : `${site2}/markets?check=${encodeURIComponent(snap.canonicalUrl)}`;
    return `${header()}<div class="body">
    <div class="title">${esc(snap.title)}</div>
    <div class="meta">${esc(meta)}</div>
    <div class="tiles">${tiles.join("")}</div>
    ${deal}
    <div class="row">
      <a class="cta" href="${esc(report)}" target="_blank" rel="noopener">Full report</a>
      <a class="cta secondary" href="${esc(explorer)}" target="_blank" rel="noopener">Open in explorer</a>
    </div>
    <div class="note">${r.checkedListingId ? "Saved to your pipeline. " : ""}${q.limited ? "Some lookups are paused for today. " : ""}${est ? esc(est.note) : ""}</div>
  </div>`;
  }
  function render(state, site2) {
    if (closedFor === currentUrl) return;
    const r = mount();
    let body = "";
    const source = detectListingUrl(currentUrl)?.source;
    const label = source ? SOURCE_LABELS[source] : "this site";
    switch (state.kind) {
      case "idle":
        body = `${header()}<div class="body"><div class="title">What would this earn as a short-term let?</div><div class="meta">Free quick view for members \xB7 no report used</div><button class="cta" data-act="check">Check this ${esc(label)} listing</button></div>`;
        break;
      case "busy":
        body = `${header()}<div class="body"><div class="title">Reading the listing\u2026</div><div class="meta">Estimating revenue and running the deal maths.</div><button class="cta" disabled>Checking\u2026</button></div>`;
        break;
      case "result":
        body = resultHtml(site2, state.data);
        break;
      case "error":
        body = `${header()}<div class="body"><div class="title">Could not check this listing</div><div class="err">${esc(state.message)}</div>${state.upgradeUrl ? `<a class="cta" href="${esc(site2 + state.upgradeUrl)}" target="_blank" rel="noopener">Upgrade</a>` : `<button class="cta secondary" data-act="${state.code === "status" ? "retry" : "check"}">Try again</button>`}</div>`;
        break;
      case "locked":
        body = state.reason === "not_connected" ? `${header()}<div class="body"><div class="title">See what this would earn as a short-term let</div><div class="lock">Estimated revenue, area score and deal maths for every listing you open. Connect the extension to your Stayful account to unlock it.</div><a class="cta" href="${esc(site2)}/extension/connect" target="_blank" rel="noopener">Connect Stayful</a></div>` : `${header()}<div class="body"><div class="title">Your plan does not include listing checks</div><div class="lock">Upgrade to see revenue estimates and deal maths on every listing.</div><a class="cta" href="${esc(site2)}/upgrade" target="_blank" rel="noopener">Upgrade</a></div>`;
        break;
    }
    let bar = r.querySelector(".bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "bar";
      r.appendChild(bar);
      bar.addEventListener("click", (e) => {
        const t = e.target.closest("[data-act]");
        if (!t) return;
        if (t.dataset.act === "close") {
          closedFor = currentUrl;
          unmount();
        }
        if (t.dataset.act === "check") void runCheck();
        if (t.dataset.act === "retry") void start(true);
      });
    }
    bar.innerHTML = body;
  }
  var site = "https://intelligence.stayful.co.uk";
  async function runCheck() {
    render({ kind: "busy" }, site);
    try {
      const res = await send({ type: "check", url: currentUrl, html: document.documentElement.outerHTML });
      if (res.ok) render({ kind: "result", data: res.data }, site);
      else if (res.error.code === "not_connected") render({ kind: "locked", site, reason: "not_connected" }, site);
      else if (res.error.code === "no_access") render({ kind: "locked", site, reason: "no_access" }, site);
      else render({ kind: "error", message: res.error.error, code: res.error.code, upgradeUrl: res.error.upgradeUrl }, site);
    } catch (err) {
      render({ kind: "error", message: err.message || "Could not reach Stayful." }, site);
    }
  }
  async function start(force = false) {
    const detected = detectListingUrl(location.href);
    if (!detected) {
      unmount();
      return;
    }
    if (!force && detected.canonicalUrl === currentUrl) return;
    currentUrl = detected.canonicalUrl;
    if (closedFor === currentUrl) return;
    try {
      const st = await send({ type: "status" });
      site = st.site;
      if (!st.connected) render({ kind: "locked", site, reason: "not_connected" }, site);
      else if (st.me === null) render({ kind: "error", message: st.error, code: "status" }, site);
      else if (st.me.state !== "ok") render({ kind: "locked", site, reason: "no_access" }, site);
      else render({ kind: "idle" }, site);
    } catch (err) {
      render({ kind: "error", message: err.message || "Could not reach the extension.", code: "status" }, site);
    }
  }
  void start();
  var lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    void start();
  }, 1e3);
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL2xpYi9saXN0aW5nL2RldGVjdC50cyIsICIuLi8uLi9zcmMvbGliL2xpc3RpbmcvZm9ybWF0LnRzIiwgIi4uL3NyYy9zaGFyZWQudHMiLCAiLi4vc3JjL2NvbnRlbnQudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB0eXBlIHsgRGV0ZWN0ZWRMaXN0aW5nLCBMaXN0aW5nU291cmNlIH0gZnJvbSAnLi90eXBlcy50cyc7XG5cbi8qKlxuICogUmVjb2duaXNlcyBhIHBhc3RlZCBsaXN0aW5nIFVSTCBhbmQgcmVkdWNlcyBpdCB0byAoc291cmNlLCBpZCwgY2Fub25pY2FsXG4gKiBVUkwpLiBUcmFja2luZyBwYXJhbWV0ZXJzLCBmcmFnbWVudHMgYW5kIHNoYXJlLWxpbmsgZGVjb3JhdGlvbiBhcmUgZHJvcHBlZFxuICogc28gdGhlIHNhbWUgbGlzdGluZyBhbHdheXMgbWFwcyB0byBvbmUgY2Fub25pY2FsIGtleS5cbiAqXG4gKiBSZXR1cm5zIG51bGwgZm9yIGFueXRoaW5nIHRoYXQgaXMgbm90IGEgc3VwcG9ydGVkIGxpc3RpbmcgcGFnZSBcdTIwMTQgc2VhcmNoXG4gKiByZXN1bHQgcGFnZXMsIGFnZW50IHBhZ2VzLCB1bnJlbGF0ZWQgc2l0ZXMuXG4gKi9cblxuY29uc3QgUEFUVEVSTlM6IHsgc291cmNlOiBMaXN0aW5nU291cmNlOyBob3N0OiBSZWdFeHA7IHBhdGg6IFJlZ0V4cDsgY2Fub25pY2FsOiAoaWQ6IHN0cmluZykgPT4gc3RyaW5nIH1bXSA9IFtcbiAge1xuICAgIHNvdXJjZTogJ3JpZ2h0bW92ZScsXG4gICAgaG9zdDogLyhefFxcLilyaWdodG1vdmVcXC5jb1xcLnVrJC9pLFxuICAgIHBhdGg6IC9eXFwvcHJvcGVydGllc1xcLyhcXGQrKSg/OlsvIz9dfCQpL2ksXG4gICAgY2Fub25pY2FsOiAoaWQpID0+IGBodHRwczovL3d3dy5yaWdodG1vdmUuY28udWsvcHJvcGVydGllcy8ke2lkfWAsXG4gIH0sXG4gIHtcbiAgICBzb3VyY2U6ICdvbnRoZW1hcmtldCcsXG4gICAgaG9zdDogLyhefFxcLilvbnRoZW1hcmtldFxcLmNvbSQvaSxcbiAgICBwYXRoOiAvXlxcL2RldGFpbHNcXC8oXFxkKykoPzpbLyM/XXwkKS9pLFxuICAgIGNhbm9uaWNhbDogKGlkKSA9PiBgaHR0cHM6Ly93d3cub250aGVtYXJrZXQuY29tL2RldGFpbHMvJHtpZH0vYCxcbiAgfSxcbiAge1xuICAgIHNvdXJjZTogJ3pvb3BsYScsXG4gICAgaG9zdDogLyhefFxcLil6b29wbGFcXC5jb1xcLnVrJC9pLFxuICAgIHBhdGg6IC9eXFwvKD86Zm9yLXNhbGV8dG8tcmVudHxuZXctaG9tZXMpXFwvZGV0YWlsc1xcLyhcXGQrKSg/OlsvIz9dfCQpL2ksXG4gICAgY2Fub25pY2FsOiAoaWQpID0+IGBodHRwczovL3d3dy56b29wbGEuY28udWsvZm9yLXNhbGUvZGV0YWlscy8ke2lkfS9gLFxuICB9LFxuICB7XG4gICAgc291cmNlOiAnYWlyYm5iJyxcbiAgICBob3N0OiAvKF58XFwuKWFpcmJuYlxcLig/OmNvXFwudWt8Y29tfGllfGZyfGRlfGVzfGl0fG5sfGNvbVxcLmF1fGNhKSQvaSxcbiAgICBwYXRoOiAvXlxcL3Jvb21zXFwvKD86cGx1c1xcLyk/KFxcZCspKD86Wy8jP118JCkvaSxcbiAgICBjYW5vbmljYWw6IChpZCkgPT4gYGh0dHBzOi8vd3d3LmFpcmJuYi5jby51ay9yb29tcy8ke2lkfWAsXG4gIH0sXG4gIHtcbiAgICBzb3VyY2U6ICdib29raW5nJyxcbiAgICBob3N0OiAvKF58XFwuKWJvb2tpbmdcXC5jb20kL2ksXG4gICAgcGF0aDogL15cXC9ob3RlbFxcLyhbYS16XXsyfVxcL1thLXowLTktXSspKD86XFwuW2Etei1dKyk/XFwuaHRtbCg/OlsvIz9dfCQpL2ksXG4gICAgY2Fub25pY2FsOiAoaWQpID0+IGBodHRwczovL3d3dy5ib29raW5nLmNvbS9ob3RlbC8ke2lkfS5odG1sYCxcbiAgfSxcbl07XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXRlY3RMaXN0aW5nVXJsKHJhdzogc3RyaW5nKTogRGV0ZWN0ZWRMaXN0aW5nIHwgbnVsbCB7XG4gIGNvbnN0IHRyaW1tZWQgPSByYXcudHJpbSgpO1xuICBpZiAoIXRyaW1tZWQpIHJldHVybiBudWxsO1xuICBsZXQgdXJsOiBVUkw7XG4gIHRyeSB7XG4gICAgdXJsID0gbmV3IFVSTCgvXmh0dHBzPzpcXC9cXC8vaS50ZXN0KHRyaW1tZWQpID8gdHJpbW1lZCA6IGBodHRwczovLyR7dHJpbW1lZH1gKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgaWYgKHVybC5wcm90b2NvbCAhPT0gJ2h0dHBzOicgJiYgdXJsLnByb3RvY29sICE9PSAnaHR0cDonKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaG9zdCA9IHVybC5ob3N0bmFtZS50b0xvd2VyQ2FzZSgpO1xuICBmb3IgKGNvbnN0IHAgb2YgUEFUVEVSTlMpIHtcbiAgICBpZiAoIXAuaG9zdC50ZXN0KGhvc3QpKSBjb250aW51ZTtcbiAgICBjb25zdCBtID0gdXJsLnBhdGhuYW1lLm1hdGNoKHAucGF0aCk7XG4gICAgaWYgKCFtKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBpZCA9IG1bMV0udG9Mb3dlckNhc2UoKTtcbiAgICByZXR1cm4geyBzb3VyY2U6IHAuc291cmNlLCBpZCwgY2Fub25pY2FsVXJsOiBwLmNhbm9uaWNhbChpZCkgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqIFNpdGVzIHdlIGNhbiBmZXRjaCBmcm9tIG91ciBvd24gc2VydmVycyB0b2RheS4gT3RoZXJzIG5lZWQgdGhlIGV4dGVuc2lvbi4gKi9cbmV4cG9ydCBjb25zdCBTRVJWRVJfRkVUQ0hBQkxFOiBSZWFkb25seVNldDxMaXN0aW5nU291cmNlPiA9IG5ldyBTZXQoWydyaWdodG1vdmUnLCAnb250aGVtYXJrZXQnLCAnYWlyYm5iJ10pO1xuXG5leHBvcnQgY29uc3QgU09VUkNFX0xBQkVMUzogUmVjb3JkPExpc3RpbmdTb3VyY2UsIHN0cmluZz4gPSB7XG4gIHJpZ2h0bW92ZTogJ1JpZ2h0bW92ZScsXG4gIG9udGhlbWFya2V0OiAnT25UaGVNYXJrZXQnLFxuICB6b29wbGE6ICdab29wbGEnLFxuICBhaXJibmI6ICdBaXJibmInLFxuICBib29raW5nOiAnQm9va2luZy5jb20nLFxufTtcbiIsICIvKiogU2hhcmVkIHByaWNlIGZvcm1hdHRpbmcgZm9yIGxpc3RpbmcgcHJpY2VzIChvbmUgcGxhY2UsIGV2ZXJ5IHN1cmZhY2UpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdExpc3RpbmdQcmljZShwcmljZTogeyBhbW91bnQ6IG51bWJlcjsgcGVyaW9kOiBzdHJpbmcgfSB8IG51bGwgfCB1bmRlZmluZWQsIGNvbXBhY3QgPSBmYWxzZSk6IHN0cmluZyB7XG4gIGlmICghcHJpY2UpIHJldHVybiAnXHUyMDE0JztcbiAgY29uc3QgYW1vdW50ID0gY29tcGFjdCAmJiBwcmljZS5hbW91bnQgPj0gMTAwMCA/IGBcdTAwQTMkeyhwcmljZS5hbW91bnQgLyAxMDAwKS50b0ZpeGVkKHByaWNlLmFtb3VudCA+PSAxMDBfMDAwID8gMCA6IDEpLnJlcGxhY2UoL1xcLjAkLywgJycpfWtgIDogYFx1MDBBMyR7TWF0aC5yb3VuZChwcmljZS5hbW91bnQpLnRvTG9jYWxlU3RyaW5nKCdlbi1HQicpfWA7XG4gIGNvbnN0IHN1ZmZpeCA9IHByaWNlLnBlcmlvZCA9PT0gJ3BjbScgPyAnIHBjbScgOiBwcmljZS5wZXJpb2QgPT09ICdwdycgPyAnIHB3JyA6IHByaWNlLnBlcmlvZCA9PT0gJ25pZ2h0JyA/ICcgLyBuaWdodCcgOiAnJztcbiAgcmV0dXJuIGAke2Ftb3VudH0ke3N1ZmZpeH1gO1xufVxuIiwgIi8qKlxuICogVHlwZXMgYW5kIG1lc3NhZ2Ugc2hhcGVzIHNoYXJlZCBieSB0aGUgc2VydmljZSB3b3JrZXIsIGNvbnRlbnQgc2NyaXB0IGFuZFxuICogcG9wdXAuIExpc3RpbmcgdHlwZXMgY29tZSBzdHJhaWdodCBmcm9tIHRoZSB3ZWJzaXRlJ3MgbGlicmFyeSBzbyB0aGVcbiAqIGV4dGVuc2lvbiBhbmQgdGhlIHNpdGUgbmV2ZXIgZGlzYWdyZWUgYWJvdXQgYSBzbmFwc2hvdC5cbiAqL1xuaW1wb3J0IHR5cGUgeyBMaXN0aW5nU25hcHNob3QgfSBmcm9tICcuLi8uLi9zcmMvbGliL2xpc3RpbmcvdHlwZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBRdWlja0VzdGltYXRlIH0gZnJvbSAnLi4vLi4vc3JjL2xpYi9saXN0aW5nL3F1aWNrLXR5cGVzLnRzJztcbmltcG9ydCB0eXBlIHsgQW5hbHlzZXJQcmVmaWxsIH0gZnJvbSAnLi4vLi4vc3JjL2xpYi9saXN0aW5nL25vcm1hbGlzZS50cyc7XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1NJVEUgPSAnaHR0cHM6Ly9pbnRlbGxpZ2VuY2Uuc3RheWZ1bC5jby51ayc7XG5cbi8qKiBFeHRlbnNpb24tbG9jYWwgc3RvcmFnZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2V0dGluZ3Mge1xuICB0b2tlbjogc3RyaW5nIHwgbnVsbDtcbiAgc2l0ZTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIENoZWNrUmVzcG9uc2Uge1xuICBzbmFwc2hvdDogTGlzdGluZ1NuYXBzaG90O1xuICBwcmVmaWxsOiBBbmFseXNlclByZWZpbGw7XG4gIHdhcm5pbmdzOiBzdHJpbmdbXTtcbiAgcXVpY2s6IFF1aWNrRXN0aW1hdGU7XG4gIGNoZWNrZWRMaXN0aW5nSWQ6IHN0cmluZyB8IG51bGw7XG4gIGZyb21DYWNoZTogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBcGlFcnJvciB7XG4gIGVycm9yOiBzdHJpbmc7XG4gIGNvZGU/OiBzdHJpbmc7XG4gIHVwZ3JhZGVVcmw/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWVSZXNwb25zZSB7XG4gIGVtYWlsOiBzdHJpbmcgfCBudWxsO1xuICBzdGF0ZTogJ29rJyB8ICdibG9ja2VkJztcbiAgcGxhbjogJ2ZyZWUnIHwgJ3BybycgfCBudWxsO1xuICBydW5zUmVtYWluaW5nOiBudW1iZXIgfCBudWxsO1xufVxuXG5leHBvcnQgdHlwZSBNZXNzYWdlID1cbiAgfCB7IHR5cGU6ICdzdGF0dXMnIH1cbiAgfCB7IHR5cGU6ICdjaGVjayc7IHVybDogc3RyaW5nOyBodG1sOiBzdHJpbmc7IHNhdmU/OiBib29sZWFuIH1cbiAgfCB7IHR5cGU6ICdzZXRUb2tlbic7IHRva2VuOiBzdHJpbmc7IHNpdGU/OiBzdHJpbmcgfVxuICB8IHsgdHlwZTogJ2Rpc2Nvbm5lY3QnIH07XG5cbi8qKiBgbWU6IG51bGxgIG1lYW5zIHRoZSB0b2tlbiBpcyBzdG9yZWQgYnV0IHRoZSBzaXRlIGNvdWxkIG5vdCBjb25maXJtIGl0IHJpZ2h0IG5vdyAocmV0cnksIG5vdCBhIHBsYW4gcHJvYmxlbSkuICovXG5leHBvcnQgdHlwZSBTdGF0dXNSZXN1bHQgPSB7IGNvbm5lY3RlZDogZmFsc2U7IHNpdGU6IHN0cmluZyB9IHwgeyBjb25uZWN0ZWQ6IHRydWU7IHNpdGU6IHN0cmluZzsgbWU6IE1lUmVzcG9uc2UgfSB8IHsgY29ubmVjdGVkOiB0cnVlOyBzaXRlOiBzdHJpbmc7IG1lOiBudWxsOyBlcnJvcjogc3RyaW5nIH07XG5cbmV4cG9ydCB0eXBlIENoZWNrUmVzdWx0ID0geyBvazogdHJ1ZTsgZGF0YTogQ2hlY2tSZXNwb25zZSB9IHwgeyBvazogZmFsc2U7IHN0YXR1czogbnVtYmVyOyBlcnJvcjogQXBpRXJyb3IgfTtcblxuZXhwb3J0IHR5cGUgUmVwbHkgPSBTdGF0dXNSZXN1bHQgfCBDaGVja1Jlc3VsdCB8IHsgb2s6IGJvb2xlYW47IGVycm9yPzogc3RyaW5nIH07XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpc2VTaXRlKHJhdzogc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCk6IHN0cmluZyB7XG4gIGNvbnN0IHMgPSAocmF3ID8/ICcnKS50cmltKCkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiAvXmh0dHBzPzpcXC9cXC9bXlxccy9dKyQvLnRlc3QocykgPyBzIDogREVGQVVMVF9TSVRFO1xufVxuXG4vKiogRXNjYXBlcyB0ZXh0IGZvciB0aGUgcGFuZWwvcG9wdXAgSFRNTCAoYXR0cmlidXRlIHZhbHVlcyBpbmNsdWRlZCkuICovXG5leHBvcnQgZnVuY3Rpb24gZXNjKHY6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB2LnJlcGxhY2UoLyYvZywgJyZhbXA7JykucmVwbGFjZSgvPC9nLCAnJmx0OycpLnJlcGxhY2UoLz4vZywgJyZndDsnKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JykucmVwbGFjZSgvJy9nLCAnJiMzOTsnKTtcbn1cblxuLyoqIFNlbmRzIGEgbWVzc2FnZSB0byB0aGUgc2VydmljZSB3b3JrZXIgYW5kIHJlc29sdmVzIHdpdGggaXRzIHJlcGx5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlbmQ8VD4obWVzc2FnZTogTWVzc2FnZSk6IFByb21pc2U8VD4ge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNocm9tZS5ydW50aW1lLnNlbmRNZXNzYWdlKG1lc3NhZ2UsIChyZXNwb25zZTogVCkgPT4ge1xuICAgICAgaWYgKGNocm9tZS5ydW50aW1lLmxhc3RFcnJvcikgcmVqZWN0KG5ldyBFcnJvcihjaHJvbWUucnVudGltZS5sYXN0RXJyb3IubWVzc2FnZSkpO1xuICAgICAgZWxzZSByZXNvbHZlKHJlc3BvbnNlKTtcbiAgICB9KTtcbiAgfSk7XG59XG4iLCAiLyoqXG4gKiBDb250ZW50IHNjcmlwdDogb24gYSBsaXN0aW5nIHBhZ2UsIG1vdW50cyBhIHNtYWxsIFN0YXlmdWwgYmFyIChpbiBhIHNoYWRvd1xuICogcm9vdCBzbyBzaXRlIENTUyBjYW5ub3QgdG91Y2ggaXQpLiBOb3RoaW5nIGlzIHNlbnQgYW55d2hlcmUgdW50aWwgdGhlXG4gKiBtZW1iZXIgY2xpY2tzIENoZWNrOyB0aGUgcGFnZSBIVE1MIHRoZW4gZ29lcyB0byB0aGUgc2VydmljZSB3b3JrZXIsIHdoaWNoXG4gKiBjYWxscyB0aGUgU3RheWZ1bCBBUEksIGFuZCB0aGUgYmFyIGV4cGFuZHMgaW50byB0aGUgcXVpY2stdmlldyBwYW5lbC5cbiAqIFNpbmdsZS1wYWdlIHNpdGVzIChBaXJibmIpIGNoYW5nZSB0aGUgVVJMIHdpdGhvdXQgcmVsb2FkaW5nLCBzbyB0aGUgYmFyXG4gKiBmb2xsb3dzIHRoZSBjdXJyZW50IGxpc3RpbmcgaWQuXG4gKi9cbmltcG9ydCB7IGRldGVjdExpc3RpbmdVcmwsIFNPVVJDRV9MQUJFTFMgfSBmcm9tICcuLi8uLi9zcmMvbGliL2xpc3RpbmcvZGV0ZWN0LnRzJztcbmltcG9ydCB7IGZvcm1hdExpc3RpbmdQcmljZSB9IGZyb20gJy4uLy4uL3NyYy9saWIvbGlzdGluZy9mb3JtYXQudHMnO1xuaW1wb3J0IHsgZXNjLCBzZW5kLCB0eXBlIENoZWNrUmVzcG9uc2UsIHR5cGUgQ2hlY2tSZXN1bHQsIHR5cGUgU3RhdHVzUmVzdWx0IH0gZnJvbSAnLi9zaGFyZWQudHMnO1xuXG5jb25zdCBIT1NUX0lEID0gJ3N0YXlmdWwtaW50ZWxsaWdlbmNlLXJvb3QnO1xuXG5jb25zdCBDU1MgPSBgXG4gIDpob3N0IHsgYWxsOiBpbml0aWFsOyB9XG4gICogeyBib3gtc2l6aW5nOiBib3JkZXItYm94OyBmb250LWZhbWlseTogc3lzdGVtLXVpLCAtYXBwbGUtc3lzdGVtLCBcIlNlZ29lIFVJXCIsIHNhbnMtc2VyaWY7IH1cbiAgLmJhciB7IHBvc2l0aW9uOiBmaXhlZDsgcmlnaHQ6IDE2cHg7IGJvdHRvbTogMTZweDsgei1pbmRleDogMjE0NzQ4MzAwMDsgd2lkdGg6IDM0MHB4OyBtYXgtd2lkdGg6IGNhbGMoMTAwdncgLSAzMnB4KTsgYmFja2dyb3VuZDogI2ZmZjsgY29sb3I6ICMyZTNkMmI7IGJvcmRlcjogMXB4IHNvbGlkICNlNGU3ZGM7IGJvcmRlci1yYWRpdXM6IDE0cHg7IGJveC1zaGFkb3c6IDAgMTJweCAzMnB4IHJnYmEoNDYsNjEsNDMsLjE4KTsgZm9udC1zaXplOiAxM3B4OyBsaW5lLWhlaWdodDogMS40OyBvdmVyZmxvdzogaGlkZGVuOyB9XG4gIC5oZWFkIHsgZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsgZ2FwOiA4cHg7IHBhZGRpbmc6IDEwcHggMTJweDsgYmFja2dyb3VuZDogI2Y3ZjhmNDsgYm9yZGVyLWJvdHRvbTogMXB4IHNvbGlkICNlNGU3ZGM7IH1cbiAgLmxvZ28geyB3aWR0aDogMjJweDsgaGVpZ2h0OiAyMnB4OyBib3JkZXItcmFkaXVzOiA2cHg7IGJhY2tncm91bmQ6ICM1ZDgxNTY7IGNvbG9yOiAjZmZmOyBmb250LXdlaWdodDogODAwOyBmb250LXNpemU6IDEzcHg7IGRpc3BsYXk6IGdyaWQ7IHBsYWNlLWl0ZW1zOiBjZW50ZXI7IH1cbiAgLmJyYW5kIHsgZm9udC13ZWlnaHQ6IDcwMDsgZm9udC1zaXplOiAxMnB4OyBsZXR0ZXItc3BhY2luZzogLjA0ZW07IHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7IGNvbG9yOiAjNWQ4MTU2OyB9XG4gIC5zcGFjZXIgeyBmbGV4OiAxOyB9XG4gIC54IHsgYm9yZGVyOiAwOyBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDsgY29sb3I6ICM3YTgyNzQ7IGZvbnQtc2l6ZTogMTZweDsgY3Vyc29yOiBwb2ludGVyOyBwYWRkaW5nOiAwIDRweDsgfVxuICAuYm9keSB7IHBhZGRpbmc6IDEycHg7IH1cbiAgLnRpdGxlIHsgZm9udC13ZWlnaHQ6IDYwMDsgZm9udC1zaXplOiAxM3B4OyB3aGl0ZS1zcGFjZTogbm93cmFwOyBvdmVyZmxvdzogaGlkZGVuOyB0ZXh0LW92ZXJmbG93OiBlbGxpcHNpczsgfVxuICAubWV0YSB7IGNvbG9yOiAjN2E4Mjc0OyBmb250LXNpemU6IDEycHg7IG1hcmdpbi10b3A6IDJweDsgfVxuICAuY3RhIHsgZGlzcGxheTogaW5saW5lLWJsb2NrOyBtYXJnaW4tdG9wOiAxMHB4OyBib3JkZXI6IDA7IGJvcmRlci1yYWRpdXM6IDk5OXB4OyBiYWNrZ3JvdW5kOiAjNWQ4MTU2OyBjb2xvcjogI2ZmZjsgZm9udC13ZWlnaHQ6IDYwMDsgZm9udC1zaXplOiAxM3B4OyBwYWRkaW5nOiA4cHggMTRweDsgY3Vyc29yOiBwb2ludGVyOyB0ZXh0LWRlY29yYXRpb246IG5vbmU7IH1cbiAgLmN0YS5zZWNvbmRhcnkgeyBiYWNrZ3JvdW5kOiAjZmZmOyBjb2xvcjogIzJlM2QyYjsgYm9yZGVyOiAxcHggc29saWQgI2U0ZTdkYzsgfVxuICAuY3RhW2Rpc2FibGVkXSB7IG9wYWNpdHk6IC42OyBjdXJzb3I6IGRlZmF1bHQ7IH1cbiAgLnJvdyB7IGRpc3BsYXk6IGZsZXg7IGdhcDogOHB4OyBmbGV4LXdyYXA6IHdyYXA7IH1cbiAgLnRpbGVzIHsgZGlzcGxheTogZ3JpZDsgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiAxZnIgMWZyOyBnYXA6IDhweDsgbWFyZ2luLXRvcDogMTBweDsgfVxuICAudGlsZSB7IGJhY2tncm91bmQ6ICNmN2Y4ZjQ7IGJvcmRlci1yYWRpdXM6IDEwcHg7IHBhZGRpbmc6IDhweCAxMHB4OyB9XG4gIC50aWxlIC5rIHsgZm9udC1zaXplOiAxMHB4OyB0ZXh0LXRyYW5zZm9ybTogdXBwZXJjYXNlOyBsZXR0ZXItc3BhY2luZzogLjA2ZW07IGNvbG9yOiAjN2E4Mjc0OyB9XG4gIC50aWxlIC52IHsgZm9udC13ZWlnaHQ6IDcwMDsgZm9udC1zaXplOiAxNXB4OyBtYXJnaW4tdG9wOiAycHg7IH1cbiAgLnRpbGUgLnMgeyBmb250LXNpemU6IDExcHg7IGNvbG9yOiAjN2E4Mjc0OyBtYXJnaW4tdG9wOiAxcHg7IH1cbiAgLmRlYWwgeyBtYXJnaW4tdG9wOiAxMHB4OyBwYWRkaW5nOiA4cHggMTBweDsgYm9yZGVyLXJhZGl1czogMTBweDsgYm9yZGVyOiAxcHggc29saWQgI2U0ZTdkYzsgZm9udC1zaXplOiAxMnB4OyB9XG4gIC5kZWFsIHN0cm9uZyB7IGNvbG9yOiAjNWQ4MTU2OyB9XG4gIC5ub3RlIHsgbWFyZ2luLXRvcDogOHB4OyBmb250LXNpemU6IDExcHg7IGNvbG9yOiAjN2E4Mjc0OyB9XG4gIC5lcnIgeyBtYXJnaW4tdG9wOiA4cHg7IGZvbnQtc2l6ZTogMTJweDsgY29sb3I6ICNiMzI2MWU7IH1cbiAgLmxvY2sgeyBtYXJnaW4tdG9wOiA4cHg7IGZvbnQtc2l6ZTogMTJweDsgfVxuICBhLmxpbmsgeyBjb2xvcjogIzVkODE1NjsgdGV4dC1kZWNvcmF0aW9uOiB1bmRlcmxpbmU7IH1cbmA7XG5cbnR5cGUgU3RhdGUgPVxuICB8IHsga2luZDogJ2lkbGUnIH1cbiAgfCB7IGtpbmQ6ICdidXN5JyB9XG4gIHwgeyBraW5kOiAncmVzdWx0JzsgZGF0YTogQ2hlY2tSZXNwb25zZSB9XG4gIHwgeyBraW5kOiAnZXJyb3InOyBtZXNzYWdlOiBzdHJpbmc7IGNvZGU/OiBzdHJpbmc7IHVwZ3JhZGVVcmw/OiBzdHJpbmcgfVxuICB8IHsga2luZDogJ2xvY2tlZCc7IHNpdGU6IHN0cmluZzsgcmVhc29uOiAnbm90X2Nvbm5lY3RlZCcgfCAnbm9fYWNjZXNzJyB9O1xuXG5sZXQgY3VycmVudFVybCA9ICcnO1xubGV0IGhvc3Q6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG5sZXQgcm9vdDogU2hhZG93Um9vdCB8IG51bGwgPSBudWxsO1xuLyoqIFRoZSBsaXN0aW5nIHRoZSBtZW1iZXIgZGlzbWlzc2VkIHRoZSBiYXIgb247IGl0IHN0YXlzIGNsb3NlZCB1bnRpbCB0aGV5IG9wZW4gYSBkaWZmZXJlbnQgbGlzdGluZy4gKi9cbmxldCBjbG9zZWRGb3I6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuXG5jb25zdCBnYnAgPSAobjogbnVtYmVyKSA9PiBgXHUwMEEzJHtNYXRoLnJvdW5kKG4pLnRvTG9jYWxlU3RyaW5nKCdlbi1HQicpfWA7XG5cbmZ1bmN0aW9uIG1vdW50KCk6IFNoYWRvd1Jvb3Qge1xuICBpZiAocm9vdCAmJiBob3N0Py5pc0Nvbm5lY3RlZCkgcmV0dXJuIHJvb3Q7XG4gIGhvc3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgaG9zdC5pZCA9IEhPU1RfSUQ7XG4gIC8vIE9wZW4gc28gdGVzdHMgY2FuIHJlYWNoIHRoZSBiYXI7IHNpdGUgQ1NTIGNhbm5vdCBjcm9zcyB0aGUgYm91bmRhcnkgZWl0aGVyIHdheS5cbiAgcm9vdCA9IGhvc3QuYXR0YWNoU2hhZG93KHsgbW9kZTogJ29wZW4nIH0pO1xuICBjb25zdCBzdHlsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XG4gIHN0eWxlLnRleHRDb250ZW50ID0gQ1NTO1xuICByb290LmFwcGVuZENoaWxkKHN0eWxlKTtcbiAgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmFwcGVuZENoaWxkKGhvc3QpO1xuICByZXR1cm4gcm9vdDtcbn1cblxuZnVuY3Rpb24gdW5tb3VudCgpIHtcbiAgaG9zdD8ucmVtb3ZlKCk7XG4gIGhvc3QgPSBudWxsO1xuICByb290ID0gbnVsbDtcbn1cblxuZnVuY3Rpb24gaGVhZGVyKCk6IHN0cmluZyB7XG4gIHJldHVybiBgPGRpdiBjbGFzcz1cImhlYWRcIj48c3BhbiBjbGFzcz1cImxvZ29cIj5TPC9zcGFuPjxzcGFuIGNsYXNzPVwiYnJhbmRcIj5TdGF5ZnVsPC9zcGFuPjxzcGFuIGNsYXNzPVwic3BhY2VyXCI+PC9zcGFuPjxidXR0b24gY2xhc3M9XCJ4XCIgZGF0YS1hY3Q9XCJjbG9zZVwiIGFyaWEtbGFiZWw9XCJDbG9zZVwiPlx1MDBENzwvYnV0dG9uPjwvZGl2PmA7XG59XG5cbmZ1bmN0aW9uIHRpbGUoazogc3RyaW5nLCB2OiBzdHJpbmcsIHM/OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYDxkaXYgY2xhc3M9XCJ0aWxlXCI+PGRpdiBjbGFzcz1cImtcIj4ke2VzYyhrKX08L2Rpdj48ZGl2IGNsYXNzPVwidlwiPiR7ZXNjKHYpfTwvZGl2PiR7cyA/IGA8ZGl2IGNsYXNzPVwic1wiPiR7ZXNjKHMpfTwvZGl2PmAgOiAnJ308L2Rpdj5gO1xufVxuXG5mdW5jdGlvbiByZXN1bHRIdG1sKHNpdGU6IHN0cmluZywgcjogQ2hlY2tSZXNwb25zZSk6IHN0cmluZyB7XG4gIGNvbnN0IHNuYXAgPSByLnNuYXBzaG90O1xuICBjb25zdCBxID0gci5xdWljaztcbiAgY29uc3QgZXN0ID0gcS5lc3RpbWF0ZTtcbiAgY29uc3QgYXJlYSA9IHEuYXJlYTtcbiAgY29uc3QgcHJpY2UgPSBzbmFwLnByaWNlID8gZm9ybWF0TGlzdGluZ1ByaWNlKHNuYXAucHJpY2UpIDogbnVsbDtcbiAgY29uc3QgbWV0YSA9IFtwcmljZSwgc25hcC5iZWRyb29tcyAhPT0gdW5kZWZpbmVkID8gYCR7c25hcC5iZWRyb29tc30gYmVkYCA6IG51bGwsIHNuYXAuZGlzcGxheUFkZHJlc3MgPz8gc25hcC5wb3N0Y29kZSA/PyBudWxsXS5maWx0ZXIoQm9vbGVhbikuam9pbignIFx1MDBCNyAnKTtcblxuICBjb25zdCB0aWxlczogc3RyaW5nW10gPSBbXTtcbiAgaWYgKHNuYXAuc291cmNlID09PSAnYm9va2luZycpIHtcbiAgICBjb25zdCBuaWdodGx5ID0gc25hcC5wcmljZT8ucGVyaW9kID09PSAnbmlnaHQnID8gc25hcC5wcmljZS5hbW91bnQgOiBudWxsO1xuICAgIGNvbnN0IGFyZWFBZHIgPSBlc3Q/LmFkciA/PyBxLnBtaU1hcmtldD8uYWRyID8/IG51bGw7XG4gICAgY29uc3QgZGlmZiA9IG5pZ2h0bHkgJiYgYXJlYUFkciA/IE1hdGgucm91bmQoKChuaWdodGx5IC0gYXJlYUFkcikgLyBhcmVhQWRyKSAqIDEwMCkgOiBudWxsO1xuICAgIHRpbGVzLnB1c2godGlsZSgnUmF0ZSBiZW5jaG1hcmsnLCBuaWdodGx5ID8gYCR7Z2JwKG5pZ2h0bHkpfSAvIG5pZ2h0YCA6ICdcdTIwMTQnLCBhcmVhQWRyID8gYEFyZWEgYXZlcmFnZSAke2dicChhcmVhQWRyKX0ke2RpZmYgIT09IG51bGwgPyBgICgke2RpZmYgPiAwID8gJysnIDogJyd9JHtkaWZmfSUpYCA6ICcnfWAgOiAnTm8gYXJlYSByYXRlIHlldCcpKTtcbiAgfSBlbHNlIHtcbiAgICB0aWxlcy5wdXNoKHRpbGUoJ0VzdC4gcmV2ZW51ZSAvIHlyJywgZXN0ID8gZ2JwKGVzdC5ncm9zc1JldmVudWUpIDogJ1x1MjAxNCcsIGVzdCA/IGAke2VzdC5hZHIgPyBgJHtnYnAoZXN0LmFkcil9IC8gbmlnaHRgIDogJyd9JHtlc3Qub2NjdXBhbmN5ICE9PSBudWxsID8gYCBcdTAwQjcgJHtNYXRoLnJvdW5kKGVzdC5vY2N1cGFuY3kpfSUgb2NjLmAgOiAnJ31gIDogJ05vIGFyZWEgZGF0YSB5ZXQnKSk7XG4gIH1cbiAgdGlsZXMucHVzaCh0aWxlKCdBcmVhIHNjb3JlJywgYXJlYT8uc2NvcmUgIT09IG51bGwgJiYgYXJlYT8uc2NvcmUgIT09IHVuZGVmaW5lZCA/IGAke2FyZWEuc2NvcmV9IFx1MDBCNyAke2FyZWEuZ3JhZGUgPz8gJyd9YCA6ICdcdTIwMTQnLCBhcmVhID8gYCR7YXJlYS5uYW1lfSR7YXJlYS5jb21wZXRpdGlvbiA/IGAgXHUwMEI3ICR7YXJlYS5jb21wZXRpdGlvbi5sYWJlbH0gY29tcGV0aXRpb25gIDogJyd9YCA6IHVuZGVmaW5lZCkpO1xuICBpZiAoc25hcC5zb3VyY2UgPT09ICdhaXJibmInKSB7XG4gICAgdGlsZXMucHVzaChxLnRyYWNrZWQgPyB0aWxlKCdUaGlzIGxpc3RpbmcgZWFybnMnLCBnYnAocS50cmFja2VkLmFubnVhbFJldmVudWUpLCBgJHtnYnAocS50cmFja2VkLmFkcil9IC8gbmlnaHQgXHUwMEI3ICR7TWF0aC5yb3VuZChxLnRyYWNrZWQub2NjdXBhbmN5ICogMTAwKX0lIFx1MDBCNyAke3EudHJhY2tlZC5yZXZpZXdDb3VudH0gcmV2aWV3c2ApIDogdGlsZSgnVGhpcyBsaXN0aW5nJywgJ05vdCB0cmFja2VkJywgJ0VzdGltYXRlIHVzZXMgdGhlIGFyZWEgZmlndXJlJykpO1xuICB9IGVsc2UgaWYgKGFyZWE/LnRyZW5kKSB7XG4gICAgdGlsZXMucHVzaCh0aWxlKCdUcmVuZCcsIGFyZWEudHJlbmQubGFiZWwsIGFyZWEuZGlyZWN0Qm9va2luZyA/IGAke2FyZWEuZGlyZWN0Qm9va2luZy5sYWJlbH0gZGlyZWN0LWJvb2tpbmcgcG90ZW50aWFsYCA6IHVuZGVmaW5lZCkpO1xuICB9XG4gIHRpbGVzLnB1c2godGlsZSgnTGljZW5zaW5nJywgYXJlYT8ubGljZW5zaW5nLnN0YXR1cyA9PT0gJ2NvbmZpcm1lZC1saWNlbnNlZCcgPyAnTGljZW5jZSByZXF1aXJlZCcgOiBhcmVhPy5saWNlbnNpbmcuc3RhdHVzID09PSAnY29uZmlybWVkLXVucmVzdHJpY3RlZCcgPyAnTm8gbGljZW5jZSB0b2RheScgOiAnVW5jb25maXJtZWQnLCBhcmVhPy5saWNlbnNpbmcuaGVhZGxpbmUpKTtcblxuICBsZXQgZGVhbCA9ICcnO1xuICBjb25zdCBkID0gcS5kZWFsO1xuICBpZiAoZD8ua2luZCA9PT0gJ3B1cmNoYXNlJykgZGVhbCA9IGA8ZGl2IGNsYXNzPVwiZGVhbFwiPkF0ICR7Z2JwKGQuYXNraW5nUHJpY2UpfTogPHN0cm9uZz4ke2QuZ3Jvc3NZaWVsZFBjdC50b0ZpeGVkKDEpfSUgZ3Jvc3MgeWllbGQ8L3N0cm9uZz4gXHUwMEI3ICR7Z2JwKGQuY2FzaGZsb3dNb250aGx5KX0vbW8gYWZ0ZXIgbW9ydGdhZ2UgXHUwMEI3IG1heCBwcmljZSBmb3IgJHtkLnRhcmdldFlpZWxkUGN0fSU6ICR7Z2JwKGQubWF4UHJpY2VGb3JUYXJnZXRZaWVsZCl9PC9kaXY+YDtcbiAgaWYgKGQ/LmtpbmQgPT09ICdyZW50LXRvLXJlbnQnKSBkZWFsID0gYDxkaXYgY2xhc3M9XCJkZWFsXCI+UmVudC10by1yZW50IGF0ICR7Z2JwKGQuYWR2ZXJ0aXNlZFJlbnRQY20pfSBwY206IDxzdHJvbmc+JHtnYnAoZC5tb250aGx5TWFyZ2luKX0vbW8gbWFyZ2luPC9zdHJvbmc+JHtkLmJyZWFrZXZlbk9jY3VwYW5jeVBjdCAhPT0gbnVsbCA/IGAgXHUwMEI3IGJyZWFrZXZlbiAke01hdGgucm91bmQoZC5icmVha2V2ZW5PY2N1cGFuY3lQY3QpfSUgb2NjdXBhbmN5YCA6ICcnfTwvZGl2PmA7XG5cbiAgY29uc3QgcmVwb3J0ID0gYCR7c2l0ZX0vZXN0aW1hdGU/bGlzdGluZz0ke2VuY29kZVVSSUNvbXBvbmVudChzbmFwLmNhbm9uaWNhbFVybCl9YDtcbiAgY29uc3QgZXhwbG9yZXIgPSByLmNoZWNrZWRMaXN0aW5nSWQgPyBgJHtzaXRlfS9tYXJrZXRzP3BhbmU9bGlzdGluZ3MmbGlzdGluZz0ke2VuY29kZVVSSUNvbXBvbmVudChyLmNoZWNrZWRMaXN0aW5nSWQpfWAgOiBgJHtzaXRlfS9tYXJrZXRzP2NoZWNrPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHNuYXAuY2Fub25pY2FsVXJsKX1gO1xuICByZXR1cm4gYCR7aGVhZGVyKCl9PGRpdiBjbGFzcz1cImJvZHlcIj5cbiAgICA8ZGl2IGNsYXNzPVwidGl0bGVcIj4ke2VzYyhzbmFwLnRpdGxlKX08L2Rpdj5cbiAgICA8ZGl2IGNsYXNzPVwibWV0YVwiPiR7ZXNjKG1ldGEpfTwvZGl2PlxuICAgIDxkaXYgY2xhc3M9XCJ0aWxlc1wiPiR7dGlsZXMuam9pbignJyl9PC9kaXY+XG4gICAgJHtkZWFsfVxuICAgIDxkaXYgY2xhc3M9XCJyb3dcIj5cbiAgICAgIDxhIGNsYXNzPVwiY3RhXCIgaHJlZj1cIiR7ZXNjKHJlcG9ydCl9XCIgdGFyZ2V0PVwiX2JsYW5rXCIgcmVsPVwibm9vcGVuZXJcIj5GdWxsIHJlcG9ydDwvYT5cbiAgICAgIDxhIGNsYXNzPVwiY3RhIHNlY29uZGFyeVwiIGhyZWY9XCIke2VzYyhleHBsb3Jlcil9XCIgdGFyZ2V0PVwiX2JsYW5rXCIgcmVsPVwibm9vcGVuZXJcIj5PcGVuIGluIGV4cGxvcmVyPC9hPlxuICAgIDwvZGl2PlxuICAgIDxkaXYgY2xhc3M9XCJub3RlXCI+JHtyLmNoZWNrZWRMaXN0aW5nSWQgPyAnU2F2ZWQgdG8geW91ciBwaXBlbGluZS4gJyA6ICcnfSR7cS5saW1pdGVkID8gJ1NvbWUgbG9va3VwcyBhcmUgcGF1c2VkIGZvciB0b2RheS4gJyA6ICcnfSR7ZXN0ID8gZXNjKGVzdC5ub3RlKSA6ICcnfTwvZGl2PlxuICA8L2Rpdj5gO1xufVxuXG5mdW5jdGlvbiByZW5kZXIoc3RhdGU6IFN0YXRlLCBzaXRlOiBzdHJpbmcpIHtcbiAgaWYgKGNsb3NlZEZvciA9PT0gY3VycmVudFVybCkgcmV0dXJuO1xuICBjb25zdCByID0gbW91bnQoKTtcbiAgbGV0IGJvZHkgPSAnJztcbiAgY29uc3Qgc291cmNlID0gZGV0ZWN0TGlzdGluZ1VybChjdXJyZW50VXJsKT8uc291cmNlO1xuICBjb25zdCBsYWJlbCA9IHNvdXJjZSA/IFNPVVJDRV9MQUJFTFNbc291cmNlXSA6ICd0aGlzIHNpdGUnO1xuICBzd2l0Y2ggKHN0YXRlLmtpbmQpIHtcbiAgICBjYXNlICdpZGxlJzpcbiAgICAgIGJvZHkgPSBgJHtoZWFkZXIoKX08ZGl2IGNsYXNzPVwiYm9keVwiPjxkaXYgY2xhc3M9XCJ0aXRsZVwiPldoYXQgd291bGQgdGhpcyBlYXJuIGFzIGEgc2hvcnQtdGVybSBsZXQ/PC9kaXY+PGRpdiBjbGFzcz1cIm1ldGFcIj5GcmVlIHF1aWNrIHZpZXcgZm9yIG1lbWJlcnMgXHUwMEI3IG5vIHJlcG9ydCB1c2VkPC9kaXY+PGJ1dHRvbiBjbGFzcz1cImN0YVwiIGRhdGEtYWN0PVwiY2hlY2tcIj5DaGVjayB0aGlzICR7ZXNjKGxhYmVsKX0gbGlzdGluZzwvYnV0dG9uPjwvZGl2PmA7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdidXN5JzpcbiAgICAgIGJvZHkgPSBgJHtoZWFkZXIoKX08ZGl2IGNsYXNzPVwiYm9keVwiPjxkaXYgY2xhc3M9XCJ0aXRsZVwiPlJlYWRpbmcgdGhlIGxpc3RpbmdcdTIwMjY8L2Rpdj48ZGl2IGNsYXNzPVwibWV0YVwiPkVzdGltYXRpbmcgcmV2ZW51ZSBhbmQgcnVubmluZyB0aGUgZGVhbCBtYXRocy48L2Rpdj48YnV0dG9uIGNsYXNzPVwiY3RhXCIgZGlzYWJsZWQ+Q2hlY2tpbmdcdTIwMjY8L2J1dHRvbj48L2Rpdj5gO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAncmVzdWx0JzpcbiAgICAgIGJvZHkgPSByZXN1bHRIdG1sKHNpdGUsIHN0YXRlLmRhdGEpO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZXJyb3InOlxuICAgICAgYm9keSA9IGAke2hlYWRlcigpfTxkaXYgY2xhc3M9XCJib2R5XCI+PGRpdiBjbGFzcz1cInRpdGxlXCI+Q291bGQgbm90IGNoZWNrIHRoaXMgbGlzdGluZzwvZGl2PjxkaXYgY2xhc3M9XCJlcnJcIj4ke2VzYyhzdGF0ZS5tZXNzYWdlKX08L2Rpdj4ke3N0YXRlLnVwZ3JhZGVVcmwgPyBgPGEgY2xhc3M9XCJjdGFcIiBocmVmPVwiJHtlc2Moc2l0ZSArIHN0YXRlLnVwZ3JhZGVVcmwpfVwiIHRhcmdldD1cIl9ibGFua1wiIHJlbD1cIm5vb3BlbmVyXCI+VXBncmFkZTwvYT5gIDogYDxidXR0b24gY2xhc3M9XCJjdGEgc2Vjb25kYXJ5XCIgZGF0YS1hY3Q9XCIke3N0YXRlLmNvZGUgPT09ICdzdGF0dXMnID8gJ3JldHJ5JyA6ICdjaGVjayd9XCI+VHJ5IGFnYWluPC9idXR0b24+YH08L2Rpdj5gO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnbG9ja2VkJzpcbiAgICAgIGJvZHkgPVxuICAgICAgICBzdGF0ZS5yZWFzb24gPT09ICdub3RfY29ubmVjdGVkJ1xuICAgICAgICAgID8gYCR7aGVhZGVyKCl9PGRpdiBjbGFzcz1cImJvZHlcIj48ZGl2IGNsYXNzPVwidGl0bGVcIj5TZWUgd2hhdCB0aGlzIHdvdWxkIGVhcm4gYXMgYSBzaG9ydC10ZXJtIGxldDwvZGl2PjxkaXYgY2xhc3M9XCJsb2NrXCI+RXN0aW1hdGVkIHJldmVudWUsIGFyZWEgc2NvcmUgYW5kIGRlYWwgbWF0aHMgZm9yIGV2ZXJ5IGxpc3RpbmcgeW91IG9wZW4uIENvbm5lY3QgdGhlIGV4dGVuc2lvbiB0byB5b3VyIFN0YXlmdWwgYWNjb3VudCB0byB1bmxvY2sgaXQuPC9kaXY+PGEgY2xhc3M9XCJjdGFcIiBocmVmPVwiJHtlc2Moc2l0ZSl9L2V4dGVuc2lvbi9jb25uZWN0XCIgdGFyZ2V0PVwiX2JsYW5rXCIgcmVsPVwibm9vcGVuZXJcIj5Db25uZWN0IFN0YXlmdWw8L2E+PC9kaXY+YFxuICAgICAgICAgIDogYCR7aGVhZGVyKCl9PGRpdiBjbGFzcz1cImJvZHlcIj48ZGl2IGNsYXNzPVwidGl0bGVcIj5Zb3VyIHBsYW4gZG9lcyBub3QgaW5jbHVkZSBsaXN0aW5nIGNoZWNrczwvZGl2PjxkaXYgY2xhc3M9XCJsb2NrXCI+VXBncmFkZSB0byBzZWUgcmV2ZW51ZSBlc3RpbWF0ZXMgYW5kIGRlYWwgbWF0aHMgb24gZXZlcnkgbGlzdGluZy48L2Rpdj48YSBjbGFzcz1cImN0YVwiIGhyZWY9XCIke2VzYyhzaXRlKX0vdXBncmFkZVwiIHRhcmdldD1cIl9ibGFua1wiIHJlbD1cIm5vb3BlbmVyXCI+VXBncmFkZTwvYT48L2Rpdj5gO1xuICAgICAgYnJlYWs7XG4gIH1cbiAgbGV0IGJhciA9IHIucXVlcnlTZWxlY3RvcignLmJhcicpIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgaWYgKCFiYXIpIHtcbiAgICBiYXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBiYXIuY2xhc3NOYW1lID0gJ2Jhcic7XG4gICAgci5hcHBlbmRDaGlsZChiYXIpO1xuICAgIGJhci5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7XG4gICAgICBjb25zdCB0ID0gKGUudGFyZ2V0IGFzIEhUTUxFbGVtZW50KS5jbG9zZXN0KCdbZGF0YS1hY3RdJykgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgaWYgKCF0KSByZXR1cm47XG4gICAgICBpZiAodC5kYXRhc2V0LmFjdCA9PT0gJ2Nsb3NlJykge1xuICAgICAgICBjbG9zZWRGb3IgPSBjdXJyZW50VXJsO1xuICAgICAgICB1bm1vdW50KCk7XG4gICAgICB9XG4gICAgICBpZiAodC5kYXRhc2V0LmFjdCA9PT0gJ2NoZWNrJykgdm9pZCBydW5DaGVjaygpO1xuICAgICAgaWYgKHQuZGF0YXNldC5hY3QgPT09ICdyZXRyeScpIHZvaWQgc3RhcnQodHJ1ZSk7XG4gICAgfSk7XG4gIH1cbiAgYmFyLmlubmVySFRNTCA9IGJvZHk7XG59XG5cbmxldCBzaXRlID0gJ2h0dHBzOi8vaW50ZWxsaWdlbmNlLnN0YXlmdWwuY28udWsnO1xuXG5hc3luYyBmdW5jdGlvbiBydW5DaGVjaygpIHtcbiAgcmVuZGVyKHsga2luZDogJ2J1c3knIH0sIHNpdGUpO1xuICB0cnkge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHNlbmQ8Q2hlY2tSZXN1bHQ+KHsgdHlwZTogJ2NoZWNrJywgdXJsOiBjdXJyZW50VXJsLCBodG1sOiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQub3V0ZXJIVE1MIH0pO1xuICAgIGlmIChyZXMub2spIHJlbmRlcih7IGtpbmQ6ICdyZXN1bHQnLCBkYXRhOiByZXMuZGF0YSB9LCBzaXRlKTtcbiAgICBlbHNlIGlmIChyZXMuZXJyb3IuY29kZSA9PT0gJ25vdF9jb25uZWN0ZWQnKSByZW5kZXIoeyBraW5kOiAnbG9ja2VkJywgc2l0ZSwgcmVhc29uOiAnbm90X2Nvbm5lY3RlZCcgfSwgc2l0ZSk7XG4gICAgZWxzZSBpZiAocmVzLmVycm9yLmNvZGUgPT09ICdub19hY2Nlc3MnKSByZW5kZXIoeyBraW5kOiAnbG9ja2VkJywgc2l0ZSwgcmVhc29uOiAnbm9fYWNjZXNzJyB9LCBzaXRlKTtcbiAgICBlbHNlIHJlbmRlcih7IGtpbmQ6ICdlcnJvcicsIG1lc3NhZ2U6IHJlcy5lcnJvci5lcnJvciwgY29kZTogcmVzLmVycm9yLmNvZGUsIHVwZ3JhZGVVcmw6IHJlcy5lcnJvci51cGdyYWRlVXJsIH0sIHNpdGUpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZW5kZXIoeyBraW5kOiAnZXJyb3InLCBtZXNzYWdlOiAoZXJyIGFzIEVycm9yKS5tZXNzYWdlIHx8ICdDb3VsZCBub3QgcmVhY2ggU3RheWZ1bC4nIH0sIHNpdGUpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHN0YXJ0KGZvcmNlID0gZmFsc2UpIHtcbiAgY29uc3QgZGV0ZWN0ZWQgPSBkZXRlY3RMaXN0aW5nVXJsKGxvY2F0aW9uLmhyZWYpO1xuICBpZiAoIWRldGVjdGVkKSB7XG4gICAgdW5tb3VudCgpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBTYW1lIGxpc3RpbmcgKGRhdGUgcGlja2VycyBhbmQgdGhlIGxpa2Ugb25seSBjaGFuZ2UgdGhlIHF1ZXJ5IHN0cmluZyk6IGxlYXZlIHRoZSBiYXIgYXMgaXQgaXMuXG4gIGlmICghZm9yY2UgJiYgZGV0ZWN0ZWQuY2Fub25pY2FsVXJsID09PSBjdXJyZW50VXJsKSByZXR1cm47XG4gIGN1cnJlbnRVcmwgPSBkZXRlY3RlZC5jYW5vbmljYWxVcmw7XG4gIGlmIChjbG9zZWRGb3IgPT09IGN1cnJlbnRVcmwpIHJldHVybjtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdCA9IGF3YWl0IHNlbmQ8U3RhdHVzUmVzdWx0Pih7IHR5cGU6ICdzdGF0dXMnIH0pO1xuICAgIHNpdGUgPSBzdC5zaXRlO1xuICAgIGlmICghc3QuY29ubmVjdGVkKSByZW5kZXIoeyBraW5kOiAnbG9ja2VkJywgc2l0ZSwgcmVhc29uOiAnbm90X2Nvbm5lY3RlZCcgfSwgc2l0ZSk7XG4gICAgZWxzZSBpZiAoc3QubWUgPT09IG51bGwpIHJlbmRlcih7IGtpbmQ6ICdlcnJvcicsIG1lc3NhZ2U6IHN0LmVycm9yLCBjb2RlOiAnc3RhdHVzJyB9LCBzaXRlKTtcbiAgICBlbHNlIGlmIChzdC5tZS5zdGF0ZSAhPT0gJ29rJykgcmVuZGVyKHsga2luZDogJ2xvY2tlZCcsIHNpdGUsIHJlYXNvbjogJ25vX2FjY2VzcycgfSwgc2l0ZSk7XG4gICAgZWxzZSByZW5kZXIoeyBraW5kOiAnaWRsZScgfSwgc2l0ZSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJlbmRlcih7IGtpbmQ6ICdlcnJvcicsIG1lc3NhZ2U6IChlcnIgYXMgRXJyb3IpLm1lc3NhZ2UgfHwgJ0NvdWxkIG5vdCByZWFjaCB0aGUgZXh0ZW5zaW9uLicsIGNvZGU6ICdzdGF0dXMnIH0sIHNpdGUpO1xuICB9XG59XG5cbnZvaWQgc3RhcnQoKTtcbi8vIFNpbmdsZS1wYWdlIG5hdmlnYXRpb24gKEFpcmJuYiBrZWVwcyB0aGUgdGFiIG9wZW4gYW5kIHN3YXBzIHRoZSBsaXN0aW5nKS5cbmxldCBsYXN0SHJlZiA9IGxvY2F0aW9uLmhyZWY7XG5zZXRJbnRlcnZhbCgoKSA9PiB7XG4gIGlmIChsb2NhdGlvbi5ocmVmID09PSBsYXN0SHJlZikgcmV0dXJuO1xuICBsYXN0SHJlZiA9IGxvY2F0aW9uLmhyZWY7XG4gIHZvaWQgc3RhcnQoKTtcbn0sIDEwMDApO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBV0EsTUFBTSxXQUF1RztBQUFBLElBQzNHO0FBQUEsTUFDRSxRQUFRO0FBQUEsTUFDUixNQUFNO0FBQUEsTUFDTixNQUFNO0FBQUEsTUFDTixXQUFXLENBQUMsT0FBTywwQ0FBMEMsRUFBRTtBQUFBLElBQ2pFO0FBQUEsSUFDQTtBQUFBLE1BQ0UsUUFBUTtBQUFBLE1BQ1IsTUFBTTtBQUFBLE1BQ04sTUFBTTtBQUFBLE1BQ04sV0FBVyxDQUFDLE9BQU8sdUNBQXVDLEVBQUU7QUFBQSxJQUM5RDtBQUFBLElBQ0E7QUFBQSxNQUNFLFFBQVE7QUFBQSxNQUNSLE1BQU07QUFBQSxNQUNOLE1BQU07QUFBQSxNQUNOLFdBQVcsQ0FBQyxPQUFPLDZDQUE2QyxFQUFFO0FBQUEsSUFDcEU7QUFBQSxJQUNBO0FBQUEsTUFDRSxRQUFRO0FBQUEsTUFDUixNQUFNO0FBQUEsTUFDTixNQUFNO0FBQUEsTUFDTixXQUFXLENBQUMsT0FBTyxrQ0FBa0MsRUFBRTtBQUFBLElBQ3pEO0FBQUEsSUFDQTtBQUFBLE1BQ0UsUUFBUTtBQUFBLE1BQ1IsTUFBTTtBQUFBLE1BQ04sTUFBTTtBQUFBLE1BQ04sV0FBVyxDQUFDLE9BQU8saUNBQWlDLEVBQUU7QUFBQSxJQUN4RDtBQUFBLEVBQ0Y7QUFFTyxXQUFTLGlCQUFpQixLQUFxQztBQUNwRSxVQUFNLFVBQVUsSUFBSSxLQUFLO0FBQ3pCLFFBQUksQ0FBQyxRQUFTLFFBQU87QUFDckIsUUFBSTtBQUNKLFFBQUk7QUFDRixZQUFNLElBQUksSUFBSSxnQkFBZ0IsS0FBSyxPQUFPLElBQUksVUFBVSxXQUFXLE9BQU8sRUFBRTtBQUFBLElBQzlFLFFBQVE7QUFDTixhQUFPO0FBQUEsSUFDVDtBQUNBLFFBQUksSUFBSSxhQUFhLFlBQVksSUFBSSxhQUFhLFFBQVMsUUFBTztBQUNsRSxVQUFNQSxRQUFPLElBQUksU0FBUyxZQUFZO0FBQ3RDLGVBQVcsS0FBSyxVQUFVO0FBQ3hCLFVBQUksQ0FBQyxFQUFFLEtBQUssS0FBS0EsS0FBSSxFQUFHO0FBQ3hCLFlBQU0sSUFBSSxJQUFJLFNBQVMsTUFBTSxFQUFFLElBQUk7QUFDbkMsVUFBSSxDQUFDLEVBQUcsUUFBTztBQUNmLFlBQU0sS0FBSyxFQUFFLENBQUMsRUFBRSxZQUFZO0FBQzVCLGFBQU8sRUFBRSxRQUFRLEVBQUUsUUFBUSxJQUFJLGNBQWMsRUFBRSxVQUFVLEVBQUUsRUFBRTtBQUFBLElBQy9EO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFLTyxNQUFNLGdCQUErQztBQUFBLElBQzFELFdBQVc7QUFBQSxJQUNYLGFBQWE7QUFBQSxJQUNiLFFBQVE7QUFBQSxJQUNSLFFBQVE7QUFBQSxJQUNSLFNBQVM7QUFBQSxFQUNYOzs7QUN6RU8sV0FBUyxtQkFBbUIsT0FBOEQsVUFBVSxPQUFlO0FBQ3hILFFBQUksQ0FBQyxNQUFPLFFBQU87QUFDbkIsVUFBTSxTQUFTLFdBQVcsTUFBTSxVQUFVLE1BQU8sUUFBSyxNQUFNLFNBQVMsS0FBTSxRQUFRLE1BQU0sVUFBVSxNQUFVLElBQUksQ0FBQyxFQUFFLFFBQVEsUUFBUSxFQUFFLENBQUMsTUFBTSxPQUFJLEtBQUssTUFBTSxNQUFNLE1BQU0sRUFBRSxlQUFlLE9BQU8sQ0FBQztBQUNqTSxVQUFNLFNBQVMsTUFBTSxXQUFXLFFBQVEsU0FBUyxNQUFNLFdBQVcsT0FBTyxRQUFRLE1BQU0sV0FBVyxVQUFVLGFBQWE7QUFDekgsV0FBTyxHQUFHLE1BQU0sR0FBRyxNQUFNO0FBQUEsRUFDM0I7OztBQ29ETyxXQUFTLElBQUksR0FBbUI7QUFDckMsV0FBTyxFQUFFLFFBQVEsTUFBTSxPQUFPLEVBQUUsUUFBUSxNQUFNLE1BQU0sRUFBRSxRQUFRLE1BQU0sTUFBTSxFQUFFLFFBQVEsTUFBTSxRQUFRLEVBQUUsUUFBUSxNQUFNLE9BQU87QUFBQSxFQUMzSDtBQUdPLFdBQVMsS0FBUSxTQUE4QjtBQUNwRCxXQUFPLElBQUksUUFBUSxDQUFDLFNBQVMsV0FBVztBQUN0QyxhQUFPLFFBQVEsWUFBWSxTQUFTLENBQUMsYUFBZ0I7QUFDbkQsWUFBSSxPQUFPLFFBQVEsVUFBVyxRQUFPLElBQUksTUFBTSxPQUFPLFFBQVEsVUFBVSxPQUFPLENBQUM7QUFBQSxZQUMzRSxTQUFRLFFBQVE7QUFBQSxNQUN2QixDQUFDO0FBQUEsSUFDSCxDQUFDO0FBQUEsRUFDSDs7O0FDMURBLE1BQU0sVUFBVTtBQUVoQixNQUFNLE1BQU07QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFvQ1osTUFBSSxhQUFhO0FBQ2pCLE1BQUksT0FBMkI7QUFDL0IsTUFBSSxPQUEwQjtBQUU5QixNQUFJLFlBQTJCO0FBRS9CLE1BQU0sTUFBTSxDQUFDLE1BQWMsT0FBSSxLQUFLLE1BQU0sQ0FBQyxFQUFFLGVBQWUsT0FBTyxDQUFDO0FBRXBFLFdBQVMsUUFBb0I7QUFDM0IsUUFBSSxRQUFRLE1BQU0sWUFBYSxRQUFPO0FBQ3RDLFdBQU8sU0FBUyxjQUFjLEtBQUs7QUFDbkMsU0FBSyxLQUFLO0FBRVYsV0FBTyxLQUFLLGFBQWEsRUFBRSxNQUFNLE9BQU8sQ0FBQztBQUN6QyxVQUFNLFFBQVEsU0FBUyxjQUFjLE9BQU87QUFDNUMsVUFBTSxjQUFjO0FBQ3BCLFNBQUssWUFBWSxLQUFLO0FBQ3RCLGFBQVMsZ0JBQWdCLFlBQVksSUFBSTtBQUN6QyxXQUFPO0FBQUEsRUFDVDtBQUVBLFdBQVMsVUFBVTtBQUNqQixVQUFNLE9BQU87QUFDYixXQUFPO0FBQ1AsV0FBTztBQUFBLEVBQ1Q7QUFFQSxXQUFTLFNBQWlCO0FBQ3hCLFdBQU87QUFBQSxFQUNUO0FBRUEsV0FBUyxLQUFLLEdBQVcsR0FBVyxHQUFvQjtBQUN0RCxXQUFPLG9DQUFvQyxJQUFJLENBQUMsQ0FBQyx3QkFBd0IsSUFBSSxDQUFDLENBQUMsU0FBUyxJQUFJLGtCQUFrQixJQUFJLENBQUMsQ0FBQyxXQUFXLEVBQUU7QUFBQSxFQUNuSTtBQUVBLFdBQVMsV0FBV0MsT0FBYyxHQUEwQjtBQUMxRCxVQUFNLE9BQU8sRUFBRTtBQUNmLFVBQU0sSUFBSSxFQUFFO0FBQ1osVUFBTSxNQUFNLEVBQUU7QUFDZCxVQUFNLE9BQU8sRUFBRTtBQUNmLFVBQU0sUUFBUSxLQUFLLFFBQVEsbUJBQW1CLEtBQUssS0FBSyxJQUFJO0FBQzVELFVBQU0sT0FBTyxDQUFDLE9BQU8sS0FBSyxhQUFhLFNBQVksR0FBRyxLQUFLLFFBQVEsU0FBUyxNQUFNLEtBQUssa0JBQWtCLEtBQUssWUFBWSxJQUFJLEVBQUUsT0FBTyxPQUFPLEVBQUUsS0FBSyxRQUFLO0FBRTFKLFVBQU0sUUFBa0IsQ0FBQztBQUN6QixRQUFJLEtBQUssV0FBVyxXQUFXO0FBQzdCLFlBQU0sVUFBVSxLQUFLLE9BQU8sV0FBVyxVQUFVLEtBQUssTUFBTSxTQUFTO0FBQ3JFLFlBQU0sVUFBVSxLQUFLLE9BQU8sRUFBRSxXQUFXLE9BQU87QUFDaEQsWUFBTSxPQUFPLFdBQVcsVUFBVSxLQUFLLE9BQVEsVUFBVSxXQUFXLFVBQVcsR0FBRyxJQUFJO0FBQ3RGLFlBQU0sS0FBSyxLQUFLLGtCQUFrQixVQUFVLEdBQUcsSUFBSSxPQUFPLENBQUMsYUFBYSxVQUFLLFVBQVUsZ0JBQWdCLElBQUksT0FBTyxDQUFDLEdBQUcsU0FBUyxPQUFPLEtBQUssT0FBTyxJQUFJLE1BQU0sRUFBRSxHQUFHLElBQUksT0FBTyxFQUFFLEtBQUssa0JBQWtCLENBQUM7QUFBQSxJQUN4TSxPQUFPO0FBQ0wsWUFBTSxLQUFLLEtBQUsscUJBQXFCLE1BQU0sSUFBSSxJQUFJLFlBQVksSUFBSSxVQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sR0FBRyxJQUFJLElBQUksR0FBRyxDQUFDLGFBQWEsRUFBRSxHQUFHLElBQUksY0FBYyxPQUFPLFNBQU0sS0FBSyxNQUFNLElBQUksU0FBUyxDQUFDLFdBQVcsRUFBRSxLQUFLLGtCQUFrQixDQUFDO0FBQUEsSUFDM047QUFDQSxVQUFNLEtBQUssS0FBSyxjQUFjLE1BQU0sVUFBVSxRQUFRLE1BQU0sVUFBVSxTQUFZLEdBQUcsS0FBSyxLQUFLLFNBQU0sS0FBSyxTQUFTLEVBQUUsS0FBSyxVQUFLLE9BQU8sR0FBRyxLQUFLLElBQUksR0FBRyxLQUFLLGNBQWMsU0FBTSxLQUFLLFlBQVksS0FBSyxpQkFBaUIsRUFBRSxLQUFLLE1BQVMsQ0FBQztBQUN0TyxRQUFJLEtBQUssV0FBVyxVQUFVO0FBQzVCLFlBQU0sS0FBSyxFQUFFLFVBQVUsS0FBSyxzQkFBc0IsSUFBSSxFQUFFLFFBQVEsYUFBYSxHQUFHLEdBQUcsSUFBSSxFQUFFLFFBQVEsR0FBRyxDQUFDLGlCQUFjLEtBQUssTUFBTSxFQUFFLFFBQVEsWUFBWSxHQUFHLENBQUMsVUFBTyxFQUFFLFFBQVEsV0FBVyxVQUFVLElBQUksS0FBSyxnQkFBZ0IsZUFBZSwrQkFBK0IsQ0FBQztBQUFBLElBQ3hRLFdBQVcsTUFBTSxPQUFPO0FBQ3RCLFlBQU0sS0FBSyxLQUFLLFNBQVMsS0FBSyxNQUFNLE9BQU8sS0FBSyxnQkFBZ0IsR0FBRyxLQUFLLGNBQWMsS0FBSyw4QkFBOEIsTUFBUyxDQUFDO0FBQUEsSUFDckk7QUFDQSxVQUFNLEtBQUssS0FBSyxhQUFhLE1BQU0sVUFBVSxXQUFXLHVCQUF1QixxQkFBcUIsTUFBTSxVQUFVLFdBQVcsMkJBQTJCLHFCQUFxQixlQUFlLE1BQU0sVUFBVSxRQUFRLENBQUM7QUFFdk4sUUFBSSxPQUFPO0FBQ1gsVUFBTSxJQUFJLEVBQUU7QUFDWixRQUFJLEdBQUcsU0FBUyxXQUFZLFFBQU8sd0JBQXdCLElBQUksRUFBRSxXQUFXLENBQUMsYUFBYSxFQUFFLGNBQWMsUUFBUSxDQUFDLENBQUMsK0JBQTRCLElBQUksRUFBRSxlQUFlLENBQUMseUNBQXNDLEVBQUUsY0FBYyxNQUFNLElBQUksRUFBRSxzQkFBc0IsQ0FBQztBQUMvUCxRQUFJLEdBQUcsU0FBUyxlQUFnQixRQUFPLHFDQUFxQyxJQUFJLEVBQUUsaUJBQWlCLENBQUMsaUJBQWlCLElBQUksRUFBRSxhQUFhLENBQUMsc0JBQXNCLEVBQUUsMEJBQTBCLE9BQU8sbUJBQWdCLEtBQUssTUFBTSxFQUFFLHFCQUFxQixDQUFDLGdCQUFnQixFQUFFO0FBRXZRLFVBQU0sU0FBUyxHQUFHQSxLQUFJLHFCQUFxQixtQkFBbUIsS0FBSyxZQUFZLENBQUM7QUFDaEYsVUFBTSxXQUFXLEVBQUUsbUJBQW1CLEdBQUdBLEtBQUksa0NBQWtDLG1CQUFtQixFQUFFLGdCQUFnQixDQUFDLEtBQUssR0FBR0EsS0FBSSxrQkFBa0IsbUJBQW1CLEtBQUssWUFBWSxDQUFDO0FBQ3hMLFdBQU8sR0FBRyxPQUFPLENBQUM7QUFBQSx5QkFDSyxJQUFJLEtBQUssS0FBSyxDQUFDO0FBQUEsd0JBQ2hCLElBQUksSUFBSSxDQUFDO0FBQUEseUJBQ1IsTUFBTSxLQUFLLEVBQUUsQ0FBQztBQUFBLE1BQ2pDLElBQUk7QUFBQTtBQUFBLDZCQUVtQixJQUFJLE1BQU0sQ0FBQztBQUFBLHVDQUNELElBQUksUUFBUSxDQUFDO0FBQUE7QUFBQSx3QkFFNUIsRUFBRSxtQkFBbUIsNkJBQTZCLEVBQUUsR0FBRyxFQUFFLFVBQVUsd0NBQXdDLEVBQUUsR0FBRyxNQUFNLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBO0FBQUEsRUFFaEs7QUFFQSxXQUFTLE9BQU8sT0FBY0EsT0FBYztBQUMxQyxRQUFJLGNBQWMsV0FBWTtBQUM5QixVQUFNLElBQUksTUFBTTtBQUNoQixRQUFJLE9BQU87QUFDWCxVQUFNLFNBQVMsaUJBQWlCLFVBQVUsR0FBRztBQUM3QyxVQUFNLFFBQVEsU0FBUyxjQUFjLE1BQU0sSUFBSTtBQUMvQyxZQUFRLE1BQU0sTUFBTTtBQUFBLE1BQ2xCLEtBQUs7QUFDSCxlQUFPLEdBQUcsT0FBTyxDQUFDLDhNQUEyTSxJQUFJLEtBQUssQ0FBQztBQUN2TztBQUFBLE1BQ0YsS0FBSztBQUNILGVBQU8sR0FBRyxPQUFPLENBQUM7QUFDbEI7QUFBQSxNQUNGLEtBQUs7QUFDSCxlQUFPLFdBQVdBLE9BQU0sTUFBTSxJQUFJO0FBQ2xDO0FBQUEsTUFDRixLQUFLO0FBQ0gsZUFBTyxHQUFHLE9BQU8sQ0FBQywyRkFBMkYsSUFBSSxNQUFNLE9BQU8sQ0FBQyxTQUFTLE1BQU0sYUFBYSx3QkFBd0IsSUFBSUEsUUFBTyxNQUFNLFVBQVUsQ0FBQyxpREFBaUQsMkNBQTJDLE1BQU0sU0FBUyxXQUFXLFVBQVUsT0FBTyxzQkFBc0I7QUFDNVc7QUFBQSxNQUNGLEtBQUs7QUFDSCxlQUNFLE1BQU0sV0FBVyxrQkFDYixHQUFHLE9BQU8sQ0FBQywyUUFBMlEsSUFBSUEsS0FBSSxDQUFDLGlGQUMvUixHQUFHLE9BQU8sQ0FBQyxxTUFBcU0sSUFBSUEsS0FBSSxDQUFDO0FBQy9OO0FBQUEsSUFDSjtBQUNBLFFBQUksTUFBTSxFQUFFLGNBQWMsTUFBTTtBQUNoQyxRQUFJLENBQUMsS0FBSztBQUNSLFlBQU0sU0FBUyxjQUFjLEtBQUs7QUFDbEMsVUFBSSxZQUFZO0FBQ2hCLFFBQUUsWUFBWSxHQUFHO0FBQ2pCLFVBQUksaUJBQWlCLFNBQVMsQ0FBQyxNQUFNO0FBQ25DLGNBQU0sSUFBSyxFQUFFLE9BQXVCLFFBQVEsWUFBWTtBQUN4RCxZQUFJLENBQUMsRUFBRztBQUNSLFlBQUksRUFBRSxRQUFRLFFBQVEsU0FBUztBQUM3QixzQkFBWTtBQUNaLGtCQUFRO0FBQUEsUUFDVjtBQUNBLFlBQUksRUFBRSxRQUFRLFFBQVEsUUFBUyxNQUFLLFNBQVM7QUFDN0MsWUFBSSxFQUFFLFFBQVEsUUFBUSxRQUFTLE1BQUssTUFBTSxJQUFJO0FBQUEsTUFDaEQsQ0FBQztBQUFBLElBQ0g7QUFDQSxRQUFJLFlBQVk7QUFBQSxFQUNsQjtBQUVBLE1BQUksT0FBTztBQUVYLGlCQUFlLFdBQVc7QUFDeEIsV0FBTyxFQUFFLE1BQU0sT0FBTyxHQUFHLElBQUk7QUFDN0IsUUFBSTtBQUNGLFlBQU0sTUFBTSxNQUFNLEtBQWtCLEVBQUUsTUFBTSxTQUFTLEtBQUssWUFBWSxNQUFNLFNBQVMsZ0JBQWdCLFVBQVUsQ0FBQztBQUNoSCxVQUFJLElBQUksR0FBSSxRQUFPLEVBQUUsTUFBTSxVQUFVLE1BQU0sSUFBSSxLQUFLLEdBQUcsSUFBSTtBQUFBLGVBQ2xELElBQUksTUFBTSxTQUFTLGdCQUFpQixRQUFPLEVBQUUsTUFBTSxVQUFVLE1BQU0sUUFBUSxnQkFBZ0IsR0FBRyxJQUFJO0FBQUEsZUFDbEcsSUFBSSxNQUFNLFNBQVMsWUFBYSxRQUFPLEVBQUUsTUFBTSxVQUFVLE1BQU0sUUFBUSxZQUFZLEdBQUcsSUFBSTtBQUFBLFVBQzlGLFFBQU8sRUFBRSxNQUFNLFNBQVMsU0FBUyxJQUFJLE1BQU0sT0FBTyxNQUFNLElBQUksTUFBTSxNQUFNLFlBQVksSUFBSSxNQUFNLFdBQVcsR0FBRyxJQUFJO0FBQUEsSUFDdkgsU0FBUyxLQUFLO0FBQ1osYUFBTyxFQUFFLE1BQU0sU0FBUyxTQUFVLElBQWMsV0FBVywyQkFBMkIsR0FBRyxJQUFJO0FBQUEsSUFDL0Y7QUFBQSxFQUNGO0FBRUEsaUJBQWUsTUFBTSxRQUFRLE9BQU87QUFDbEMsVUFBTSxXQUFXLGlCQUFpQixTQUFTLElBQUk7QUFDL0MsUUFBSSxDQUFDLFVBQVU7QUFDYixjQUFRO0FBQ1I7QUFBQSxJQUNGO0FBRUEsUUFBSSxDQUFDLFNBQVMsU0FBUyxpQkFBaUIsV0FBWTtBQUNwRCxpQkFBYSxTQUFTO0FBQ3RCLFFBQUksY0FBYyxXQUFZO0FBQzlCLFFBQUk7QUFDRixZQUFNLEtBQUssTUFBTSxLQUFtQixFQUFFLE1BQU0sU0FBUyxDQUFDO0FBQ3RELGFBQU8sR0FBRztBQUNWLFVBQUksQ0FBQyxHQUFHLFVBQVcsUUFBTyxFQUFFLE1BQU0sVUFBVSxNQUFNLFFBQVEsZ0JBQWdCLEdBQUcsSUFBSTtBQUFBLGVBQ3hFLEdBQUcsT0FBTyxLQUFNLFFBQU8sRUFBRSxNQUFNLFNBQVMsU0FBUyxHQUFHLE9BQU8sTUFBTSxTQUFTLEdBQUcsSUFBSTtBQUFBLGVBQ2pGLEdBQUcsR0FBRyxVQUFVLEtBQU0sUUFBTyxFQUFFLE1BQU0sVUFBVSxNQUFNLFFBQVEsWUFBWSxHQUFHLElBQUk7QUFBQSxVQUNwRixRQUFPLEVBQUUsTUFBTSxPQUFPLEdBQUcsSUFBSTtBQUFBLElBQ3BDLFNBQVMsS0FBSztBQUNaLGFBQU8sRUFBRSxNQUFNLFNBQVMsU0FBVSxJQUFjLFdBQVcsa0NBQWtDLE1BQU0sU0FBUyxHQUFHLElBQUk7QUFBQSxJQUNySDtBQUFBLEVBQ0Y7QUFFQSxPQUFLLE1BQU07QUFFWCxNQUFJLFdBQVcsU0FBUztBQUN4QixjQUFZLE1BQU07QUFDaEIsUUFBSSxTQUFTLFNBQVMsU0FBVTtBQUNoQyxlQUFXLFNBQVM7QUFDcEIsU0FBSyxNQUFNO0FBQUEsRUFDYixHQUFHLEdBQUk7IiwKICAibmFtZXMiOiBbImhvc3QiLCAic2l0ZSJdCn0K
