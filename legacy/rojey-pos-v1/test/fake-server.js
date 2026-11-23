// A tiny stand-in for the iRestora website, for automated tests only.
const http = require('http');
const crypto = require('crypto');
function start(port) {
  const st = { sessions: new Set(), logins: 0, pushes: [], pushCount: {}, up: true };
  const users = { 'admin@x.com': { pw: 'secret', designation: 'Admin', name: 'Admin User' }, 'cash@x.com': { pw: 'cash1', designation: 'Cashier', name: 'Cash Ier' } };
  const sessOf = {};
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => body += d); req.on('end', () => {
      const cookie = (req.headers.cookie || '').match(/sess=([a-f0-9]+)/);
      const sid = cookie && st.sessions.has(cookie[1]) ? cookie[1] : null;
      const u = req.url.split('?')[0];
      const send = (code, headers, b) => { res.writeHead(code, headers); res.end(b || ''); };
      if (u === '/Authentication/check_internet') return send(200, { 'content-type': 'text/html' }, 'sccess');
      if (u === '/Authentication/index' || u === '/') return send(200, { 'content-type': 'text/html' }, `<html><body><h1 id="loginpage">Login</h1><form method="post" action="/Authentication/loginCheck"><input type="hidden" name="login_pin" value=""><input type="hidden" name="active_login_button_hidden" value="1"><input name="email_address"><input type="password" name="password"><button type="submit" name="submit" value="submit">Login</button></form></body></html>`);
      if (u === '/Authentication/loginCheck' && req.method === 'POST') {
        const f = Object.fromEntries(new URLSearchParams(body));
        const usr = users[f.email_address];
        if (!usr || usr.pw !== f.password) return send(303, { location: '/Authentication/index' });
        const s = crypto.randomBytes(8).toString('hex'); st.sessions.add(s); sessOf[s] = usr; st.logins++;
        return send(303, { 'set-cookie': `sess=${s}; Path=/; Max-Age=7200; HttpOnly`, location: '/Sale/POS' });
      }
      if (u === '/Authentication/logOut') { if (sid) st.sessions.delete(sid); return send(302, { location: '/Authentication/index' }); }
      if (u === '/frequent_changing/js/pos_script_v7.3.js') return send(200, { 'content-type': 'application/javascript' }, require('fs').readFileSync(__dirname + '/fake-pos-script.js'));
      if (u.startsWith('/assets/')) return send(200, { 'content-type': 'application/javascript' }, 'window.__assetLoaded = true;');
      if (!sid) return send(302, { location: '/Authentication/index' });
      const usr = sessOf[sid];
      if (u === '/Sale/POS') return send(200, { 'content-type': 'text/html' }, `<html><head><script src="/assets/app.js?v=1"></script></head><body>
        <div id="posmarker">POS for ${usr.name}</div>
        <input type="hidden" id="loggedin_designation" value="${usr.designation}">
        <input type="hidden" id="user_name" value="${usr.name}">
        <input type="hidden" id="is_offline_system" value="1">
        <button id="sync_online">sync</button>
        <div class="holder"><div class="order_details"><div class="single_order" data-selected="selected"><span class="running_order_order_number">K-77</span></div></div></div>
        <div class="invoice_box_kot"><button class="kot_btn_class" data-type="1">All</button><button class="kot_btn_class" data-type="2">New</button></div>
        <button class="print_kot_button" id="kotbtn">KOT</button>
        <a id="logoutlink" href="/Authentication/logOut" style="display:inline-block;padding:10px">Logout</a>
        <div id="kot_list_modal" class="modal"><button id="print_kot_modal">Print KOT</button></div>
        <script>
          window.dbReady = new Promise(function(res){ var rq=indexedDB.open('irestora_plus',1);
            rq.onupgradeneeded=function(e){var db=e.target.result;['sales','future_sales','recent_sales','order_tables','invoice_date_table'].forEach(function(n){db.createObjectStore(n,{keyPath:'sales_id',autoIncrement:true});});};
            rq.onsuccess=function(){res(rq.result);}; });
          window.pushAll = function(){ return dbReady.then(function(db){ return new Promise(function(done){
            var rows=[]; var c=db.transaction('recent_sales').objectStore('recent_sales').openCursor();
            c.onsuccess=function(e){var cur=e.target.result; if(cur){ if(cur.value.online_push===0) rows.push(cur.value); cur.continue(); } else {
              var chain=Promise.resolve();
              rows.forEach(function(r){ chain=chain.then(function(){ return fetch('/Sale/push_online',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},body:'orders='+encodeURIComponent(r.order)+'&sales_id='+r.sales_id}).then(function(x){return x.text();}).then(function(t){
                if(String(t)===String(r.sales_id)){ return new Promise(function(ok){ r.online_push=1; var tx=db.transaction('recent_sales','readwrite'); tx.objectStore('recent_sales').put(r); tx.oncomplete=ok; }); } }).catch(function(){}); }); });
              chain.then(function(){done(true);}); } };
          }); }); };
          window.onbeforeunload = function(){ return 'Are you sure you want to leave?'; };
          document.getElementById('sync_online').onclick=function(){ window.push_online_sync(); };
          window.addRunning = function(no){ return dbReady.then(function(db){ return new Promise(function(ok){ var tx=db.transaction('sales','readwrite');
            tx.objectStore('sales').add({sale_no:no,order:JSON.stringify({sale_no:no,items:[{menu_name:'Chips',qty:1}]})}); tx.oncomplete=ok; }); }); };
          window.addOrder = function(no){ return dbReady.then(function(db){ return new Promise(function(ok){ var tx=db.transaction('recent_sales','readwrite');
            tx.objectStore('recent_sales').add({order:JSON.stringify({sale_no:no,date_time:(function(d){var p=function(n){return String(n).padStart(2,'0')};return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds())})(new Date()),sale_date:new Date().toISOString().slice(0,10),order_type:2,total_payable:15000,user_name:'${usr.name}',items:[{menu_name:'Mango juice',qty:2}]}),online_push:0}); tx.oncomplete=ok; }); }); };
        </script><script src="/frequent_changing/js/pos_script_v7.3.js?v=7.6.20"></script></body></html>`);
      if (u === '/Sale/push_online' && req.method === 'POST') {
        const f = Object.fromEntries(new URLSearchParams(body));
        const o = JSON.parse(f.orders);
        st.pushCount[o.sale_no] = (st.pushCount[o.sale_no] || 0) + 1;
        if (!st.pushes.find((p) => p.sale_no === o.sale_no)) st.pushes.push({ sale_no: o.sale_no, by: usr.name });
        return send(200, { 'content-type': 'text/html' }, f.sales_id);
      }
      return send(404, {}, 'nf');
    });
  });
  srv.listen(port);
  st.expireAll = () => st.sessions.clear();
  st.stop = () => new Promise((r) => { st.up = false; srv.close(() => r()); srv.closeAllConnections && srv.closeAllConnections(); });
  st.start = () => new Promise((r) => { st.up = true; srv.listen(port, r); });
  return st;
}
module.exports = { start };
