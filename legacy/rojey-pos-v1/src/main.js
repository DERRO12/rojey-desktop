// Rojey POS desktop: opens the existing web POS, keeps a local copy of it so it opens
// instantly and keeps working offline, re-signs-in by itself, and prints silently.
const { app, BrowserWindow, protocol, net, session, ipcMain, shell, Menu, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { DiskCache } = require('./cache');
const { Store } = require('./store');
const R = require('./rules');
const offlinePages = require('./offline-pages');
const patches = require('./patches');
const { LocalDb } = require('./localdb');

const LOG_MAX = 2 * 1024 * 1024;
let logFile;
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
  if (process.env.ROJEY_DEBUG) process.stdout.write(line);
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > LOG_MAX) fs.renameSync(logFile, logFile + '.old');
    fs.appendFileSync(logFile, line);
  } catch { /* ignore */ }
}

if (process.env.ROJEY_USER_DATA) app.setPath('userData', process.env.ROJEY_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

let store, cache, netSes, localDb;
let appSyncs = false;   // true once the POS script is patched so only the app uploads orders
let mainWin = null;
let setupWin = null;
let online = true;
let currentUserKey = null;
const revalidated = new Set();
const INTERNAL = '__rojey/';

const base = () => store.cfg.baseUrl;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Low-level network call through a separate session (no interception there),
// with manual redirects so we can see "session expired" redirects.
function rawFetch(url, { method = 'GET', headers = {}, body = null, timeout = 30000, cookies = true } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const req = net.request({ url, method, redirect: 'manual', useSessionCookies: cookies, session: netSes });
    for (const [k, v] of Object.entries(headers)) {
      if (['cookie', 'host', 'content-length', 'connection', 'accept-encoding'].includes(k.toLowerCase())) continue;
      try { req.setHeader(k, v); } catch { /* forbidden header */ }
    }
    const timer = setTimeout(() => {
      if (done) return; done = true;
      try { req.abort(); } catch { /* ignore */ }
      const e = new Error('timeout'); e.code = 'TIMEOUT'; reject(e);
    }, timeout);
    req.on('redirect', (status, _m, redirectUrl) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ status, headers: { location: redirectUrl }, body: Buffer.alloc(0), redirect: redirectUrl });
      try { req.abort(); } catch { /* ignore */ }
    });
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (done) return; done = true; clearTimeout(timer);
        const h = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (k === 'set-cookie' || k === 'content-encoding' || k === 'content-length' || k === 'transfer-encoding') continue;
          h[k] = Array.isArray(v) ? v.join(', ') : v;
        }
        resolve({ status: res.statusCode, headers: h, body: Buffer.concat(chunks) });
      });
      res.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    });
    req.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    if (body && body.length) req.write(body);
    req.end();
  });
}

function toResponse(r, extraHeaders = {}) {
  const h = new Headers();
  for (const [k, v] of Object.entries(r.headers || {})) { try { h.set(k, v); } catch { /* ignore */ } }
  for (const [k, v] of Object.entries(extraHeaders)) h.set(k, v);
  const nullBody = r.status === 204 || r.status === 304 || (r.status >= 300 && r.status < 400);
  return new Response(nullBody ? null : r.body, { status: r.status, headers: h });
}

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

function redirectResponse(location) {
  return new Response(null, { status: 302, headers: { location } });
}

// ---------------------------------------------------------------------------
// Online / offline state
function offlineFlagJs(v) {
  return v
    ? `(function(){var e=document.getElementById('is_offline_system');if(e)e.value=1;
        if(window.jQuery){jQuery('#online_status').removeClass('bg__red').addClass('bg__green');
        var t=document.getElementById('inv_online'); if(t) jQuery('.online_status_text').text(t.value);
        }var s=document.getElementById('sync_online'); if(s) s.click();})();`
    : `(function(){var e=document.getElementById('is_offline_system');if(e)e.value=0;
        if(window.jQuery){jQuery('#online_status').removeClass('bg__green').addClass('bg__red');
        var t=document.getElementById('inv_offline'); if(t) jQuery('.online_status_text').text(t.value);
        jQuery('.online_status_counter').show();}})();`;
}

