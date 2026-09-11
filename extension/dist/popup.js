"use strict";(()=>{var c="https://intelligence.stayful.co.uk";function n(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function o(e){return new Promise((t,s)=>{chrome.runtime.sendMessage(e,r=>{chrome.runtime.lastError?s(new Error(chrome.runtime.lastError.message)):t(r)})})}var l=document.getElementById("app");function p(e){let t=e.me;if(!t)return`
    <p><strong>Connected</strong>, but Stayful could not be reached.</p>
    <p class="err">${n(e.error)}</p>
    <button class="cta secondary" id="retry">Try again</button>
    <button class="cta secondary" id="disconnect">Disconnect</button>`;let s=t.plan==="pro"?"Pro":t.runsRemaining!==null?`Trial \xB7 ${t.runsRemaining} free report${t.runsRemaining===1?"":"s"} left`:"Member";return`
    <p><strong>Connected</strong>${t.email?` as ${n(t.email)}`:""}</p>
    <p class="muted">${n(s)}${t.state!=="ok"?" \xB7 your plan does not include listing checks":""}</p>
    <p class="muted">Open a Rightmove, Zoopla, OnTheMarket, Airbnb or Booking.com listing and click <em>Check</em> in the Stayful bar.</p>
    <a class="cta" href="${n(e.site)}/markets?pane=listings" target="_blank" rel="noopener">Open my pipeline</a>
    <button class="cta secondary" id="disconnect">Disconnect</button>`}function u(e){return`
    <p><strong>Not connected</strong></p>
    <p class="muted">Connect the extension to your Stayful account to see revenue estimates on listing pages.</p>
    <a class="cta" href="${n(e)}/extension/connect" target="_blank" rel="noopener">Connect on Stayful</a>
    <label>Or paste a connection token<input id="token" type="password" placeholder="sfx_\u2026" autocomplete="off" /></label>
    <details><summary>Advanced</summary><label>Stayful site<input id="site" value="${n(e)}" /></label></details>
    <button class="cta" id="save">Save token</button>
    <div id="msg"></div>`}async function i(){let e;try{e=await o({type:"status"})}catch(t){l.innerHTML=`<p class="err">${n(t.message)}</p>`;return}l.innerHTML=e.connected?p(e):u(e.site||c),document.getElementById("retry")?.addEventListener("click",()=>{i()}),document.getElementById("disconnect")?.addEventListener("click",async()=>{await o({type:"disconnect"}),i()}),document.getElementById("save")?.addEventListener("click",async()=>{let t=document.getElementById("token").value.trim(),s=document.getElementById("site").value.trim(),r=document.getElementById("msg");if(!t){r.innerHTML='<p class="err">Paste the token from the connect page first.</p>';return}let a=await o({type:"setToken",token:t,site:s});a.ok?i():r.innerHTML=`<p class="err">${n(a.error??"That token was not accepted.")}</p>`})}i();})();
