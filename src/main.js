// Rojey POS 2: a standalone till with its own database. It works fully offline and keeps the
// website (iRestora PLUS) up to date by itself whenever the internet is there.
const { app, BrowserWindow, ipcMain, Menu, safeStorage, shell, globalShortcut, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if (process.env.ROJEY_USER_DATA) app.setPath('userData', process.env.ROJEY_USER_DATA);
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const { Db, nowDateTime } = require('./db');
const { Store } = require('./store');
const { Server } = require('./server');
const { parsePosPage, mergeBootstrap, applyPull } = require('./pull');
const { buildOrderJson, parseServerOrder } = require('./order');
const { Updater } = require('./updater');
let updater = null;
const { Printer } = require('./print');
const calc = require('./ui/calc');

let db; let store; let server; let printer; let win = null;
let online = false;
let current = null;            // signed-in person: { userId, name, role, designation, account, isAdmin, shortName }
const state = { syncing: false, lastSync: 0, lastError: '', lastPullError: '', pulling: false, lastRunningPull: 0 };

// ---------------------------------------------------------------------------------------------
// log
let logFile = null;
function log(...a) {
  const line = new Date().toISOString() + ' ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  if (process.env.ROJEY_DEBUG) console.log(line);
  try {
    if (!logFile) logFile = path.join(app.getPath('userData'), 'rojey-pos.log');
    fs.appendFileSync(logFile, line + '\n');
    if (Math.random() < 0.01 && fs.statSync(logFile).size > 5e6) fs.renameSync(logFile, logFile + '.old');
  } catch { /* */ }
}

function normalizeBaseUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    let p = u.pathname.replace(/\/(index\.php\/?)?(Authentication|Sale|POSChecker)\b.*$/i, '/');
    if (!p.endsWith('/')) p += '/';
    return u.origin + p;
  } catch { return ''; }
}

function withCustomer(sale) {
  const c = sale && db.customer(Number(sale.customer_id));
  return c ? { ...sale, customer_phone: c.phone || '', customer_address: c.address || '' } : sale;
}

function posSettings() {
  const s = { precision: 2, collectTax: 'No', taxType: 1, currency: '', ...(db.get('pos_settings', {}) || {}) };
  // taxes only when an admin has turned them on (in Settings here, or by switching them on on the website)
  s.webCollectTax = s.collectTax;
  s.collectTax = store.cfg.taxesOn ? 'Yes' : 'No';
  s.enabledTaxes = Array.isArray(store.cfg.taxNames) ? store.cfg.taxNames : [];
  return s;
}

// every tax name the website's items use (VAT, CGST, SGST…), for the Settings tick boxes
function taxNamesInMenu() {
  const names = new Set();
  for (const t of ['tbl_food_menus', 'tbl_modifiers']) {
    for (const r of db.all(t, "tax_information IS NOT NULL AND tax_information != '' AND tax_information != '[]'")) {
      try { for (const x of JSON.parse(r.tax_information) || []) if (x && x.tax_field_name) names.add(String(x.tax_field_name).trim()); } catch {}
    }
  }
  return [...names].sort();
}

function isAdminUser(u) {
  return /admin/i.test(String(u.role || '')) || /admin|manager|owner/i.test(String(u.designation || ''));
}

function md5(s) { return crypto.createHash('md5').update(String(s)).digest('hex'); }

// ---------------------------------------------------------------------------------------------
// windows
function ui(file) { return path.join(__dirname, 'ui', file); }

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 768, minWidth: 800, minHeight: 540, show: false, backgroundColor: '#ffffff',
    title: 'Rojey POS', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, spellcheck: false, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => { win.maximize(); if (store.cfg.startFullscreen) win.setFullScreen(true); win.show(); });
  // screen size (zoom) like in a browser: Ctrl + / Ctrl - / Ctrl 0 and Ctrl + mouse wheel; kept for next time
  win.webContents.on('did-finish-load', () => { try { win.webContents.setZoomLevel(currentZoom()); } catch { /* */ } });
  win.webContents.on('zoom-changed', (_e, dir) => setZoom(dir === 'in' ? 0.5 : -0.5));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
  win.webContents.on('render-process-gone', () => { log('renderer gone, reloading'); setTimeout(() => win && !win.isDestroyed() && win.reload(), 500); });
  win.on('closed', () => { win = null; });
  goHome();
}

function goHome() {
  if (!win) return;
  if (!store.cfg.baseUrl) return win.loadFile(ui('setup.html'));
  if (!current) return win.loadFile(ui('login.html'));
  return win.loadFile(ui('pos.html'));
}

// first start on a very large screen: start a bit bigger (the person can change it with Ctrl + / Ctrl -)
function currentZoom() {
  if (store.cfg.zoomLevel != null && store.cfg.zoomLevel !== '') return Number(store.cfg.zoomLevel) || 0;
  try { const w = screen.getPrimaryDisplay().workAreaSize.width; return w >= 2300 ? 1.5 : w >= 1800 ? 0.5 : 0; } catch { return 0; }
}

function setZoom(step, absolute) {
  if (!win || win.isDestroyed()) return;
  let z = absolute != null ? absolute : (win.webContents.getZoomLevel() + step);
  z = Math.max(-4, Math.min(4, Math.round(z * 2) / 2));
  win.webContents.setZoomLevel(z);
  store.saveConfig({ zoomLevel: z });
  send('zoom', { level: z, percent: Math.round(Math.pow(1.2, z) * 100) });
}

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }

function statusPayload() {
  return {
    online, ...db.syncCounts(), syncing: state.syncing, lastSync: state.lastSync, lastError: state.lastError,
    lastPull: db.get('last_pull', 0), pulling: state.pulling, lastPullError: state.lastPullError, baseUrl: store.cfg.baseUrl,
    legacyPending: db.legacyPending().length,
  };
}
let statusTimer = null;
function pushStatus() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => send('status', statusPayload()), 50);
}

// ---------------------------------------------------------------------------------------------
// online / offline
let probing = false;
async function probe() {
  if (probing || !store.cfg.baseUrl) return;
  probing = true;
  let ok = false;
  try { ok = await server.ping(6000); } catch { ok = false; }
  probing = false;
  if (ok !== online) {
    online = ok;
    log('connection: ' + (ok ? 'ONLINE' : 'OFFLINE'));
    pushStatus();
    if (ok) { kick(); if (current) backgroundPull(); }
  }
}

// ---------------------------------------------------------------------------------------------
// sign in
async function ensureSession(account) {
  const fresh = server.loggedIn.get(account.id);
  if (fresh && Date.now() - fresh < 90 * 60 * 1000) return true;
  const r = await server.login(account.id, account.creds);
  if (!r.ok) { store.markBroken(account.id, true); return false; }
  store.markBroken(account.id, false);
  return true;
}

