// Small pages the desktop app serves itself (they live under <site>/__rojey/ so they can
// read the POS's own local order database, which belongs to the website's address).

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE = `
  :root{--brand:#7367f0;--ok:#1e9e5a;--warn:#c77700;--line:#e3e5ea;--muted:#6b7280}
  *{box-sizing:border-box} body{margin:0;font-family:"Segoe UI",system-ui,sans-serif;background:#f5f6fa;color:#1f2430;font-size:14px}
  header{background:var(--brand);color:#fff;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
  header h1{margin:0;font-size:19px;font-weight:600}
  a.btn,button{display:inline-block;padding:9px 14px;border-radius:7px;border:1px solid #cfd3dc;background:#fff;color:#1f2430;text-decoration:none;cursor:pointer;font-size:14px}
  header a.btn,header button{border-color:rgba(255,255,255,.6);background:rgba(255,255,255,.12);color:#fff}
  main{padding:18px 24px}
  .card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin-bottom:14px}
  .center{max-width:520px;margin:60px auto;text-align:center}
`;

function shell(title, body, base) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body><header><h1>${esc(title)}</h1><span><a class="btn" href="${esc(base)}Sale/POS">Open POS</a></span></header>${body}</body></html>`;
}

function noCopyPage(url, base) {
  return shell('Rojey POS — no internet', `<div class="card center">
    <h2>This screen hasn't been saved on this computer yet</h2>
    <p>There's no internet connection right now, and this page was never opened here while online.</p>
    <p>The POS screen itself works offline once it has been opened online one time.</p>
    <p><a class="btn" href="${esc(base)}Sale/POS">Go to the POS</a> &nbsp; <a class="btn" href="javascript:location.reload()">Try again</a></p>
  </div>`, base);
}

function needsInternetPage(base) {
  return shell('Rojey POS — needs internet', `<div class="card center">
    <h2>This needs the internet</h2>
    <p>You're offline, so this action can't reach the website. Taking orders and billing still work on the POS screen, and they'll upload by themselves when the connection is back.</p>
    <p><a class="btn" href="${esc(base)}Sale/POS">Back to the POS</a></p>
  </div>`, base);
}

function loginFailedPage(base) {
  return shell('Rojey POS — sign in offline', `<div class="card center">
    <h2>Couldn't sign in without internet</h2>
    <p>Offline, you can only sign in with an email/password or PIN that has already signed in on <b>this computer</b> while it was online.</p>
    <p>Check the details and try again, or wait for the connection.</p>
    <p><a class="btn" href="${esc(base)}Authentication/index">Back to sign in</a></p>
  </div>`, base);
}

function offlineSalesPage(c) {
  const user = c.currentUserKey && c.store.sec.offlineUsers[c.currentUserKey];
  const designation = user ? user.designation || '' : '';
  const isAdmin = /admin/i.test(designation);
  if (user && designation && !isAdmin) {
    return shell('Offline sales', `<div class="card center"><h2>Admins only</h2>
      <p>Sign in with an admin account to see the sales kept on this computer.</p>
      <p><a class="btn" href="${esc(c.base)}Authentication/logOut">Sign in as admin</a></p></div>`, c.base);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Offline sales</title><style>${STYLE}
  .bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
  .bar input.t{width:64px;text-align:center}
  .bar input,.bar select{padding:8px 10px;border:1px solid #cfd3dc;border-radius:7px;font-size:14px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:14px}
  .stat{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .stat b{display:block;font-size:22px;margin-top:4px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{background:#fafbfc;font-size:13px;color:var(--muted);font-weight:600}
  td.num,th.num{text-align:right;white-space:nowrap}
  .pill{display:inline-block;padding:2px 9px;border-radius:20px;font-size:12px;font-weight:600}
  .pill.ok{background:#e6f6ee;color:var(--ok)} .pill.wait{background:#fff3df;color:var(--warn)} .pill.open{background:#eef0ff;color:var(--brand)}
  .items{color:var(--muted);font-size:13px}
  .empty{padding:30px;text-align:center;color:var(--muted)}
  #net{font-size:13px}
  </style></head><body>
  <header><h1>Offline sales on this computer</h1>
    <span><span id="net"></span> &nbsp; <button id="check">Check connection</button> <a class="btn" href="${esc(c.base)}Sale/POS">Open POS</a></span></header>
  <main>
    <div class="bar">
      <label>From <input type="date" id="fromDay"> <input type="text" id="fromTime" class="t" value="00:00" maxlength="5" placeholder="HH:MM"></label>
      <label>To <input type="date" id="toDay"> <input type="text" id="toTime" class="t" value="23:59" maxlength="5" placeholder="HH:MM"></label>
      <label>Show <select id="filter">
        <option value="all">All orders</option>
        <option value="wait">Waiting to upload</option>
        <option value="ok">Uploaded</option>
        <option value="open">Open (not yet paid)</option>
      </select></label>
      <button id="today">Today</button>
      <button id="last24">Last 24 hours</button>
      <button id="allDays">All</button>
      <span id="range" class="items"></span>
    </div>
    <div class="stats">
      <div class="stat">Orders<b id="sCount">0</b></div>
      <div class="stat">Total sales<b id="sTotal">0</b></div>
      <div class="stat">Waiting to upload<b id="sWait">0</b></div>
      <div class="stat">Open orders<b id="sOpen">0</b></div>
    </div>
    <table><thead><tr><th>Order no.</th><th>Time</th><th>Type</th><th>Customer / table</th><th>Items</th><th>Cashier</th><th class="num">Total</th><th>Status</th></tr></thead>
    <tbody id="rows"><tr><td colspan="8" class="empty">Loading…</td></tr></tbody></table>
    <p class="items" style="margin-top:12px">Every order taken on this computer is kept in the app's own database, even after it has uploaded. Uploaded orders are also on the website. Orders waiting to upload go up by themselves as soon as there is internet.</p>
  </main>
  <script>
  (function(){
    var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
    var money=function(n){n=Number(n)||0;return n.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2});};
    var TYPES={'1':'Dine in','2':'Take away','3':'Delivery'};
    var $=function(id){return document.getElementById(id);};
    var filterEl=$('filter');
    var pad=function(n){return String(n).padStart(2,'0');};
    var dstr=function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
    var tstr=function(d){return pad(d.getHours())+':'+pad(d.getMinutes());};
    function setRange(from,to){ $('fromDay').value=from?dstr(from):''; $('fromTime').value=from?tstr(from):'00:00'; $('toDay').value=to?dstr(to):''; $('toTime').value=to?tstr(to):'23:59'; }
    function todayRange(){ var a=new Date(); a.setHours(0,0,0,0); var b=new Date(); b.setHours(23,59,0,0); setRange(a,b); }
    function cleanTime(v,def){ var m=String(v||'').trim().match(/^(\\d{1,2})[:.]?(\\d{2})?$/); if(!m) return def; var h=Math.min(23,Number(m[1])), mi=Math.min(59,Number(m[2]||0)); return pad(h)+':'+pad(mi); }
    todayRange();
    var all=[];
    function parse(rec, store){
      var o={}; try{o=typeof rec.order==='string'?JSON.parse(rec.order):(rec.order||{});}catch(e){}
      var items=(o.items||[]).map(function(i){return (i.qty||i.item_quantity||1)+' × '+(i.menu_name||i.item_name||'');});
      var status = store==='sales' ? 'open' : (Number(rec.online_push)===1?'ok':'wait');
      var dt=String(o.date_time||o.sale_date||'').replace('T',' ');
      if(/^\\d{4}-\\d{2}-\\d{2}T/.test(String(o.date_time||''))){ var d0=new Date(o.date_time); if(!isNaN(d0)) dt=dstr(d0)+' '+tstr(d0)+':'+pad(d0.getSeconds()); }
      return {no:o.sale_no||rec.sale_no||'', dt:dt, day:String(o.sale_date||dt).slice(0,10), type:TYPES[String(o.order_type)]||o.order_type||'',
        who:[o.customer_name,o.orders_table_text||o.selected_table].filter(Boolean).join(' · '), items:items, cashier:o.user_name||'',
        total:Number(o.total_payable)||0, status:status};
    }
    function load(){
      if(window.rojeyDesktop && window.rojeyDesktop.listOrders){
        window.rojeyDesktop.listOrders({limit:10000}).then(function(rows){
          all=rows.map(function(r){ var x=parse({order:r.order_json, online_push:r.status==='synced'?1:0}, r.kind==='open'?'sales':'recent_sales'); if(r.date_time) x.dt=r.date_time; return x; });
          render();
        });
        return;
      }
      var rq=indexedDB.open('irestora_plus',1);
      rq.onupgradeneeded=function(e){var db=e.target.result;['sales','future_sales','recent_sales','order_tables','invoice_date_table'].forEach(function(n){if(!db.objectStoreNames.contains(n))db.createObjectStore(n,{keyPath:'sales_id',autoIncrement:true});});};
      rq.onerror=function(){document.getElementById('rows').innerHTML='<tr><td colspan="8" class="empty">Could not open the local order database.</td></tr>';};
      rq.onsuccess=function(){
        var db=rq.result; all=[]; var pending=2;
        ['recent_sales','sales'].forEach(function(s){
          var c=db.transaction(s).objectStore(s).openCursor();
          c.onsuccess=function(e){var cur=e.target.result;if(cur){all.push(parse(cur.value,s));cur.continue();}else if(--pending===0){render();}};
          c.onerror=function(){if(--pending===0)render();};
        });
      };
    }
    function render(){
      $('fromTime').value=cleanTime($('fromTime').value,'00:00'); $('toTime').value=cleanTime($('toTime').value,'23:59');
      var from=$('fromDay').value?$('fromDay').value+' '+$('fromTime').value+':00':'';
      var to=$('toDay').value?$('toDay').value+' '+$('toTime').value+':59':'';
      var f=filterEl.value;
      $('range').textContent=(from||to)?('Showing '+(from?from.slice(0,16):'the start')+' to '+(to?to.slice(0,16):'now')):'Showing all dates';
      var list=all.filter(function(r){return (!from||r.dt>=from)&&(!to||r.dt<=to)&&(f==='all'||r.status===f);}).sort(function(a,b){return a.dt<b.dt?1:-1;});
      var paid=list.filter(function(r){return r.status!=='open';});
      document.getElementById('sCount').textContent=paid.length;
      document.getElementById('sTotal').textContent=money(paid.reduce(function(a,r){return a+r.total;},0));
      document.getElementById('sWait').textContent=list.filter(function(r){return r.status==='wait';}).length;
      document.getElementById('sOpen').textContent=list.filter(function(r){return r.status==='open';}).length;
      var label={ok:'<span class="pill ok">Uploaded</span>',wait:'<span class="pill wait">Waiting to upload</span>',open:'<span class="pill open">Open</span>'};
      document.getElementById('rows').innerHTML = list.length ? list.map(function(r){
        return '<tr><td>'+esc(r.no)+'</td><td style="white-space:nowrap">'+esc(String(r.dt).slice(0,16))+'</td><td>'+esc(r.type)+'</td><td>'+esc(r.who)+'</td><td class="items">'+r.items.map(esc).join('<br>')+'</td><td>'+esc(r.cashier)+'</td><td class="num">'+money(r.total)+'</td><td>'+label[r.status]+'</td></tr>';
      }).join('') : '<tr><td colspan="8" class="empty">No orders for this choice.</td></tr>';
    }
    ['fromDay','fromTime','toDay','toTime'].forEach(function(id){$(id).onchange=render;});
    filterEl.onchange=render;
    $('today').onclick=function(){todayRange();render();};
    $('last24').onclick=function(){var b=new Date(); var a=new Date(b.getTime()-24*3600*1000); setRange(a,b); render();};
    $('allDays').onclick=function(){setRange(null,null);render();};
    function showNet(){ if(!window.rojeyDesktop) return; window.rojeyDesktop.status().then(function(s){document.getElementById('net').textContent=s.online?'● Online':'● Offline';}); }
    document.getElementById('check').onclick=function(){ if(window.rojeyDesktop) window.rojeyDesktop.checkNow().then(showNet); load(); };
    showNet(); setInterval(showNet,5000); load(); setInterval(load,15000);
  })();
  </script></body></html>`;
}

function serve(name, c) {
  const html = name.startsWith('offline-sales') ? offlineSalesPage(c) : noCopyPage('', c.base);
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

module.exports = { serve, noCopyPage, needsInternetPage, loginFailedPage };