function setOnline(v, why) {
  if (online === v) return;
  online = v;
  log('connection', v ? 'ONLINE' : 'OFFLINE', why || '');
  updateTitle();
  if (v && store.sec.needsServerLogin) { serverLoginThenSync(); return; }
  if (v) { syncBlockedUntil = 0; setTimeout(syncOnce, 200); }
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.executeJavaScript(offlineFlagJs(v)).catch(() => {});
}

// Someone signed in while offline: sign them in on the website first, then let the POS upload.
let serverLoginRunning = false;
function serverLoginThenSync() {
  if (serverLoginRunning) return;
  serverLoginRunning = true;
  relogin('login').then((ok) => {
    log('server sign-in after offline sign-in', ok ? 'ok' : 'failed');
    if (ok) { store.sec.needsServerLogin = false; if (!store.cfg.rememberLogin) store.sec.lastLogin = null; store.saveSecure(); setTimeout(syncOnce, 100); }
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.executeJavaScript(offlineFlagJs(true)).catch(() => {});
  }).finally(() => { serverLoginRunning = false; });
}

async function probe() {
  if (!base()) return;
  try {
    const r = await rawFetch(base() + 'Authentication/check_internet?_=' + Date.now(), { timeout: 6000 });
    setOnline(r.status >= 200 && r.status < 500, 'probe ' + r.status);
    if (online) prefetchForOffline();
    if (online && store.sec.needsServerLogin) serverLoginThenSync();
  } catch (e) {
    setOnline(false, 'probe ' + e.message);
  }
}

// Make sure the sign-in page is saved on this computer, so it opens with no internet even if
// nobody has seen it here yet (e.g. the app was set up while already signed in).
let prefetchedFor = '';
function prefetchForOffline() {
  if (!base() || prefetchedFor === base()) return;
  prefetchedFor = base();
  const url = base() + 'Authentication/index';
  rawFetch(url, { timeout: 30000, cookies: false, headers: { accept: 'text/html' } })
    .then((r) => storeIfGood(url, r, 'Authentication/index'))
    .then(() => log('sign-in page saved for offline use'))
    .catch((e) => { prefetchedFor = ''; log('could not save sign-in page', e.message); });
}

function startMonitor() {
  const loop = async () => {
    await probe();
    setTimeout(loop, online ? 10000 : 4000);
  };
  loop();
}

// ---------------------------------------------------------------------------
// Automatic sign-in again when the website's 2-hour session runs out.
let reloginPromise = null;
let pendingLogout = null;
function relogin(kind) {
  if (reloginPromise) return reloginPromise;
  reloginPromise = (async () => {
    try {
      if (kind === 'login') {
        const saved = store.sec.lastLogin;
        if (!saved || (!store.cfg.rememberLogin && !store.sec.needsServerLogin)) return false;
        const r = await rawFetch(base() + 'Authentication/loginCheck', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: Buffer.from(saved, 'base64'),
          timeout: 30000,
        });
        const lost = R.isSessionLostRedirect(r.status, r.headers.location, base());
        log('relogin result', r.status, r.headers.location || '');
        if (lost === 'login' || (!r.redirect && r.status !== 200)) return false;
        if (lost !== 'outlet') return true;
      }
      if (store.sec.lastOutletPath) {
        await rawFetch(base() + store.sec.lastOutletPath, { timeout: 30000 });
        return true;
      }
      return false;
    } catch (e) {
      log('relogin failed', e.message);
      return false;
    } finally {
      setTimeout(() => { reloginPromise = null; }, 0);
    }
  })();
  return reloginPromise;
}

// ---------------------------------------------------------------------------
// Request handling
function setCurrentUser(k) {
  currentUserKey = k || null;
  store.sec.currentUserKey = currentUserKey;
  store.saveSecure();
}

function cacheKeyFor(url, rel) {
  if (rel && /^Sale\/POS/i.test(rel) && currentUserKey) return url + '|user=' + currentUserKey;
  return url;
}