async function pullWith(accountId) {
  if (state.pulling) return { ok: false, error: 'busy' };
  state.pulling = true; pushStatus();
  try {
    const page = await server.posPage(accountId, { counterId: store.cfg.counterId, autoRegister: store.cfg.autoOpenRegister });
    if (!page.ok) {
      const msg = page.reason === 'register' ? 'The register is closed on the website. Open it there, or turn on "Open the register by itself" in Settings.' : 'Could not open the POS on the website (' + page.reason + ')';
      state.lastPullError = msg; return { ok: false, error: msg };
    }
    let parsed = parsePosPage(page.html);
    if (!parsed.tables.tbl_food_menus.length) { state.lastPullError = 'The website POS page had no menu items'; return { ok: false, error: state.lastPullError }; }
    const boot = await server.bootstrap(accountId, parsed.outlet.id);
    if (boot) { parsed = mergeBootstrap(parsed, boot); log('IR_api desktop_bootstrap used'); }
    const hash = crypto.createHash('sha1').update(JSON.stringify([parsed.tables, parsed.settings, parsed.user, parsed.waiters])).digest('hex');
    state.lastPullError = '';
    if (hash === db.get('last_pull_hash:' + (parsed.user && parsed.user.id), '') && db.hasMenu()) {
      db.set('last_pull', Date.now());          // nothing changed on the website
      return { ok: true, user: parsed.user, outlet: parsed.outlet, unchanged: true };
    }
    applyPull(db, parsed);
    db.set('last_pull_hash:' + (parsed.user && parsed.user.id), hash);
    // the website's tax switch: when an admin changes it there, this till follows
    const webTax = String(parsed.settings && parsed.settings.collectTax || 'No') === 'Yes' ? 'Yes' : 'No';
    const lastWebTax = db.get('web_collect_tax', null);
    if (lastWebTax !== null && lastWebTax !== webTax) { store.saveConfig({ taxesOn: webTax === 'Yes' }); log('taxes turned ' + (webTax === 'Yes' ? 'on' : 'off') + ' on the website'); }
    db.set('web_collect_tax', webTax);
    if (current && parsed.user && Number(parsed.user.id) === Number(current.userId)) {
      const before = JSON.stringify(perms());
      current.role = parsed.user.role || current.role; current.designation = parsed.user.designation || current.designation;
      current.isAdmin = isAdminUser(current);
      if (JSON.stringify(perms()) !== before) log('role permissions changed on the website for ' + current.name);
    }
    autoMapPrinters();
    cacheImages().catch((e) => log('images: ' + e.message));
    log('data pulled: ' + JSON.stringify(db.counts()));
    send('catalog-changed', {});
    return { ok: true, user: parsed.user, outlet: parsed.outlet };
  } catch (e) {
    state.lastPullError = e.message; log('pull failed: ' + e.message);
    return { ok: false, error: e.message };
  } finally { state.pulling = false; pushStatus(); }
}

function backgroundPull() {
  if (!current || !online) return;
  pullWith(current.account).catch(() => {});
}

// creds: { email, password } or { pin }
async function signIn(creds) {
  if (!store.cfg.baseUrl) return { ok: false, error: 'Set the website address first (Settings).' };
  const ident = Store.identity(creds).id;
  if (!Store.identity(creds).secret) return { ok: false, error: creds.pin ? 'Type your PIN' : 'Type your email and password' };
  let user = null; let verifiedOnline = false;
  if (online) {
    try {
      const r = await server.login(ident, creds);
      if (!r.ok) return { ok: false, error: creds.pin ? 'Wrong PIN' : 'Wrong email or password' };
      verifiedOnline = true;
      const known = store.sec.accounts[ident];
      if (!db.hasMenu() || !known || !known.userId) {
        const p = await pullWith(ident);
        if (!p.ok && !db.hasMenu()) return { ok: false, error: p.error || 'Could not download the menu' };
        if (p.ok && p.user && p.user.id) user = { id: p.user.id, full_name: p.user.full_name, role: p.user.role, designation: p.user.designation, short_name: p.user.short_name };
      }
      if (!user && known && known.userId) user = db.user(known.userId) || { id: known.userId, full_name: known.name, role: known.role, designation: known.designation };
    } catch (e) {
      log('online sign-in failed, trying offline: ' + e.message);
      online = false; pushStatus();
    }
  }
  if (!verifiedOnline) {
    const a = store.check(creds);
    if (a && a.userId) user = db.user(a.userId) || { id: a.userId, full_name: a.name, role: a.role, designation: a.designation, short_name: a.shortName };
    if (!user) {
      // accounts downloaded from the website (when it provides them): md5 password or PIN
      let u = null;
      if (creds.pin) { const rows = db.userByPin(creds.pin); if (rows.length === 1) u = rows[0]; }
      else { const row = db.userByEmail(creds.email); if (row && row.password && row.password === md5(creds.password)) u = row; }
      if (u) user = u;
    }
    if (!user) return { ok: false, error: 'No internet. This account can sign in offline after it has signed in once with internet on this computer.' };
    if (!db.hasMenu()) return { ok: false, error: 'No internet. The first sign-in needs internet to download the menu.' };
  }
  const u = db.user(user.id) || user;
  const info = { userId: u.id, name: u.full_name || user.full_name || '', role: u.role || user.role || '', designation: u.designation || user.designation || '', shortName: u.short_name || user.short_name || '' };
  const accountId = store.remember(creds, info);
  current = { ...info, account: accountId, isAdmin: isAdminUser(info) };
  log('signed in: ' + current.name + ' (' + (verifiedOnline ? 'online' : 'offline') + ')');
  if (verifiedOnline && db.hasMenu()) backgroundPull();
  state.lastRunningPull = 0;            // running orders straight away
  kick();
  return { ok: true, user: publicUser() };
}

function publicUser() {
  if (!current) return null;
  const { account, ...rest } = current;
  return { ...rest, perms: perms() };
}

