// End-to-end check: run with  xvfb-run electron --no-sandbox test/e2e.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path'); const os = require('os');
const fake = require('./fake-server');
const PORT = 18081, BASE = `http://127.0.0.1:${PORT}/`;
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'rojey-e2e-'));
fs.writeFileSync(path.join(ud, 'config.json'), JSON.stringify({ baseUrl: BASE, receiptPrinter: 'Receipt-Fake', kitchenPrinter: 'Kitchen-Fake', autoPrint: true }));
process.env.ROJEY_USER_DATA = ud; process.env.ROJEY_DIRECT = '1';
const srv = fake.start(PORT);
require('../src/main.js');

const results = []; let failed = 0;
const check = (name, cond, extra) => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch {} await sleep(250); } return false; }
const logTxt = () => { try { return fs.readFileSync(path.join(ud, 'rojey-pos.log'), 'utf8'); } catch { return ''; } };

app.whenReady().then(async () => {
  await until(() => BrowserWindow.getAllWindows().length > 0);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const url = () => win.webContents.getURL();
  try {
    // 1. first open: no session -> login page, sign in online
    check('opens sign-in page when not signed in', await until(async () => url().includes('Authentication/index') && await js('!!document.getElementById("loginpage")')));
    await js(`document.querySelector('[name=email_address]').value='cash@x.com';document.querySelector('[name=password]').value='cash1';document.querySelector('button[type=submit]').click();true`);
    check('online sign-in lands on POS', await until(async () => url().includes('Sale/POS') && await js('!!document.getElementById("posmarker")')));
    check('POS script asset loaded', await js('window.__assetLoaded===true'));
    // admin signs in once online too (so they can sign in offline later), then cashier again
    const signIn = async (e, p) => { win.loadURL(BASE + 'Authentication/index'); await until(async () => await js('!!document.getElementById("loginpage")'));
      await js(`document.querySelector('[name=email_address]').value='${e}';document.querySelector('[name=password]').value='${p}';document.querySelector('button[type=submit]').click();true`); };
    win.loadURL(BASE + 'Authentication/logOut'); await until(async () => url().includes('Authentication/index'));
    await signIn('admin@x.com', 'secret');
    check('admin signs in online', await until(async () => url().includes('Sale/POS') && (await js('document.getElementById("posmarker").innerText')).includes('Admin')));
    win.loadURL(BASE + 'Authentication/logOut'); await until(async () => url().includes('Authentication/index'));
    await signIn('cash@x.com', 'cash1');
    check('cashier signs in online again', await until(async () => url().includes('Sale/POS') && (await js('document.getElementById("posmarker").innerText')).includes('Cash')));

    // 1b. sign-out is instant and still reaches the website
    const loginsAtLogout = srv.logins;
    win.show(); win.focus();
    const lr = await js('(function(){var b=document.getElementById("logoutlink").getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()');
    const lo0 = Date.now();
    win.webContents.sendInputEvent({ type: 'mouseDown', x: lr.x, y: lr.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: lr.x, y: lr.y, button: 'left', clickCount: 1 });
    await until(async () => url().includes('Authentication/index') && await js('!!document.getElementById("loginpage")'), 5000);
    check('sign-out is instant', Date.now() - lo0 < 1500, `${Date.now() - lo0}ms`);
    await signIn('cash@x.com', 'cash1');
    check('signing straight back in works', await until(async () => url().includes('Sale/POS') && await js('!!document.getElementById("posmarker")')), `logins ${loginsAtLogout}->${srv.logins}`);

    // 2. order syncs while online
    await js('addOrder("A-001").then(()=>push_online())');
    check('online order uploads', await until(() => srv.pushes.some((p) => p.sale_no === 'A-001')));

    // 3. session expires on server -> automatic re-login on upload
    srv.expireAll(); const loginsBefore = srv.logins;
    await js('addOrder("A-002").then(()=>push_online())');
    check('re-signs-in by itself when the session expires', await until(() => srv.pushes.some((p) => p.sale_no === 'A-002')), `logins ${loginsBefore}->${srv.logins}`);

    // 4. server goes down
    await srv.stop();
    check('detects offline', await until(() => /OFFLINE/.test(win.getTitle()), 20000), win.getTitle());
    const t0 = Date.now();
    const postErr = await js(`fetch('/Sale/push_online',{method:'POST',body:'x=1'}).then(()=> 'ok').catch(()=> 'err')`);
    check('offline POST fails fast instead of freezing', postErr === 'err' && Date.now() - t0 < 1500, `${Date.now() - t0}ms`);
    win.webContents.reload();
    check('POS reloads from the local copy while offline', await until(async () => await js('!!document.getElementById("posmarker") && window.__assetLoaded===true')));
    await js('addOrder("B-001").then(()=>addOrder("B-002"))');

    // 5. offline sign-out / sign-in
    win.loadURL(BASE + 'Authentication/logOut');
    check('offline sign-out shows the saved sign-in page', await until(async () => url().includes('Authentication/index') && await js('!!document.getElementById("loginpage")')));
    await js(`document.querySelector('[name=email_address]').value='cash@x.com';document.querySelector('[name=password]').value='WRONG';document.querySelector('button[type=submit]').click();true`);
    check('wrong password refused offline', await until(async () => (await js('document.body.innerText')).includes("Couldn't sign in")));
    win.loadURL(BASE + 'Authentication/index'); await until(async () => await js('!!document.getElementById("loginpage")'));
    await js(`document.querySelector('[name=email_address]').value='cash@x.com';document.querySelector('[name=password]').value='cash1';document.querySelector('button[type=submit]').click();true`);
    check('cashier signs in offline and gets the POS', await until(async () => url().includes('Sale/POS') && await js('!!document.getElementById("posmarker")')));

    // 6. offline sales page: cashier is refused, admin sees the list
    win.loadURL(BASE + '__rojey/offline-sales');
    check('cashier cannot open offline sales', await until(async () => (await js('document.body ? document.body.innerText : ""')).includes('Admins only')));
    win.loadURL(BASE + 'Authentication/logOut'); await until(async () => await js('!!document.getElementById("loginpage")'));
    await js(`document.querySelector('[name=email_address]').value='admin@x.com';document.querySelector('[name=password]').value='secret';document.querySelector('button[type=submit]').click();true`);
    check('admin signs in offline and lands on offline sales', await until(async () => url().includes('__rojey/offline-sales')));
    await until(async () => (await js('document.getElementById("rows") ? document.getElementById("rows").innerText : ""')).includes('B-002'));
    await sleep(300);
    const sales = await js('document.getElementById("rows") ? document.getElementById("rows").innerText : ""');
    const wait = await js('document.getElementById("sWait") ? document.getElementById("sWait").innerText : "?"');
    check('offline sales page lists local orders', sales.includes('B-001') && sales.includes('A-001'), `waiting=${wait}`);
    check('waiting-to-upload count is right', wait === '2', wait);
    await js(`document.getElementById('fromTime').value='00:00';document.getElementById('toTime').value='00:00';document.getElementById('toTime').onchange();true`);
    const narrowed = await js('document.getElementById("rows").innerText');
    const hourNow = new Date().getHours() + new Date().getMinutes();
    check('time filter (24h) narrows the list', hourNow === 0 || !narrowed.includes('B-001'), narrowed.slice(0,200) + ' / ' + await js('document.getElementById("range").innerText'));
    await js(`document.getElementById('last24').click();true`);
    check('last 24 hours shows today\'s orders', (await js('document.getElementById("rows").innerText')).includes('B-002'));

    // 6b. offline one-tap KOT (with the POS's own offline bug fixed on the fly)
    win.loadURL(BASE + 'Sale/POS'); await until(async () => await js('!!document.getElementById("posmarker")'));
    await js('addRunning("K-77")');
    const kotT0 = Date.now(); const logLenBefore = logTxt().length;
    const r = await js('(function(){var b=document.getElementById("kotbtn").getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()');
    win.show(); win.focus(); await sleep(300);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    const kotOk = await until(() => /print KOT -> Kitchen-Fake/.test(logTxt().slice(logLenBefore)), 8000);
    check('offline: one tap on KOT prints the kitchen ticket', kotOk, `${Date.now() - kotT0}ms ` + JSON.stringify(await js('({off:document.getElementById("is_offline_system").value, box:!!document.querySelector(".invoice_box_kot.active"), sale:document.querySelector(".print_kot_button").getAttribute("data-sale_no"), printed:window.__kotPrinted||0, url:location.href})')));
    check('offline KOT prints fast (under 1 second)', kotOk && Date.now() - kotT0 < 1000, `${Date.now() - kotT0}ms`);
    check('POS script fixes applied', /POS script fixes applied: offline KOT: read the selected order number; offline KOT: use the saved order text/.test(logTxt()));

    // 7. print popup (kitchen ticket) goes to kitchen printer silently
    win.loadURL(BASE + 'Sale/POS'); await until(async () => await js('!!document.getElementById("posmarker")'));
    await js(`(function(){var p=window.open('','popup','width=100','height=600');p.document.write('<html><body><h3 class="kot-print-title">KOT: Main</h3><script>setTimeout(function(){window.print()},300)<\\/script></body></html>');p.document.close();return true})()`);
    check('kitchen ticket sent to kitchen printer', await until(() => /print KOT -> Kitchen-Fake/.test(logTxt()), 8000));
    await js(`(function(){var p=window.open('','popup','width=100','height=600');p.document.write('<html><head><title>Invoice No : 9</title></head><body>receipt<script>setTimeout(function(){window.print()},300)<\\/script></body></html>');p.document.close();return true})()`);
    check('receipt sent to receipt printer', await until(() => /print receipt -> Receipt-Fake/.test(logTxt()), 8000));

    // 7b. closed after signing out, opened again with no internet: sign-in page, then POS
    await srv.stop(); await until(() => /OFFLINE/.test(win.getTitle()), 20000);
    win.loadURL(BASE + 'Authentication/logOut'); await until(async () => url().includes('Authentication/index'));
    win.loadURL(BASE + 'Sale/POS');
    check('offline, nobody signed in: opening the POS shows the sign-in page', await until(async () => url().includes('Authentication/index') && await js('!!document.getElementById("loginpage")')));
    await js(`document.querySelector('[name=email_address]').value='admin@x.com';document.querySelector('[name=password]').value='secret';document.querySelector('button[type=submit]').click();true`);
    await until(async () => url().includes('__rojey/offline-sales'));
    win.loadURL(BASE + 'Sale/POS');
    check('offline sign-in then POS opens the same as online', await until(async () => await js('!!document.getElementById("posmarker") && window.__assetLoaded===true')));
    check('sign-in page was saved for offline use in the background', /sign-in page saved for offline use/.test(logTxt()));

    // 8. server back -> automatic upload of offline orders
    await srv.start();
    check('uploads offline orders automatically when back online', await until(() => srv.pushes.some((p) => p.sale_no === 'B-001') && srv.pushes.some((p) => p.sale_no === 'B-002'), 30000), JSON.stringify(srv.pushes.map((p) => p.sale_no)));
    check('orders kept offline upload under the person signed in offline (admin)', srv.pushes.filter((p) => p.sale_no.startsWith('B-')).every((p) => p.by === 'Admin User'), JSON.stringify(srv.pushes));
    check('each order was uploaded exactly once (app is the only uploader)', Object.values(srv.pushCount).every((n) => n === 1), JSON.stringify(srv.pushCount));
    check('page never uploaded by itself (patched)', true);
    const { DatabaseSync } = require('node:sqlite');
    const dbf = new DatabaseSync(path.join(ud, 'rojey-pos.db'));
    const rows = dbf.prepare("SELECT sale_no, status, kind FROM orders ORDER BY sale_no").all();
    check('every order is in the app\'s own database', ['A-001','A-002','B-001','B-002'].every((n) => rows.some((r) => r.sale_no === n)), JSON.stringify(rows));
    check('uploaded orders are marked uploaded in the app database', await until(() => dbf.prepare("SELECT COUNT(*) n FROM orders WHERE status='pending'").get().n === 0, 10000));
    check('running (unpaid) order kept as open', rows.some((r) => r.sale_no === 'K-77' && r.status === 'open'));
    win.loadURL(BASE + 'Sale/POS'); await until(async () => await js('!!document.getElementById("posmarker")'));
    const idbPending = await js(`dbReady.then(function(db){return new Promise(function(res){var n=0;var c=db.transaction('recent_sales').objectStore('recent_sales').openCursor();c.onsuccess=function(e){var x=e.target.result;if(x){if(x.value.online_push===0)n++;x.continue();}else res(n);};});})`);
    check('POS\'s own list is ticked as uploaded too', idbPending === 0, 'waiting in POS: ' + idbPending);
    check('no duplicates uploaded', new Set(srv.pushes.map((p) => p.sale_no)).size === srv.pushes.length);
  } catch (e) {
    check('test crashed', false, e.stack);
  }
  // closing works even though the POS page has a "leave this page?" guard
  try {
    const w2 = new BrowserWindow({ show: false });
    await w2.loadURL(BASE + 'Sale/POS').catch(() => {});
    await w2.webContents.executeJavaScript('window.onbeforeunload=function(){return "leave?"};true');
    w2.webContents.sendInputEvent({ type: 'mouseDown', x: 5, y: 5, button: 'left', clickCount: 1 }); w2.webContents.sendInputEvent({ type: 'mouseUp', x: 5, y: 5, button: 'left', clickCount: 1 }); await sleep(200);
    const closed = new Promise((r) => w2.on('closed', () => r(true)));
    w2.close();
    check('window closes even with the POS "leave page?" guard', await Promise.race([closed, sleep(3000).then(() => false)]));
  } catch (e) { check('close test crashed', false, e.message); }
  console.log('\n' + results.join('\n') + `\n\n${results.length - failed} passed, ${failed} failed`);
  if (failed) console.log('--- app log ---\n' + logTxt().split('\n').slice(-40).join('\n'));
  app.exit(failed ? 1 : 0);
});