function isNavigation(req) {
  const mode = req.headers.get('sec-fetch-mode');
  const dest = req.headers.get('sec-fetch-dest');
  if (mode === 'navigate' || dest === 'document' || dest === 'iframe') return true;
  if (!mode && !dest) return (req.headers.get('accept') || '').includes('text/html') && !req.headers.get('x-requested-with');
  return false;
}

function headersObj(req) {
  const h = {};
  for (const [k, v] of req.headers) h[k] = v;
  return h;
}

const patchLogged = new Set();
function patchBody(url, r) {
  if (!patches.isPosScript(url) || r.status !== 200) return r;
  const { text, applied, flags } = patches.apply(r.body.toString('utf8'));
  if (flags.appSync && !appSyncs) { appSyncs = true; setTimeout(syncOnce, 500); }
  if (!patchLogged.has(url)) { patchLogged.add(url); log('POS script fixes applied:', applied.join('; ') || 'none matched'); }
  return { ...r, body: Buffer.from(text, 'utf8') };
}

async function fromCache(key, alsoKey) {
  let c = await cache.get(key);
  if (!c && alsoKey && alsoKey !== key) c = await cache.get(alsoKey);
  if (!c) return null;
  return toResponse({ status: c.status, headers: c.headers, body: c.body }, { 'x-rojey-cache': 'hit' });
}