// ---------------------------------------------------------------------------------------------
// permissions: the same rules as the website POS. The website gives each role POS functions
// (pos_1 place order, pos_2 cancel order, pos_3 modify order, pos_4 discount, pos_5 charge, pos_6 tips,
// pos_7 remove items already sent, pos_10 KOT, pos_11 invoice, pos_12 bill, pos_13 print last invoice,
// pos_25 direct invoice). Admins can do everything. Waiters cannot take payment, print, or cancel.
function accessOf(userId) {
  const row = db.user(userId);
  try { return row && row.pos_access ? JSON.parse(row.pos_access) : null; } catch { return null; }
}
function isWaiter() { return !!current && String(current.designation || '').trim().toLowerCase() === 'waiter'; }
function can(key) {
  if (!current) return false;
  if (/^admin$/i.test(String(current.role || ''))) return true;
  const a = accessOf(current.userId);
  if (!a || a[key] === undefined) return true;
  return !!a[key];
}
function perms() {
  if (!current) return {};
  const w = isWaiter();
  return {
    placeOrder: can('pos_1'), directInvoice: can('pos_25') && !w, cancelOrder: can('pos_2') && !w, modifyOrder: can('pos_3'),
    addCustomer: can('pos_8'), editCustomer: can('pos_9'),
    discount: can('pos_4'), charge: can('pos_5') && !w, tips: can('pos_6') && !w, removeSent: can('pos_7'),
    kot: can('pos_10') && !w, invoice: can('pos_11') && !w, bill: can('pos_12') && !w, printInvoice: can('pos_13') && !w, lastInvoice: can('pos_13') && !w,
    orderType: !w, chooseWaiter: !w, waiter: w, admin: !!current.isAdmin,
  };
}
function need(flag, what) { if (!perms()[flag]) throw new Error('You are not allowed to ' + what + '. Ask an admin to give your role this permission on the website.'); }

// ---------------------------------------------------------------------------------------------
// orders
function shortNameFor(u) {
  if (u.shortName) return u.shortName;
  const parts = String(u.name || 'U').trim().split(/\s+/);
  return (parts.map((p) => p[0]).join('').slice(0, 3) || 'U').toUpperCase();
}

function newSaleNo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const n = db.nextSaleCounter();
  return shortNameFor(current) + String(d.getFullYear()).slice(-2) + p(d.getMonth() + 1) + p(d.getDate()) + store.cfg.terminalCode + '-' + String(n).padStart(2, '0');
}

function randomCode(n = 15) {
  const c = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const b = crypto.randomBytes(n);
  return [...b].map((x) => c[x % c.length]).join('');
}

// Build local rows from what the screen sent, using the menu in the local database for names,
// prices, taxes and kitchens (never trusting numbers typed in the screen).
function buildSale(input, existing) {
  const s = posSettings();
  const items = new Map(db.all('tbl_food_menus', '1=1').map((i) => [i.id, i]));
  const mods = new Map(db.all('tbl_modifiers', '1=1').map((m) => [m.id, m]));
  const orderType = Number(input.orderType) || 1;
  const prevKot = new Map();
  if (existing) for (const l of existing.lines) prevKot.set(l.id, Number(l.kot_qty) || 0);
  const lines = [];
  for (const l of input.lines || []) {
    const it = items.get(Number(l.food_menu_id));
    const qty = Math.max(0, Number(l.qty) || 0);
    if (!qty) continue;
    let unit;
    if (it) unit = orderType === 2 ? (it.sale_price_take_away || it.sale_price) : orderType === 3 ? (it.sale_price_delivery || it.sale_price) : it.sale_price;
    else unit = Number(l.menu_unit_price) || 0; // item pulled from another till but not in our menu any more
    const lineMods = (l.modifiers || []).map((m) => {
      const mm = mods.get(Number(m.id));
      return { id: Number(m.id), name: mm ? mm.name : m.name, price: mm ? Number(mm.price) || 0 : Number(m.price) || 0, tax_information: mm ? mm.tax_information : '' };
    });
    lines.push({
      id: l.id, food_menu_id: Number(l.food_menu_id), menu_name: it ? it.name : (l.menu_name || ''), qty, menu_unit_price: Number(unit) || 0,
      modifiers: lineMods, discount: l.discount || '', tax_information: it ? it.tax_information : '[]', menu_note: String(l.menu_note || '').slice(0, 150),
      kitchen_id: it ? it.kitchen_id : (l.kitchen_id || null), kitchen_name: it ? it.kitchen_name : (l.kitchen_name || ''),
      item_type: it && /yes/i.test(String(it.bar_item || '')) ? 'Bar Item' : 'Kitchen Item',
      kot_qty: l.id && prevKot.has(l.id) ? Math.min(qty, prevKot.get(l.id)) : Math.min(qty, Number(l.kot_qty) || 0),
    });
  }
  const t = calc.totals({ lines, discount: input.discount, charge: input.charge, tips: input.tips }, s);
  const detailRows = lines.map((l, i) => ({
    food_menu_id: l.food_menu_id, menu_name: l.menu_name, qty: l.qty, tmp_qty: l.qty,
    menu_price_without_discount: t.lines[i].menu_price_without_discount, menu_price_with_discount: t.lines[i].menu_price_with_discount,
    menu_unit_price: l.menu_unit_price, menu_taxes: JSON.stringify(t.lines[i].taxes), menu_discount_value: t.lines[i].menu_discount_value,
    discount_type: t.lines[i].discount_type, menu_note: l.menu_note, discount_amount: t.lines[i].discount_amount, item_type: l.item_type,
    user_id: current.userId, outlet_id: s.outletId || null, kitchen_id: l.kitchen_id, kitchen_name: l.kitchen_name, kot_qty: l.kot_qty,
    modifiers: l.modifiers.map((m) => ({ ...m, menu_taxes: '' })),
  }));
  const now = new Date();
  const header = {
    sale_no: existing ? existing.sale_no : newSaleNo(),
    customer_id: String(input.customerId || s.defaultCustomer || 1), customer_name: input.customerName || 'Walk-in Customer',
    total_items: lines.length, sub_total: t.subTotal, vat: t.vat, total_payable: t.payable,
    total_item_discount_amount: t.itemDiscount, sub_total_with_discount: t.subTotalWithDiscount, sub_total_discount_amount: t.orderDiscount,
    total_discount_amount: t.totalDiscount, charge_type: 'service', delivery_charge: String(t.charge), tips_amount: String(t.tips),
    sub_total_discount_value: t.orderDiscountValue, sub_total_discount_type: t.orderDiscountType,
    sale_date: existing ? existing.sale_date : nowDateTime(now).slice(0, 10),
    date_time: existing ? existing.date_time : nowDateTime(now), order_time: existing ? existing.order_time : nowDateTime(now).slice(11),
    user_id: existing && existing.user_id ? existing.user_id : current.userId, user_name: existing && existing.user_name ? existing.user_name : current.name,
    waiter_id: Number(input.waiterId) || null, waiter_name: input.waiterName || '',
    outlet_id: s.outletId || null, company_id: s.companyId || null, order_type: orderType,
    counter_id: Number(store.cfg.counterId || s.counterId) || 0, sale_vat_objects: JSON.stringify(t.vatObjects),
    random_code: existing && existing.random_code ? existing.random_code : randomCode(), orders_table_text: input.tableName || '',
    table_id: Number(input.tableId) || null, token_number: existing ? existing.token_number || '' : '',
  };
  return { header, detailRows, totals: t, table: input.tableId ? { table_id: Number(input.tableId), persons: Number(input.persons) || 1 } : null };
}

// action: 'kot' (place order: running + kitchen tickets) | 'pay' (invoice: closes the order) | 'bill' (print bill, keep running)
function saveOrder(input) {
  if (!current) throw new Error('Not signed in');
  const existing = input.saleId ? db.saleById(input.saleId) : null;
  if (existing && existing.sync_status !== 'running') throw new Error('This order is already closed');
  const P = perms();
  if (input.action === 'kot') need(existing ? 'modifyOrder' : 'placeOrder', existing ? 'modify orders' : 'place orders');
  if (input.action === 'pay') need(existing ? 'invoice' : 'directInvoice', existing ? 'take payment for orders' : 'make a direct invoice');
  if (input.action === 'bill') need('bill', 'print bills');
  if (String(input.discount || '').trim() && Number(String(input.discount).replace('%', '')) && !P.discount) throw new Error('You are not allowed to give discounts.');
  if ((input.lines || []).some((l) => String(l.discount || '').trim() && Number(String(l.discount).replace('%', ''))) && !P.discount) throw new Error('You are not allowed to give discounts.');
  if (Number(String(input.charge || '').replace('%', '')) && !P.charge) throw new Error('You are not allowed to add a charge.');
  if (Number(input.tips) && !P.tips) throw new Error('You are not allowed to add tips.');
  if (existing && !P.removeSent) {
    const now = new Map((input.lines || []).filter((l) => l.id).map((l) => [Number(l.id), Number(l.qty) || 0]));
    for (const l of existing.lines) if ((Number(l.kot_qty) || 0) > 0 && (now.get(l.id) || 0) < Number(l.kot_qty)) throw new Error('You are not allowed to remove items the kitchen already has (' + l.menu_name + ').');
  }
  if (P.waiter && existing && Number(existing.waiter_id) !== Number(current.userId) && Number(existing.user_id) !== Number(current.userId)) throw new Error('This order belongs to another waiter (' + (existing.waiter_name || '') + ').');
  if (P.waiter) { input.waiterId = current.userId; input.waiterName = current.name; input.orderType = existing ? existing.order_type : 1; }
  if (input.action === 'kot') {
    if (!Number(input.waiterId) && !(existing && Number(existing.waiter_id))) throw new Error('Choose a waiter before placing the order.');
    const type = Number(input.orderType || (existing && existing.order_type) || 1);
    if (type === 1 && !Number(input.tableId) && !(existing && Number(existing.table_id))) throw new Error('Choose a table for a Dine In order.');
  }
  const { header, detailRows, totals, table } = buildSale(input, existing);
  if (!detailRows.length) throw new Error('Add at least one item');
  const action = input.action;
  let payments = [];
  if (action === 'pay') {
    payments = (input.payments || []).filter((p) => Number(p.amount) > 0).map((p) => ({ payment_id: Number(p.payment_id), payment_name: p.payment_name, amount: Number(p.amount) }));
    if (!payments.length) {
      const pm = db.all('tbl_payment_methods')[0];
      payments = [{ payment_id: pm ? pm.id : 1, payment_name: pm ? pm.name : 'Cash', amount: totals.payable }];
    }
    const paid = payments.reduce((a, p) => a + p.amount, 0);
    const given = Number(input.given) || paid;
    // what is kept as paid never exceeds the bill; the rest is change
    let over = Math.max(0, paid - totals.payable);
    for (let i = payments.length - 1; i >= 0 && over > 0; i--) { const cut = Math.min(over, payments[i].amount); payments[i].amount = calc.round(payments[i].amount - cut, totals.precision); over -= cut; }
    payments = payments.filter((p) => p.amount > 0);
    const paidKept = payments.reduce((a, p) => a + p.amount, 0);
    Object.assign(header, {
      order_status: 3, sync_status: 'pending', paid_amount: calc.round(paidKept, totals.precision), due_amount: calc.round(Math.max(0, totals.payable - paidKept), totals.precision),
      given_amount: calc.round(given, totals.precision), change_amount: calc.round(Math.max(0, given - totals.payable), totals.precision),
      payment_method_id: payments[0] ? payments[0].payment_id : null, paid_date_time: nowDateTime(), sync_attempts: 0, sync_error: null,
      kitchen_sync: null,
    });
  } else {
    Object.assign(header, { order_status: 1, sync_status: 'running', paid_amount: 0, due_amount: 0, kitchen_sync: 'pending', server_hash: null });
  }
  // kitchen tickets: only what the kitchen has not had yet
  const toKitchen = [];
  if (action === 'kot' || action === 'pay') {
    detailRows.forEach((d) => {
      const extra = d.qty - (Number(d.kot_qty) || 0);
      if (extra > 0) toKitchen.push({ ...d, qty: extra });
      d.kot_qty = d.qty;
    });
  }
  const saleId = db.saveSale({ ...header, kot_count: (existing ? existing.kot_count : 0) + (toKitchen.length ? 1 : 0) }, detailRows, payments, table);
  const saved = db.saleById(saleId);
  const kitchens = db.all('tbl_kitchens', '1=1');
  let printedTo = [];
  if (toKitchen.length) printedTo = printer.kot(saved, toKitchen, kitchens, { time: nowDateTime() });
  if (action === 'pay' && store.cfg.autoPrintReceipt) printer.receipt(withCustomer(saved), posSettings());
  if (action === 'bill') printer.receipt(withCustomer(saved), posSettings(), { bill: true });
  log(`order ${saved.sale_no} saved (${action}), total ${saved.total_payable}, kitchen: ${printedTo.join(', ') || '-'}`);
  kick();
  pushStatus();
  return { ok: true, saleId, saleNo: saved.sale_no, kitchens: printedTo, sale: saved };
}

// ---------------------------------------------------------------------------------------------
// sync: one worker, one order at a time, so the website never gets the same order twice at once
const RUNNING_PULL_MS = Number(process.env.ROJEY_RUNNING_MS) || 2500;
const MASTER_PULL_MS = Number(process.env.ROJEY_MASTER_MS) || 30 * 1000;
let kickTimer = null;
function kick() { clearTimeout(kickTimer); kickTimer = setTimeout(() => syncOnce().catch((e) => log('sync error ' + e.message)), 100); }