async function storeIfGood(key, r, rel) {
  if (r.status !== 200 || R.isNoCache(rel)) return;
  const ct = String(r.headers['content-type'] || '');
  // Never keep the sign-in page under another page's address.
  if (ct.includes('text/html') && rel && !/^Authentication/i.test(rel) && /name=["']login_pin["']/.test(r.body.toString('utf8', 0, Math.min(r.body.length, 400000)))) return;
  try { await cache.put(key, r.status, r.headers, r.body); } catch (e) { log('cache write failed', e.message); }
}

function learnFromPage(rel, r) {
  // Remember who is signed in and their role, so offline sign-in can send admins to the right place.
  if (!/^Sale\/POS/i.test(rel || '') || !currentUserKey) return;
  const html = r.body.toString('utf8');
  const pick = (id) => {
    const m = html.match(new RegExp(`id=["']${id}["'][^>]*value=["']([^"']*)["']`));
    return m ? m[1] : undefined;
  };
  const designation = pick('loggedin_designation');
  const name = pick('user_name');
  if (designation || name) store.updateOfflineUser(currentUserKey, { designation, name });
}

async function netWithRelogin(url, opts, rel) {
  let r = await rawFetch(url, opts);
  const lost = R.isSessionLostRedirect(r.status, r.headers.location, base());
  if (lost && !/^Authentication\//i.test(rel || '') && !/^Outlet\/outlets/i.test(rel || '')) {
    log('session lost on', rel, '->', lost);
    if (await relogin(lost)) r = await rawFetch(url, opts);
  }
  return r;
}

async function handleGet(req, rel, ownSite) {
  const url = req.url;
  const nav = isNavigation(req);

  if (ownSite && rel.startsWith(INTERNAL)) return offlinePages.serve(rel.slice(INTERNAL.length), ctx());

  if (ownSite && /^Authentication\/check_internet/i.test(rel)) {
    if (!online) return Response.error();
    try {
      const r = await rawFetch(url, { headers: headersObj(req), timeout: 6000 });
      setOnline(true, 'page check');
      return toResponse(r);
    } catch (e) { setOnline(false, 'page check ' + e.message); return Response.error(); }
  }

  if (ownSite && R.isLogout(rel)) {
    // Sign out at once. The website is told in the background (it records the attendance
    // out-time there); the next sign-in waits for that so it can't sign the next person out.
    store.sec.lastLogin = null;
    store.sec.needsServerLogin = false;
    setCurrentUser(null);
    if (online) {
      pendingLogout = rawFetch(url, { headers: headersObj(req), timeout: 15000 })
        .catch((e) => log('background sign-out failed', e.message))
        .finally(() => { pendingLogout = null; });
    }
    return redirectResponse(base() + 'Authentication/index');
  }

  // Sign-in page: show the saved copy at once, refresh it quietly.
  if (ownSite && nav && /^Authentication\/index/i.test(rel)) {
    const c = await cache.get(url);
    if (c) {
      if (online) rawFetch(url, { headers: headersObj(req), timeout: 30000 }).then((r) => storeIfGood(url, r, rel)).catch(() => {});
      return toResponse({ status: c.status, headers: c.headers, body: c.body }, { 'x-rojey-cache': 'hit' });
    }
  }
  if (ownSite && R.isOutletEnter(rel)) { store.sec.lastOutletPath = rel; store.saveSecure(); }

  const key = cacheKeyFor(url, rel);

  // Scripts, styles, pictures: answer from disk at once, refresh quietly in the background.
  if (R.isStatic(url)) {
    const c = await cache.get(key);
    if (c) {
      if (online && !revalidated.has(url)) {
        revalidated.add(url);
        rawFetch(url, { headers: headersObj(req), timeout: 60000 }).then((r) => storeIfGood(key, r, rel)).catch(() => {});
      }
      return toResponse(patchBody(url, { status: c.status, headers: c.headers, body: c.body }), { 'x-rojey-cache': 'hit' });
    }
    try {
      const r = await rawFetch(url, { headers: headersObj(req), timeout: 60000 });
      await storeIfGood(key, r, rel);
      return toResponse(patchBody(url, r));
    } catch (e) {
      return Response.error();
    }
  }

  // Pages and data
  const fallback = async () => {
    // Nobody signed in (e.g. after Logout) and no internet: show the saved sign-in page, like the website would.
    if (ownSite && nav && !currentUserKey && /^Sale\/POS/i.test(rel) && (await cache.get(base() + 'Authentication/index'))) {
      return redirectResponse(base() + 'Authentication/index');
    }
    return (await fromCache(key, url)) || (nav ? htmlResponse(offlinePages.noCopyPage(url, base()), 503) : Response.error());
  };
  if (!online) return fallback();

  const opts = { headers: headersObj(req), timeout: nav ? 90000 : 25000 };
  const p = (ownSite ? netWithRelogin(url, opts, rel) : rawFetch(url, opts)).then(async (r) => {
    await storeIfGood(key, r, rel);
    // Also keep the newest POS screen under its plain address, for anyone signing in offline later.
    if (key !== url) await storeIfGood(url, r, rel);
    if (ownSite) learnFromPage(rel, r);
    return r;
  });

  try {
    let r;
    if (nav && (await cache.get(key))) {
      // A copy exists: don't make staff wait for a slow server.
      r = await Promise.race([p, delay(2500).then(() => null)]);
      if (!r) { p.catch(() => {}); log('slow page, using local copy', rel); return fallback(); }
    } else {
      r = await p;
    }
    if (ownSite && r.status >= 500 && nav) { const c = await fromCache(key, url); if (c) return c; }
    return toResponse(r);
  } catch (e) {
    if (e.code !== 'TIMEOUT') setOnline(false, 'GET ' + rel + ' ' + e.message);
    return fallback();
  }
}

function parseForm(buf) {
  const out = {};
  for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) out[k] = v;
  return out;
}

async function handleLogin(req, body) {
  const form = parseForm(body);
  const url = req.url;
  if (pendingLogout) await Promise.race([pendingLogout, delay(5000)]);
  if (online) {
    try {
      const r = await rawFetch(url, { method: 'POST', headers: headersObj(req), body, timeout: 45000 });
      const lost = R.isSessionLostRedirect(r.status, r.headers.location, base());
      if (r.redirect && lost !== 'login') {
        if (store.cfg.rememberLogin) store.sec.lastLogin = body.toString('base64');
        store.sec.needsServerLogin = false;
        setCurrentUser(store.rememberOfflineUser(form));
        log('signed in online as', currentUserKey);
      }
      return toResponse(r);
    } catch (e) {
      setOnline(false, 'login ' + e.message);
    }
  }
  // Offline sign-in from what this computer remembers.
  const u = store.checkOfflineUser(form);
  if (!u) return htmlResponse(offlinePages.loginFailedPage(base()));
  // When the connection returns, sign this person in on the website before uploading,
  // so their orders are saved under their own name.
  store.sec.lastLogin = body.toString('base64');
  store.sec.needsServerLogin = true;
  setCurrentUser(u.key);
  log('signed in offline as', u.key, u.designation || '');
  const admin = /admin/i.test(u.designation || '');
  return redirectResponse(base() + (admin ? INTERNAL + 'offline-sales' : 'Sale/POS'));
}

async function handleOther(req, rel, ownSite) {
  const body = Buffer.from(await req.arrayBuffer());
  if (ownSite && R.isLoginPost(rel)) return handleLogin(req, body);
  const nav = isNavigation(req);
  if (!online) {
    // Fail at once so the POS falls back to its own offline saving instead of hanging.
    return nav ? htmlResponse(offlinePages.needsInternetPage(base()), 503) : Response.error();
  }
  const opts = { method: req.method, headers: headersObj(req), body, timeout: 45000 };
  try {
    const r = ownSite ? await netWithRelogin(req.url, opts, rel) : await rawFetch(req.url, opts);
    return toResponse(r);
  } catch (e) {
    if (e.code !== 'TIMEOUT') setOnline(false, req.method + ' ' + rel + ' ' + e.message);
    return nav ? htmlResponse(offlinePages.needsInternetPage(base()), 503) : Response.error();
  }
}

async function handle(req) {
  try {
    const b = base();
    const ownSite = !!b && req.url.startsWith(b);
    const rel = ownSite ? R.relPath(req.url, b) : '';
    if (req.method === 'GET' || req.method === 'HEAD') return await handleGet(req, rel, ownSite);
    return await handleOther(req, rel, ownSite);
  } catch (e) {
    log('handler error', req.url, e.stack || e.message);
    return Response.error();
  }
}

// ---------------------------------------------------------------------------
// Printing
function printerFor(win, isKot, kitchenTitle) {
  const cfg = store.cfg;
  if (isKot) {
    for (const [name, printer] of Object.entries(cfg.kitchenPrinters || {})) {
      if (name && printer && kitchenTitle && kitchenTitle.toLowerCase().includes(name.toLowerCase())) return printer;
    }
    return R.pickPrinter('kitchen', cfg);
  }
  return R.pickPrinter('receipt', cfg);
}

async function printWindow(win) {
  if (!win || win.isDestroyed() || win.__rojeyPrinted) return;
  win.__rojeyPrinted = true;
  const info = await win.webContents.executeJavaScript(
    `(function(){var k=document.querySelector('.kot-print-title');return {kot:!!k,title:k?k.textContent:''};})()`
  ).catch(() => ({ kot: false, title: '' }));
  const deviceName = printerFor(win, info.kot, info.title);
  log('print', info.kot ? 'KOT' : 'receipt', '->', deviceName || '(dialog)');
  if (!store.cfg.autoPrint || !deviceName) {
    win.show();
    win.webContents.print({ silent: false, printBackground: true }, () => { if (!win.isDestroyed()) win.close(); });
    return;
  }
  win.webContents.print({ silent: true, printBackground: true, deviceName, margins: { marginType: 'none' } }, (ok, reason) => {
    if (!ok) log('print failed', reason);
    setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 800);
  });
}