async function withAccount(userId, fn) {
  let acc = store.accountForUser(userId);
  if (!acc || acc.broken) acc = (current && store.sec.accounts[current.account] && !store.sec.accounts[current.account].broken) ? { id: current.account, ...store.sec.accounts[current.account] } : store.anyAccount();
  if (!acc) return { state: 'error', text: 'No saved sign-in can upload this order yet' };
  if (!(await ensureSession(acc))) {
    const other = store.anyAccount();
    if (!other || other.id === acc.id || !(await ensureSession(other))) return { state: 'error', text: 'Sign-in on the website failed' };
    acc = other;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fn(acc.id);
    if (r.state === 'login') { server.loggedIn.delete(acc.id); if (!(await ensureSession(acc))) return { state: 'error', text: 'Sign-in on the website failed' }; continue; }
    if (r.state === 'register') {
      if (!store.cfg.autoOpenRegister) return { state: 'error', text: 'Register closed on the website' };
      await server.openRegister(acc.id, null, store.cfg.counterId);
      continue;
    }
    return r;
  }
  return { state: 'error', text: 'Website kept refusing' };
}

async function syncOnce() {
  if (state.syncing || !online || !store.cfg.baseUrl) return;
  state.syncing = true; pushStatus();
  const s = posSettings();
  try {
    // 0) customers added or changed here -> the website (orders for a new customer wait for its number)
    for (const c of db.pendingCustomers()) {
      if (!online) break;
      const r = await withAccount(current ? current.userId : null, (acc) => server.saveCustomer(acc, c)).catch((e) => ({ state: 'error', text: e.message }));
      const newId = r.state === 'ok' && r.json && Number(r.json.customer_id);
      if (newId) { db.customerSynced(c.id, newId); log('customer ' + c.name + ' saved on the website (' + newId + ')'); send('catalog-changed', {}); }
      else log('customer upload failed ' + c.name + ': ' + (r.text || r.state));
    }
    // 1) paid orders -> Sale/push_online (same upload the web POS uses; the website updates by sale_no, so a repeat never doubles)
    for (const p of db.pendingSales(25)) {
      if (!online) break;
      const sale = db.saleById(p.id);
      if (Number(sale.customer_id) < 0) continue;     // its new customer is not on the website yet
      const json = buildOrderJson(sale, s);
      const r = await withAccount(sale.user_id, async (acc) => {
        const x = await server.push(acc, json, sale.id);
        return x === 'ok' ? { state: 'ok' } : x === 'login' || x === 'register' ? { state: x } : { state: 'error', text: x.replace(/^error:/, '') };
      }).catch((e) => ({ state: 'error', text: e.message, network: true }));
      if (r.state === 'ok') {
        db.markSynced(sale.id, sale.updated_at, store.cfg.baseUrl, json);
        db.log(sale.sale_no, 'ok', '');
        state.lastSync = Date.now(); state.lastError = '';
      } else {
        db.markFailed(sale.id, r.text); db.log(sale.sale_no, 'error', r.text);
        state.lastError = sale.sale_no + ': ' + r.text; log('upload failed ' + state.lastError);
        if (r.network) { online = false; break; }
      }
      pushStatus();
    }
    // 2) orders saved by the previous version of the app
    for (const o of db.legacyPending()) {
      if (!online) break;
      let uid = null; try { uid = JSON.parse(o.order_json).user_id; } catch { /* */ }
      const r = await withAccount(uid, async (acc) => {
        const x = await server.push(acc, o.order_json, o.local_id || o.rid);
        return x === 'ok' ? { state: 'ok' } : x === 'login' || x === 'register' ? { state: x } : { state: 'error', text: x };
      }).catch((e) => ({ state: 'error', text: e.message }));
      if (r.state === 'ok') { db.legacyDone(o.rid); db.log(o.sale_no, 'ok', 'from version 1'); } else db.legacyFailed(o.rid, r.text);
    }
    // 3) running orders -> shared with the website so the kitchen screen and other tills see them
    for (const k of db.kitchenPending(25)) {
      if (!online) break;
      const sale = db.saleById(k.id);
      if (Number(sale.customer_id) < 0) continue;
      const json = buildOrderJson(sale, s, { running: true });
      const r = await withAccount(sale.user_id, (acc) => (k.kitchen_sync === 'cancel' ? server.kitchenCancel(acc, json) : server.kitchenPush(acc, json)))
        .catch((e) => ({ state: 'error', text: e.message }));
      if (r.state === 'ok') db.kitchenDone(sale.id, sale.updated_at, k.kitchen_sync);
      else log('running order share failed ' + sale.sale_no + ': ' + r.text);
    }
    // 4) running orders from other tills
    if (current && Date.now() - state.lastRunningPull > RUNNING_PULL_MS) {
      state.lastRunningPull = Date.now();
      await pullRunningOrders().catch((e) => log('running pull failed: ' + e.message));
    }
    // 5) keep the database small
    const removed = db.purgeSynced(store.cfg.keepSyncedDays);
    if (removed) log('removed ' + removed + ' uploaded orders older than ' + store.cfg.keepSyncedDays + ' days');
  } finally {
    state.syncing = false; pushStatus();
  }
}

// A cashier on the website sees every running order of the outlet; anyone else sees only their own.
// So the till also asks with a cashier sign-in saved on it, and everyone here sees every order.
function cashierUserId() {
  for (const a of Object.values(store.sec.accounts || {})) if (a && !a.broken && a.userId && String(a.designation || '').toLowerCase() === 'cashier') return Number(a.userId);
  return null;
}
const missing = new Map();   // sale_no -> how many pulls in a row did not list it

async function pullRunningOrders() {
  if (!current) return;
  const local = db.runningSaleNos();
  const own = local.filter((r) => r.kitchen_sync === 'pending' || r.kitchen_sync === 'cancel' || (!r.kitchen_sync && r.origin !== 'server')).map((r) => r.sale_no);
  const all = local.map((r) => r.sale_no);
  const askers = [Number(current.userId)];
  const cid = cashierUserId(); if (cid && !askers.includes(cid)) askers.push(cid);
  const rows = new Map(); const invoiced = new Set(); const askedAs = new Set();
  for (const uid of askers) {
    let usedUser = null;
    const r = await withAccount(uid, (acc) => { usedUser = Number((store.sec.accounts[acc] || {}).userId) || null; return server.pullRunning(acc, own, all); }).catch(() => ({ state: 'error' }));
    if (r.state !== 'ok' || !r.json) continue;
    if (usedUser) askedAs.add(usedUser);
    for (const o of r.json.already_invoiced_orders || []) if (o && o.sale_no) invoiced.add(o.sale_no);
    for (const row of r.json.get_all_running_order_for_new_pc || []) if (row && row.sale_no && !rows.has(row.sale_no)) rows.set(row.sale_no, row);
  }
  if (!askedAs.size) return;
  let changed = 0; const modified = [];
  for (const no of invoiced) { if (all.includes(no)) { db.closedElsewhere(no); changed++; } }
  const seen = new Set();
  for (const row of rows.values()) {
    if (!row || !row.sale_no || invoiced.has(row.sale_no)) continue;
    seen.add(row.sale_no);
    const content = typeof row.self_order_content === 'string' ? row.self_order_content : JSON.stringify(row.self_order_content || {});
    const hash = crypto.createHash('sha1').update(content).digest('hex');
    const ex = db.saleByNo(row.sale_no);
    if (ex && (ex.server_hash === hash || ex.sync_status !== 'running' || ex.kitchen_sync === 'pending' || ex.kitchen_sync === 'cancel')) continue;
    // this till's own order, as it sent it: just remember the website's version
    if (ex && !ex.server_hash && ex.origin !== 'server') { db.setServerHash(ex.id, hash); continue; }
    if (ex) modified.push(row.sale_no);
    let o;
    try { o = parseServerOrder(content); } catch { continue; }
    const s = posSettings();
    const t = calc.totals({ lines: o.lines, discount: o.discount, charge: o.charge, tips: o.tips }, s);
    const detailRows = o.lines.map((l, i) => ({
      food_menu_id: l.food_menu_id, menu_name: l.menu_name, qty: l.qty, tmp_qty: l.qty, menu_unit_price: l.menu_unit_price,
      menu_price_without_discount: t.lines[i].menu_price_without_discount, menu_price_with_discount: t.lines[i].menu_price_with_discount,
      menu_taxes: JSON.stringify(t.lines[i].taxes), menu_discount_value: t.lines[i].menu_discount_value, discount_type: t.lines[i].discount_type,
      discount_amount: t.lines[i].discount_amount, menu_note: l.menu_note, kitchen_id: l.kitchen_id, kitchen_name: l.kitchen_name,
      kot_qty: l.qty, item_type: l.item_type, modifiers: l.modifiers, user_id: o.header.user_id, outlet_id: s.outletId || null,
    }));
    const header = {
      ...o.header, total_items: o.lines.length, sub_total: t.subTotal, vat: t.vat, total_payable: t.payable,
      total_item_discount_amount: t.itemDiscount, sub_total_with_discount: t.subTotalWithDiscount, sub_total_discount_amount: t.orderDiscount,
      total_discount_amount: t.totalDiscount, sub_total_discount_value: t.orderDiscountValue, sub_total_discount_type: t.orderDiscountType,
      delivery_charge: String(t.charge), tips_amount: String(t.tips), sale_vat_objects: JSON.stringify(t.vatObjects),
      order_status: 1, sync_status: 'running', origin: 'server', kitchen_sync: 'done', server_hash: hash, outlet_id: s.outletId || null,
      company_id: s.companyId || null, table_id: o.table ? o.table.table_id : null,
    };
    db.saveSale(header, detailRows, [], o.table);
    changed++;
  }
  // a pulled order that the website no longer lists was closed or cancelled on another till
  // An order is taken off this till only when the website says it was paid, or when the person who placed it
  // asks the website and it is gone three times in a row (cancelled there). Orders other people placed are never
  // dropped just because the signed-in person's view of the website does not list them.
  for (const l of local) {
    if (seen.has(l.sale_no) || invoiced.has(l.sale_no)) { missing.delete(l.sale_no); continue; }
    if (l.kitchen_sync === 'pending' || l.kitchen_sync === 'cancel' || !l.server_hash) continue;
    if (!askedAs.has(Number(l.user_id))) continue;
    const n = (missing.get(l.sale_no) || 0) + 1; missing.set(l.sale_no, n);
    if (n >= 3) { missing.delete(l.sale_no); db.closedElsewhere(l.sale_no); changed++; log('running order ' + l.sale_no + ' is no longer on the website: closed here'); }
  }
  if (changed) { log('running orders updated from the website: ' + changed); send('running-changed', { modified }); }
}

// ---------------------------------------------------------------------------------------------
// item pictures: kept on this computer so the menu looks the same with no internet
let cachingImages = false;
async function cacheImages() {
  if (cachingImages) return;
  cachingImages = true;
  try {
    const { net } = require('electron');
    const { pathToFileURL } = require('url');
    const dir = path.join(app.getPath('userData'), 'images');
    fs.mkdirSync(dir, { recursive: true });
    const items = db.all('tbl_food_menus', "photo IS NOT NULL AND photo <> ''");
    let changed = 0;
    const work = items.filter((it) => !/image_thumb/i.test(it.photo));
    const one = async (it) => {
      let url;
      try { url = new URL(it.photo, store.cfg.baseUrl).toString(); } catch { return; }
      const ext = (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.exec(url) || [, 'img'])[1].toLowerCase();
      const file = path.join(dir, crypto.createHash('sha1').update(url).digest('hex').slice(0, 20) + '.' + ext);
      if (!fs.existsSync(file)) {
        if (!online) return;
        try {
          const r = await net.fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!r.ok || !/^image\//i.test(r.headers.get('content-type') || '')) return;
          fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
        } catch { return; }
      }
      const local = pathToFileURL(file).toString();
      if (it.local_image !== local) { db.db.prepare('UPDATE tbl_food_menus SET local_image=? WHERE id=?').run(local, it.id); changed++; }
    };
    for (let i = 0; i < work.length; i += 4) await Promise.all(work.slice(i, i + 4).map(one));
    if (changed) { log('item pictures saved: ' + changed); send('catalog-changed', {}); }
  } finally { cachingImages = false; }
}

// ---------------------------------------------------------------------------------------------
// printers
async function windowsPrinters() {
  const wc = win && !win.isDestroyed() ? win.webContents : null;
  if (!wc) return [];
  try { return (await wc.getPrintersAsync()).map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault })); } catch { return []; }
}

// A kitchen with no printer chosen yet gets the Windows printer whose name matches the website's printer.
async function autoMapPrinters() {
  try {
    const list = await windowsPrinters();
    if (!list.length) return;
    const names = list.map((p) => p.name);
    const printers = new Map(db.all('tbl_printers', '1=1').map((p) => [p.id, p]));
    const map = { ...(store.cfg.kitchenPrinters || {}) };
    let changed = false;
    for (const k of db.all('tbl_kitchens', '1=1')) {
      if (map[String(k.id)]) continue;
      const p = printers.get(k.printer_id);
      const cands = [p && p.path, p && p.title, k.name].filter(Boolean).map((x) => String(x).toLowerCase());
      const hit = names.find((n) => cands.includes(n.toLowerCase())) || names.find((n) => cands.some((c) => c.length > 2 && n.toLowerCase().includes(c)));
      if (hit) { map[String(k.id)] = hit; changed = true; }
    }
    if (changed) store.saveConfig({ kitchenPrinters: map });
  } catch (e) { log('auto map printers: ' + e.message); }
}