ipcMain.on('rojey-print', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && win !== mainWin) printWindow(win);
});
ipcMain.on('rojey-print-child', () => {
  // The POS asked a popup it opened to print: print the newest popup.
  const kids = (mainWin && !mainWin.isDestroyed()) ? mainWin.getChildWindows() : [];
  const win = kids.filter((w) => !w.__rojeyPrinted).pop();
  if (win) setTimeout(() => printWindow(win), 50);
});

// ---------------------------------------------------------------------------
// Windows
function updateTitle() {
  if (!mainWin || mainWin.isDestroyed()) return;
  let waiting = 0;
  try { waiting = localDb && base() ? localDb.counts(base()).pending : 0; } catch { /* ignore */ }
  const w = waiting ? ` — ${waiting} order${waiting === 1 ? '' : 's'} waiting to upload` : '';
  mainWin.setTitle(online ? `Rojey POS${w}` : `Rojey POS — OFFLINE (orders are being kept on this computer)${w}`);
}

function buildMenu() {
  const tpl = [
    {
      label: 'Rojey POS',
      submenu: [
        { label: 'Open POS', accelerator: 'F2', click: () => mainWin && mainWin.loadURL(base() + 'Sale/POS') },
        { label: 'Offline sales on this computer', accelerator: 'F3', click: () => mainWin && mainWin.loadURL(base() + INTERNAL + 'offline-sales') },
        { label: 'Settings (website, printers)', accelerator: 'CmdOrCtrl+,', click: openSetup },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'F5', click: () => mainWin && mainWin.webContents.reload() },
        { label: 'Full screen', accelerator: 'F11', click: () => mainWin && mainWin.setFullScreen(!mainWin.isFullScreen()) },
        { label: 'Developer tools', accelerator: 'CmdOrCtrl+Shift+I', click: () => mainWin && mainWin.webContents.toggleDevTools() },
        { label: 'Open log folder', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        { role: 'quit', label: 'Quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1366, height: 800, show: false, autoHideMenuBar: true,
    fullscreen: !!store.cfg.startFullscreen,
    title: 'Rojey POS',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-pos.js'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWin.maximize();
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('page-title-updated', (e) => { e.preventDefault(); updateTitle(); });
  mainWin.on('closed', () => { mainWin = null; });

  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    const blank = !url || url === 'about:blank';
    if (blank || (base() && url.startsWith(base()))) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          show: !blank, width: 420, height: 700, autoHideMenuBar: true, parent: mainWin,
          webPreferences: { preload: path.join(__dirname, 'preload-popup.js'), contextIsolation: false, sandbox: true },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWin.webContents.on('did-create-window', (win, { url }) => {
    const blank = !url || url === 'about:blank';
    win.setMenuBarVisibility(false);
    if (blank) {
      // Kitchen tickets have no pictures: print the moment the ticket is written instead of
      // waiting for the POS's built-in one-second delay. Receipts wait for their own print() call.
      const started = Date.now();
      const fast = async () => {
        if (win.isDestroyed() || win.__rojeyPrinted) return;
        const ready = await win.webContents.executeJavaScript(
          "document.readyState==='complete' && !!document.querySelector('.kot-print-title')").catch(() => false);
        if (ready) return printWindow(win);
        if (Date.now() - started < 1500) setTimeout(fast, 60);
      };
      setTimeout(fast, 60);
      // Print anyway if the popup never asks.
      setTimeout(() => printWindow(win), 4000);
      setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.close(); }, 120000);
    }
  });

  // A page opened while offline must know it straight away (the POS itself only checks every 15 s).
  mainWin.webContents.on('dom-ready', () => {
    if (!online) mainWin.webContents.executeJavaScript(offlineFlagJs(false)).catch(() => {});
  });

  mainWin.webContents.on('render-process-gone', (_e, d) => {
    log('renderer gone', d.reason);
    setTimeout(() => mainWin && mainWin.reload(), 1000);
  });

  mainWin.loadURL(base() + 'Sale/POS');
  updateTitle();
}

function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 760, height: 820, parent: mainWin || undefined, modal: !!mainWin, autoHideMenuBar: true,
    title: 'Rojey POS setup', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload-setup.js'), contextIsolation: true, sandbox: true },
  });
  setupWin.loadFile(path.join(__dirname, 'setup.html'));
  setupWin.on('closed', () => { setupWin = null; if (!mainWin && base()) createMainWindow(); });
}

// Count orders still waiting to upload, read from the POS's own local database.
async function pendingOrders() {
  if (!mainWin || mainWin.isDestroyed() || !base() || !mainWin.webContents.getURL().startsWith(base())) return 0;
  return mainWin.webContents.executeJavaScript(`new Promise(function(res){
    try{var rq=indexedDB.open('irestora_plus');
      rq.onupgradeneeded=function(e){e.target.transaction.abort();res(0);};
      rq.onsuccess=function(){var db=rq.result;if(!db.objectStoreNames.contains('recent_sales')){res(0);return;}
        var n=0;var c=db.transaction('recent_sales').objectStore('recent_sales').openCursor();
        c.onsuccess=function(e){var cur=e.target.result;if(cur){if(Number(cur.value.online_push)===0)n++;cur.continue();}else res(n);};
        c.onerror=function(){res(0)};};
      rq.onerror=function(){res(0)};}catch(e){res(0)}})`).catch(() => 0);
}

function ctx() {
  return { base: base(), online, store, currentUserKey };
}

// ---------------------------------------------------------------------------
// Setup screen IPC
ipcMain.handle('setup:get', async () => ({ cfg: store.cfg, version: app.getVersion() }));
ipcMain.handle('setup:printers', async (e) => {
  const list = await e.sender.getPrintersAsync();
  return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
});
ipcMain.handle('setup:test-site', async (_e, input) => {
  const candidates = [];
  const n = R.normalizeBaseUrl(input);
  if (!n) return { ok: false, message: 'That does not look like a website address.' };
  candidates.push(n);
  if (!/^https?:\/\//i.test(String(input).trim())) candidates.push(n.replace(/^https:/, 'http:'));
  for (const c of candidates) {
    try {
      const r = await rawFetch(c + 'Authentication/check_internet', { timeout: 12000 });
      const txt = r.body.toString('utf8').trim();
      if (r.status === 200 && txt.length < 50) return { ok: true, baseUrl: c, message: 'Connected to your POS.' };
      if (r.status === 200) return { ok: true, baseUrl: c, message: 'Website reached. It answered, but not like a normal iRestora POS; check the address.' };
      if (r.redirect) return { ok: true, baseUrl: c, message: 'Website reached.' };
    } catch (e) { /* try next */ }
  }
  return { ok: false, message: 'Could not reach that website. Check the address and the internet connection.' };
});
ipcMain.handle('setup:test-print', async (_e, printer, label) => {
  const w = new BrowserWindow({ show: false });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<html><body style="font-family:sans-serif;width:72mm"><h3 style="text-align:center">Rojey POS</h3><p>Test print: ${label}</p><p>${new Date().toLocaleString()}</p><p>If you can read this, the printer is set up.</p></body></html>`));
  return new Promise((res) => {
    w.webContents.print({ silent: true, deviceName: printer, margins: { marginType: 'none' } }, (ok, reason) => { w.close(); res({ ok, reason }); });
  });
});
ipcMain.handle('setup:pending', async () => pendingOrders());
ipcMain.handle('setup:save', async (_e, patch) => {
  const changedSite = patch.baseUrl && patch.baseUrl !== store.cfg.baseUrl;
  store.saveConfig(patch);
  if (changedSite) { revalidated.clear(); online = true; probe(); }
  if (mainWin && !mainWin.isDestroyed()) {
    if (changedSite) mainWin.loadURL(base() + 'Sale/POS');
  }
  if (setupWin && !setupWin.isDestroyed()) setupWin.close();
  return true;
});

// Offline sales page asks for this to show a status line
ipcMain.handle('rojey:status', async () => ({ online, base: base(), user: currentUserKey && store.sec.offlineUsers[currentUserKey] ? store.sec.offlineUsers[currentUserKey].name || '' : '' }));
ipcMain.on('rojey:open-pos', () => mainWin && mainWin.loadURL(base() + 'Sale/POS'));
ipcMain.on('rojey:cfg-sync', (e) => { e.returnValue = { oneTapKot: store.cfg.oneTapKot !== false, kotItems: store.cfg.kotItems || 'new' }; });
// ---------------------------------------------------------------------------
// The app's own database and uploads
ipcMain.on('localdb:upsert', (_e, items, extra) => {
  if (!localDb || !base() || !Array.isArray(items)) return;
  let newPending = false;
  try {
    for (const it of items) {
      if (!it || !it.rec) continue;
      localDb.upsertFromPos(base(), it.rec, it.kind === 'open' ? 'open' : 'paid');
      if (it.kind !== 'open' && Number(it.rec.online_push) !== 1) newPending = true;
    }
    if (extra && Array.isArray(extra.openIds)) localDb.removeOpen(base(), [], new Set(extra.openIds));
  } catch (e) { log('local database write failed', e.message); }
  updateTitle();
  if (newPending) setTimeout(syncOnce, 50);   // upload straight away when online
});
ipcMain.on('localdb:open-removed', (_e, ids) => {
  try { if (localDb && base()) localDb.removeOpen(base(), ids.map(String)); } catch (e) { log('local database write failed', e.message); }
});
ipcMain.handle('localdb:list', (_e, f) => (localDb && base() ? localDb.list(base(), f || {}) : []));
ipcMain.on('rojey:sync-now', () => { syncOnce(); });

let syncing = false;
let syncBlockedUntil = 0;
async function syncOnce() {
  if (!appSyncs || !localDb || !base() || !online || syncing) return;
  if (store.sec.needsServerLogin || Date.now() < syncBlockedUntil) return;
  syncing = true;
  const site = base();
  const uploaded = [];
  try {
    for (;;) {
      const rows = localDb.pending(site, 10);
      if (!rows.length) break;
      for (const row of rows) {
        if (!online || base() !== site) return;
        const sid = row.local_id || row.sale_no;
        const body = Buffer.from(new URLSearchParams({ orders: row.order_json, sales_id: sid }).toString());
        try {
          const r = await netWithRelogin(site + 'Sale/push_online', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', accept: '*/*' },
            body, timeout: 30000,
          }, 'Sale/push_online');
          const txt = r.body.toString('utf8').trim();
          if (r.status === 200 && txt === String(sid)) {
            localDb.markSynced(site, row);
            if (row.local_id) uploaded.push(String(row.local_id));
            log('uploaded order', row.sale_no);
          } else {
            localDb.markFailed(site, row, `HTTP ${r.status} ${txt.slice(0, 80)}`);
            log('upload refused', row.sale_no, r.status, txt.slice(0, 120));
            syncBlockedUntil = Date.now() + 30000;
            return;
          }
        } catch (e) {
          localDb.markFailed(site, row, e.message);
          if (e.code !== 'TIMEOUT') setOnline(false, 'upload ' + e.message);
          syncBlockedUntil = Date.now() + 15000;
          return;
        }
      }
    }
  } finally {
    syncing = false;
    if (uploaded.length && mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('rojey:mark-pushed', uploaded);
    updateTitle();
  }
}

ipcMain.handle('rojey:check-now', async () => { await probe(); return online; });

// ---------------------------------------------------------------------------
// The POS sets a "leave this page?" guard (window.onbeforeunload). In a browser that shows a
// question; inside the app it silently blocks sign-out, page changes and closing. Always allow leaving:
// orders are saved locally the moment they're placed, so nothing is lost.
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-prevent-unload', (ev) => { ev.preventDefault(); });
});

app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  logFile = path.join(app.getPath('userData'), 'rojey-pos.log');
  store = new Store(app.getPath('userData'), safeStorage);
  cache = new DiskCache(path.join(app.getPath('userData'), 'site-copy'));
  try { localDb = new LocalDb(path.join(app.getPath('userData'), 'rojey-pos.db')); }
  catch (e) { log('could not open local database', e.message); }
  setInterval(syncOnce, 5000);
  currentUserKey = store.sec.currentUserKey || null;
  netSes = session.fromPartition('persist:rojey-net');
  if (process.env.ROJEY_DIRECT) { await netSes.setProxy({ mode: 'direct' }); await session.defaultSession.setProxy({ mode: 'direct' }); }
  log('start', app.getVersion(), 'site', base());

  session.defaultSession.protocol.handle('https', handle);
  session.defaultSession.protocol.handle('http', handle);

  buildMenu();
  if (!base()) openSetup();
  else createMainWindow();
  startMonitor();
});

// Closing is instant: waiting orders are safe on disk and upload the next time the app is open online.
app.on('before-quit', () => { log('closing'); });

module.exports = { handle };