// ---------------------------------------------------------------------------------------------
// IPC
function needUser() { if (!current) throw new Error('Not signed in'); }
function needAdmin() { needUser(); if (!current.isAdmin) throw new Error('Admins only'); }

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => {
    try { return await fn(...a); } catch (e) { log('ipc ' + ch + ' failed: ' + e.message); return { ok: false, error: e.message }; }
  });
  h('app:state', () => ({ configured: !!store.cfg.baseUrl, hasData: db.hasMenu(), online, user: publicUser(), status: statusPayload(), settings: posSettings(), version: app.getVersion(),
    outletName: posSettings().outletName || '', accounts: Object.values(store.sec.accounts).map((a) => a.name).filter(Boolean) }));
  h('auth:login', (creds) => signIn(creds));
  h('auth:logout', () => { log('signed out: ' + (current && current.name)); current = null; setImmediate(goHome); setTimeout(autoInstall, 3000); return { ok: true }; });
  h('nav', (where) => {
    if (where === 'setup') { if (store.cfg.baseUrl && db.hasMenu() && !(current && current.isAdmin)) throw new Error('Only an admin can open Settings'); win.loadFile(ui('setup.html')); }
    else if (where === 'sales') { needAdmin(); win.loadFile(ui('sales.html')); }
    else goHome();
    return { ok: true };
  });
  h('pos:catalog', () => { needUser(); return { ...db.catalog(), settings: posSettings(), user: publicUser() }; });
  h('pos:running', () => {
    needUser();
    const list = db.runningOrders();     // every running order, for everyone on this till
    return list.map((s) => ({ ...s, lines: db.saleById(s.id).lines.length }));
  });
  h('pos:get', (id) => { needUser(); return db.saleById(id); });
  h('pos:kots', (saleNo) => { needUser(); return db.kotsFor(saleNo); });
  // people an order can be given to: waiters and everyone else who uses the till
  h('pos:customerSave', (c) => {
    needUser();
    need(Number(c && c.id) > 0 ? 'editCustomer' : 'addCustomer', Number(c && c.id) > 0 ? 'edit customers' : 'add customers');
    if (!c || !String(c.name || '').trim()) throw new Error('Type the customer name');
    if (Number(c.id) === 1) throw new Error('Walk-in Customer cannot be edited');
    const row = db.saveCustomer(c);
    log('customer ' + (Number(c.id) > 0 ? 'changed' : 'added') + ': ' + row.name);
    kick();
    return { ok: true, customer: row };
  });
  h('pos:people', () => {
    needUser();
    const waiterIds = new Set(db.waiters().map((w) => Number(w.id)));
    return db.all('tbl_users', "del_status IS NULL OR del_status='Live'", 'full_name')
      .filter((u) => u.full_name).map((u) => ({ id: u.id, name: u.full_name, designation: u.designation || (waiterIds.has(Number(u.id)) ? 'Waiter' : ''), waiter: waiterIds.has(Number(u.id)) || String(u.designation || '').toLowerCase() === 'waiter' }));
  });
  // give running orders to another person, e.g. when the person who took them has signed out
  h('pos:assign', (saleIds, userId) => {
    needUser(); need('modifyOrder', 'change orders');
    if (isWaiter()) throw new Error('Waiter accounts cannot give orders to other people.');
    const u = db.user(Number(userId)); if (!u) throw new Error('Person not found');
    const isW = db.waiters().some((w) => Number(w.id) === Number(u.id)) || String(u.designation || '').toLowerCase() === 'waiter';
    let n = 0;
    for (const id of [].concat(saleIds)) {
      const s = db.saleById(Number(id)); if (!s || s.sync_status !== 'running') continue;
      db.assignSale(s.id, isW ? { waiter_id: u.id, waiter_name: u.full_name } : { user_id: u.id, user_name: u.full_name });
      n++;
    }
    log(n + ' running order(s) given to ' + u.full_name + ' by ' + current.name);
    kick(); send('running-changed', {});
    return { ok: true, count: n, to: u.full_name, as: isW ? 'waiter' : 'person in charge' };
  });
  h('update:state', () => updater.state);
  h('update:check', async () => { needAdmin(); updater.forced = true; return updater.check(); });
  h('update:install', () => { needAdmin(); return updater.install(); });
  h('pos:kotAgain', (id) => {
    needUser(); need('kot', 'print KOT');
    const k = db.kotById(id); if (!k) throw new Error('KOT copy not found');
    const c = store.cfg; for (const dev of String(k.printers || '').split(', ')) printer.print(k.html, /^Windows default printer$/.test(dev) ? '' : dev, 1, 'kot-' + k.kitchen);
    return { ok: true };
  });
  h('pos:save', (input) => saveOrder(input));
  h('pos:cancel', (id) => { needUser(); need('cancelOrder', 'cancel orders'); db.cancelSale(id); kick(); pushStatus(); return { ok: true }; });
  h('pos:reprintKot', (id, lineIds) => {
    needUser(); need('kot', 'print KOT');
    const sale = db.saleById(id);
    if (!sale) throw new Error('Order not found');
    const pick = sale.lines.filter((l) => !lineIds || lineIds.includes(l.id));
    if (!pick.length) throw new Error('Pick at least one item');
    const to = printer.kot(sale, pick, db.all('tbl_kitchens', '1=1'), { reprint: true, time: nowDateTime() });
    return { ok: true, kitchens: to };
  });
  h('pos:reprintReceipt', (id) => { needUser(); need('printInvoice', 'print invoices'); const sale = db.saleById(id); if (!sale) throw new Error('Order not found'); printer.receipt(withCustomer(sale), posSettings(), { reprint: true }); return { ok: true }; });
  h('pos:lastInvoice', () => {
    needUser(); need('lastInvoice', 'print the last invoice');
    const sale = db.lastPaidSale();
    if (!sale) throw new Error('There is no invoice yet');
    printer.receipt(withCustomer(sale), posSettings(), { reprint: true });
    return { ok: true, saleNo: sale.sale_no };
  });
  h('print:retry', (id) => printer.retry(id));
  h('pos:printBill', (id) => { needUser(); need('bill', 'print bills'); const sale = db.saleById(id); printer.receipt(withCustomer(sale), posSettings(), { bill: true }); return { ok: true }; });
  h('sales:list', (f) => { needAdmin(); return db.listSales(f || {}); });
  h('sync:now', async () => { needUser(); await probe(); state.lastRunningPull = 0; await syncOnce(); return statusPayload(); });
  h('data:refresh', async () => { needUser(); if (!online) throw new Error('No internet'); return pullWith(current.account); });
  h('status', () => statusPayload());

  // settings
  h('setup:get', async () => ({ cfg: { ...store.cfg }, taxNames: taxNamesInMenu(), kitchens: db.all('tbl_kitchens', '1=1'), printers: await windowsPrinters(), pending: db.syncCounts().pending + db.legacyPending().length, hasData: db.hasMenu(), isAdmin: !!(current && current.isAdmin), signedIn: !!current }));
  h('setup:test-site', async (url) => {
    const base = normalizeBaseUrl(url);
    if (!base) return { ok: false, error: 'That is not a website address' };
    const old = store.cfg.baseUrl; store.cfg.baseUrl = base;
    try {
      const ok = await server.ping(8000);
      return ok ? { ok: true, baseUrl: base } : { ok: false, error: 'The website did not answer' };
    } catch (e) { return { ok: false, error: 'Could not reach it: ' + e.message }; } finally { store.cfg.baseUrl = old; }
  });
  h('setup:test-print', async (name, what) => { await printer.test(name, what); return { ok: true }; });
  h('setup:save', async (cfg) => {
    if (store.cfg.baseUrl && db.hasMenu() && !(current && current.isAdmin)) throw new Error('Only an admin can change Settings');
    const patch = {};
    for (const k of ['receiptPrinter', 'kitchenPrinter', 'kitchenPrinters', 'paperWidth', 'autoPrintReceipt', 'kotCopies', 'receiptCopies', 'keepSyncedDays', 'autoOpenRegister', 'counterId', 'startFullscreen', 'taxesOn', 'taxNames', 'autoUpdate']) if (cfg[k] !== undefined) patch[k] = cfg[k];
    if (cfg.baseUrl !== undefined) {
      const base = normalizeBaseUrl(cfg.baseUrl);
      if (!base) throw new Error('Type the website address');
      if (base !== store.cfg.baseUrl) {
        log('website address changed from ' + store.cfg.baseUrl + ' to ' + base + '; waiting orders will upload to the new address');
        patch.baseUrl = base;
        server.loggedIn.clear();
        online = false;
      }
    }
    patch.keepSyncedDays = Math.max(0, Math.min(60, Number(patch.keepSyncedDays != null ? patch.keepSyncedDays : store.cfg.keepSyncedDays) || 0));
    store.saveConfig(patch);
    setTimeout(probe, 10);
    return { ok: true };
  });
  h('setup:done', () => { goHome(); return { ok: true }; });
  h('app:quit', () => { app.quit(); return { ok: true }; });
  h('app:zoom', (step) => { if (step === 0) setZoom(0, 0); else setZoom(Number(step) || 0); return { ok: true, level: win.webContents.getZoomLevel() }; });
  h('app:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); return { ok: true }; });
  h('app:logs', () => { shell.openPath(app.getPath('userData')); return { ok: true }; });
}

// ---------------------------------------------------------------------------------------------
function buildMenu() {
  const go = (w) => () => { if (!win) return; if (w === 'setup') { if (!(store.cfg.baseUrl && db.hasMenu()) || (current && current.isAdmin)) win.loadFile(ui('setup.html')); } else if (w === 'sales') { if (current && current.isAdmin) win.loadFile(ui('sales.html')); } else goHome(); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Rojey POS', submenu: [
      { label: 'POS', accelerator: 'F2', click: go('pos') },
      { label: 'Sales on this computer', accelerator: 'F3', click: go('sales') },
      { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: go('setup') },
      { type: 'separator' },
      { label: 'Sync now', accelerator: 'F9', click: () => { state.lastRunningPull = 0; probe().then(() => syncOnce()); } },
      { label: 'Reload', accelerator: 'F5', click: () => win && win.reload() },
      { label: 'Full screen', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
      { label: 'Bigger', accelerator: 'CmdOrCtrl+=', click: () => setZoom(0.5) },
      { label: 'Bigger ', accelerator: 'CmdOrCtrl+Plus', visible: false, acceleratorWorksWhenHidden: true, click: () => setZoom(0.5) },
      { label: 'Bigger  ', accelerator: 'CmdOrCtrl+numadd', visible: false, acceleratorWorksWhenHidden: true, click: () => setZoom(0.5) },
      { label: 'Smaller', accelerator: 'CmdOrCtrl+-', click: () => setZoom(-0.5) },
      { label: 'Smaller ', accelerator: 'CmdOrCtrl+numsub', visible: false, acceleratorWorksWhenHidden: true, click: () => setZoom(-0.5) },
      { label: 'Normal size', accelerator: 'CmdOrCtrl+0', click: () => setZoom(0, 0) },
      { label: 'Normal size ', accelerator: 'CmdOrCtrl+num0', visible: false, acceleratorWorksWhenHidden: true, click: () => setZoom(0, 0) },
      { label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) },
      { label: 'Developer tools', accelerator: 'CmdOrCtrl+Shift+I', click: () => win && win.webContents.toggleDevTools() },
      { type: 'separator' },
      { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
    ] },
  ]));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
// an update that is ready installs when the app is closed (the next start is the new version)
app.on('before-quit', () => { try { if (updater && updater.canInstall()) updater.install(false, 'app closed'); } catch { /* */ } });

// Automatic updates: installed by themselves when nobody is signed in (the till is not in use),
// or when the app is closed. An admin can also install at once with the update button.
function autoInstall() {
  if (!updater || !updater.canInstall() || current || store.cfg.autoUpdate === false) return;
  if (state.syncing) { setTimeout(autoInstall, 5000); return; }
  updater.install(true, 'nobody signed in');
}
app.on('web-contents-created', (_e, wc) => { wc.on('will-prevent-unload', (ev) => ev.preventDefault()); });

app.whenReady().then(() => {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  store = new Store(dir, safeStorage);
  db = new Db(path.join(dir, 'rojey-pos.db'));
  server = new Server(() => store.cfg.baseUrl, log);
  printer = new Printer(() => store.cfg, log, (e) => send('print-error', e));
  printer.onKot = (k) => db.saveKot({ ...k, userName: current ? current.name : '' });
  updater = new Updater({ app, getCfg: () => store.cfg, log, onState: (st) => { send('update', st); if (st.status === 'ready') setTimeout(autoInstall, 5000); } });
  updater.start();
  log('start ' + app.getVersion() + ' site=' + store.cfg.baseUrl + ' ' + JSON.stringify(db.syncCounts()));
  registerIpc();
  buildMenu();
  createWindow();
  probe();
  setInterval(() => probe(), Number(process.env.ROJEY_PROBE_MS) || 10000);
  setInterval(() => syncOnce().catch((e) => log('sync error ' + e.message)), Number(process.env.ROJEY_SYNC_MS) || 3000);
  // changes made on the website (menu, prices, tables, users, permissions) arrive by themselves
  setInterval(() => { if (current && online && Date.now() - db.get('last_pull', 0) > MASTER_PULL_MS - 1000) backgroundPull(); }, Math.min(MASTER_PULL_MS, 30000));
  setInterval(pushStatus, 5000);
});

module.exports = { normalizeBaseUrl };
