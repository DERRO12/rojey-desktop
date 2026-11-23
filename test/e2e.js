// End-to-end test: runs the real app against a fake iRestora website and checks the whole flow.
//   node test/e2e.js        (needs a display; in CI wrap with xvfb-run)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const { createFakeServer } = require('./fake-server');
const http = require('http');
const crypto = require('crypto');

// a fake GitHub "latest release" for the automatic update check
const GH = { release: null, bytes: Buffer.from('fake Rojey POS installer ' + 'x'.repeat(20000)) };
const ghServer = http.createServer((req, res) => {
  if (req.url === '/releases/latest') { if (!GH.release) { res.writeHead(404); return res.end('{}'); } res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(GH.release)); }
  if (req.url.startsWith('/dl/')) { res.writeHead(200, { 'Content-Length': GH.bytes.length }); return res.end(GH.bytes); }
  res.writeHead(404); res.end();
});

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NODE_OPTIONS', 'ALL_PROXY', 'all_proxy']) delete process.env[k];

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rojey-e2e-'));
const USER_DATA = path.join(TMP, 'data');
const PRINT_DIR = path.join(TMP, 'prints');
const SHOTS = process.env.SHOTS || path.join(TMP, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0; let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000, step = 200) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(step); }
}
const prints = () => (fs.existsSync(PRINT_DIR) ? fs.readdirSync(PRINT_DIR).sort() : []);

function listen(server) { return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))); }

async function launch() {
  const app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, ROJEY_USER_DATA: USER_DATA, ROJEY_PRINT_DIR: PRINT_DIR, ROJEY_PROBE_MS: '700', ROJEY_SYNC_MS: '600', ROJEY_MASTER_MS: '4000' },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('  [page error] ' + e.message));
  return { app, page };
}
const call = (page, ch, ...a) => page.evaluate(([c, args]) => window.rojey.call(c, ...args), [ch, a]);
async function onPage(page, file) { return waitFor(async () => { try { return page.url().endsWith(file) && (await page.evaluate(() => document.readyState)) === 'complete'; } catch { return false; } }); }

(async () => {
  const A = createFakeServer(); const portA = await listen(A.server);
  const B = createFakeServer(); const portB = await listen(B.server);
  const urlA = `http://127.0.0.1:${portA}/`; const urlB = `http://127.0.0.1:${portB}/`;
  const ghPort = await listen(ghServer);
  Object.assign(process.env, { ROJEY_UPDATE_API: `http://127.0.0.1:${ghPort}/releases/latest`, ROJEY_UPDATE_FIRST_MS: '1500', ROJEY_UPDATE_MS: '3000', ROJEY_UPDATE_DRYRUN: '1' });
  let { app, page } = await launch();

  console.log('first run: settings');
  check('opens Settings on first run', await onPage(page, 'setup.html'));
  check('credit line on the settings screen', /Designed by Derrick Mugooba/.test(await page.textContent('.rj-credit')));
  await page.fill('#baseUrl', `127.0.0.1:${portA}`.replace(/^/, 'http://'));
  await page.click('#check');
  check('Check finds the website', await waitFor(async () => /Found it/.test(await page.textContent('#siteMsg'))));
  await page.click('#save');
  check('goes to sign in after saving', await onPage(page, 'login.html'));
  check('credit line on the opening screen', /Derrick Mugooba · Mauzo Books · 0755933629/.test((await page.textContent('.rj-credit')).replace(/\s+/g, ' ')));

  console.log('sign in online (email) and download');
  await page.fill('#email', 'admin@x.com'); await page.fill('#password', 'wrong');
  await page.click('#go_pass');
  check('wrong password refused', await waitFor(async () => /Wrong/.test(await page.textContent('#err'))));
  await page.fill('#password', 'secret'); await page.click('#go_pass');
  check('POS opens after sign in', await onPage(page, 'pos.html'));
  check('menu shows items', await waitFor(async () => (await page.$$('#rj_items .single_item')).length === 4), await page.$$eval('#rj_items .single_item', (x) => x.length));
  const cat = await call(page, 'pos:catalog');
  check('kitchens, tables, payments, waiters downloaded', cat.kitchens.length === 3 && cat.tables.length === 2 && cat.paymentMethods.length === 2 && cat.waiters.length >= 2,
    { k: cat.kitchens.length, t: cat.tables.length, p: cat.paymentMethods.length, w: (cat.waiters || []).length });
  check('taxes are off by default', (await call(page, 'pos:catalog')).settings.collectTax === 'No');
  await call(page, 'setup:save', { taxesOn: true });
  check('admin turns taxes on in Settings', (await call(page, 'pos:catalog')).settings.collectTax === 'Yes');
  check('item picture saved on this computer', await waitFor(async () => /^file:/.test(await page.getAttribute('#item_30 img', 'src') || '')), await page.getAttribute('#item_30 img', 'src'));
  await page.screenshot({ path: path.join(SHOTS, 'pos-empty.png') });

  console.log('screen size: Ctrl + / Ctrl -');
  const z1 = await call(page, 'app:zoom', 0.5);
  check('Ctrl + makes the screen bigger', z1.level === 0.5, z1);
  const z2 = await call(page, 'app:zoom', -1);
  check('Ctrl - makes the screen smaller', z2.level === -0.5, z2);
  await call(page, 'app:zoom', 0);
  check('Ctrl 0 goes back to normal and is remembered', (await call(page, 'setup:get')).cfg.zoomLevel === 0);

  console.log('two printers for one kitchen');
  const cafeK = cat.kitchens.find((k) => /cafe/i.test(k.name));
  await call(page, 'setup:save', { kitchenPrinters: { [String(cafeK.id)]: ['CafeA', 'CafeB'] } });

  console.log('place order: KOT goes to each kitchen at once');
  const before = prints().length;
  await page.click('#item_10');                       // burger: modifiers
  await page.waitForSelector('.rj-modal');
  await page.check('.rj-modal input[type=checkbox]');
  await page.click('.rj-modal .rj-primary');
  await page.click('#item_20');                       // mojito: variation
  await page.click('.rj-modal .rj-tile');
  await page.click('#item_30');
  await page.click('#item_30');                       // 2 cappuccino merge into one line
  check('cart has 3 lines', (await page.$$('#rj_cart [data-key]')).length === 3);
  await page.screenshot({ path: path.join(SHOTS, 'pos-cart.png') });
  await page.click('#place_order');
  check('Dine In with no table asks for a table first', await waitFor(async () => !!(await page.$('#show_tables_modal2 .all-dineIn-table'))) && prints().length === before);
  await page.click('#show_tables_modal2 [data-name="T2"]');
  await waitFor(async () => !(await page.$('#show_tables_modal2')));
  await page.click('#place_order');
  const kots = await waitFor(() => { const n = prints().slice(before); return n.length >= 3 && n; });
  check('KOT printed to Kitchen, Bar and Cafe', kots && ['Kitchen', 'Bar', 'Cafe'].every((k) => kots.some((f) => f.includes('kot-' + k))), kots);
  const firstNo = (await call(page, 'pos:running'))[0].sale_no;
  const copies = await call(page, 'pos:kots', firstNo);
  check('a copy of each KOT is kept on this computer', copies.length === 3 && copies.every((k) => k.lines.length), copies.map((k) => k.kitchen));
  check('uploaded data kept 12 days by default', (await call(page, 'setup:get')).cfg.keepSyncedDays === 12);
  await page.click('#order_details_holder .single_order');
  await page.click('#select_waiter + #rj_waiter_pick');
  await page.fill('#rj_waiter_list input', 'ann');
  check('waiter list can be searched by typing', await waitFor(async () => (await page.$$('#rj_waiter_list [data-id]')).length === 1 && /Ann/.test(await page.textContent('#rj_waiter_list'))));
  check('waiter list shows only waiters', (await call(page, 'pos:catalog')).waiters.every((w) => [7, 8].includes(Number(w.id))), (await call(page, 'pos:catalog')).waiters);
  await page.keyboard.press('Escape');
  const cafeKots = await waitFor(() => { const n = prints().slice(before).filter((f) => f.includes('kot-Cafe')); return n.length >= 2 && n; });
  check('Cafe KOT printed on both Cafe printers', cafeKots && cafeKots.some((f) => f.includes('CafeA')) && cafeKots.some((f) => f.includes('CafeB')), prints().slice(before));
  let running = await call(page, 'pos:running');
  check('order is running', running.length === 1, running);
  const r1 = running[0];
  check('running order shared with website', await waitFor(async () => A.S.kitchen.has(r1.sale_no)));
  const s1 = await call(page, 'pos:get', r1.id);
  check('totals with 16% VAT on top', Math.abs(s1.total_payable - ((500 + 50) * 1.16 + 400 + 500)) < 0.01, s1.total_payable);

  console.log('reprint asks what to print');
  const b2 = prints().length;
  const cappLine = s1.lines.find((l) => l.food_menu_id === 30);
  const rp = await call(page, 'pos:reprintKot', r1.id, [cappLine.id]);
  const rpf = await waitFor(() => { const n = prints().slice(b2); return n.length >= 2 && n; });
  check('reprint only the chosen item, to both Cafe printers', rp.ok && rpf.length === 2 && rpf.every((f) => f.includes('kot-Cafe')) && /REPRINT/.test(fs.readFileSync(path.join(PRINT_DIR, rpf[0]), 'utf8')), rpf);

  console.log('pay the running order');
  await page.click(`#order_details_holder .single_order[data-id="${r1.id}"]`);
  await page.click('#create_invoice_and_close');
  await page.waitForSelector('#rj_p_submit');
  await page.fill('#rj_p_given', '3000');
  const b3 = prints().length;
  await page.click('#rj_p_submit');
  check('uploaded to the website', await waitFor(() => A.S.sales.has(r1.sale_no)));
  const up = A.S.sales.get(r1.sale_no);
  check('uploaded as the cashier who took it (admin id 1)', up && up.user_id === 1, up && up.user_id);
  check('no extra KOT when paying an already sent order', await waitFor(() => { const n = prints().slice(b3); return n.length >= 1 && n; }, 3000) && prints().slice(b3).every((f) => !f.includes('kot-')), prints().slice(b3));
  check('change computed', (await call(page, 'pos:get', r1.id)).change_amount > 0);

  console.log('direct invoice');
  await page.click('#item_11');
  await page.click('#direct_invoice');
  await page.click('#rj_p_submit');
  await sleep(300);
  let list = await call(page, 'sales:list', {});
  const fries = list.find((x) => x.sale_no !== r1.sale_no);
  check('direct sale uploaded', await waitFor(() => A.S.sales.has(fries.sale_no)));
  check('fries KOT printed to Kitchen on direct invoice', prints().some((f) => f.includes('kot-Kitchen')));
  const bLast = prints().length;
  const last = await call(page, 'pos:lastInvoice');
  check('Print last invoice prints the last sale', last.ok && last.saleNo === fries.sale_no && await waitFor(() => prints().slice(bLast).some((f) => f.includes('receipt'))), last);
  check('Print last invoice button on screen', await page.isVisible('#print_last_invoice'));

  console.log('a ticket that does not print is reported');
  await call(page, 'setup:test-print', 'OFFLINE-Bar', 'Bar KOT printer');
  check('printing failure shown on screen', await waitFor(async () => /did not print on OFFLINE-Bar/.test((await page.textContent('#rj_print_errors').catch(() => '')) || '')));
  check('the reason is given', /offline/i.test(await page.textContent('#rj_print_errors .rj-pe-why')));
  await page.click('#rj_print_errors [data-pe-retry]');
  check('Print again tries again and reports again while the printer is still off', await waitFor(async () => (await page.$$('#rj_print_errors .rj-pe-item')).length === 1));
  await page.screenshot({ path: path.join(SHOTS, 'print-error.png') });
  await page.click('#rj_print_errors .rj-pe-close');
  check('closing the report removes it', !(await page.$('#rj_print_errors')));

  console.log('running orders from other tills');
  A.S.addRemoteRunning('CJ261122W1-07', 1);
  await call(page, 'sync:now');
  running = await call(page, 'pos:running');
  const remote = running.find((x) => x.sale_no === 'CJ261122W1-07');
  check('pulled the other till\'s running order', !!remote, running.map((x) => x.sale_no));
  check('pulled order shows in the list on screen', await waitFor(async () => (await page.$$('#order_details_holder .single_order')).length === 1));
  A.S.kitchen.delete('CJ261122W1-07');
  await call(page, 'sync:now');
  check('an order not listed once is kept (no orders lost on a hiccup)', !!(await call(page, 'pos:running')).find((x) => x.sale_no === 'CJ261122W1-07'));
  await call(page, 'sync:now'); await call(page, 'sync:now');
  running = await call(page, 'pos:running');
  check('order closed elsewhere disappears', !running.find((x) => x.sale_no === 'CJ261122W1-07'), running);

  console.log('tables look and work like the website');
  await page.click('#rj_table_btn');
  check('table screen opens', await waitFor(async () => !!(await page.$('#show_tables_modal2 .all-dineIn-table'))));
  check('areas from the website listed', (await page.$$('#show_tables_modal2 .get_area_table')).length === 2);
  check('floor plan drawn as designed on the website', !!(await page.$('#show_tables_modal2 .all-dineIn-table.table_bg_1 .div_rectangular.img_bg_4 [data-name="T1"]')));
  check('nothing from the floor plan can run', !(await page.$('#show_tables_modal2 script, #show_tables_modal2 [onclick]')));
  check('rotated table name kept upright', /rotate\(-90deg\)/.test(await page.getAttribute('#show_tables_modal2 [data-name="T2"]', 'style') || ''));
  await page.screenshot({ path: path.join(SHOTS, 'tables-empty.png') });
  await page.click('#show_tables_modal2 [data-name="T1"]');
  check('picking a free table sets it on the order', await waitFor(async () => /T1/.test(await page.textContent('#rj_table_btn'))) && !(await page.$('#show_tables_modal2')));
  await page.click('#item_11');
  await page.click('#place_order');
  await waitFor(async () => (await call(page, 'pos:running')).some((r) => r.orders_table_text === 'T1'));
  const t1 = (await call(page, 'pos:running')).find((r) => r.orders_table_text === 'T1');
  await sleep(1100);
  await page.click('#item_30');
  await page.click('.take_away_button');
  await page.click('#place_order');
  await sleep(400);
  running = await call(page, 'pos:running');
  check('newest running order on top', running.length >= 2 && running[0].id > running[1].id, running.map((r) => r.id));
  check('newest order first on screen', await waitFor(async () => Number(await page.getAttribute('#order_details_holder .single_order', 'data-id')) === running[0].id));
  await page.click('#rj_table_btn');
  await page.waitForSelector('#show_tables_modal2 .rj-booked');
  check('busy table coloured with the website colours', /rgb\(255, 217, 214\)/.test(await page.getAttribute('#show_tables_modal2 .rj-booked', 'style') || ''), await page.getAttribute('#show_tables_modal2 .rj-booked', 'style'));
  check('busy table shows waiter and order number', /Waiter Tom/.test(await page.textContent('#show_tables_modal2 .rj-booked')) && (await page.textContent('#show_tables_modal2 .rj-booked')).includes(t1.sale_no.split('-')[1]));
  await page.click('#show_tables_modal2 .rj-booked');
  check('tapping a busy table picks its order', (await page.textContent('#rj_table_info')).includes(t1.sale_no));
  await page.screenshot({ path: path.join(SHOTS, 'tables-busy.png') });
  await page.click('#show_tables_modal2 .set_quick_action[data-act="modify"]');
  check('Modify Order from the table opens it in the cart', await waitFor(async () => /Update Order/.test(await page.textContent('#place_edit_order'))));
  await page.click('#cancel_button');
  if (await page.$('.rj-modal .rj-primary')) await page.click('.rj-modal .rj-primary');

  console.log('an order changed on the website updates here');
  await waitFor(async () => { const x = await call(page, 'pos:get', t1.id); return x && x.server_hash; }, 8000);
  const k1 = A.S.kitchen.get(t1.sale_no); const o1 = JSON.parse(k1.content); o1.items[0].qty = '3'; k1.content = JSON.stringify(o1);
  check('order changed on the website updates on this till', await waitFor(async () => { const x = await call(page, 'pos:get', t1.id); return x && x.lines[0] && Number(x.lines[0].qty) === 3; }, 10000));
  await page.fill('#search_running_orders', t1.sale_no);
  check('running-order search finds the order', await waitFor(async () => (await page.$$('#order_details_holder .single_order')).length === 1 && /1 of \d+ orders/.test(await page.textContent('#rj_order_count'))));
  await page.click('#rj_clear_order_search');
  check('clearing the search shows all orders', await waitFor(async () => (await page.$$('#order_details_holder .single_order')).length >= 2));

  console.log('give an order to another person');
  const asW = await call(page, 'pos:assign', [t1.id], 8);
  check('order given to another waiter', asW.ok && asW.as === 'waiter' && (await call(page, 'pos:get', t1.id)).waiter_name === 'Waiter Ann', asW);
  check('the website gets the new waiter', await waitFor(() => { const k = A.S.kitchen.get(t1.sale_no); return k && JSON.parse(k.content).waiter_name === 'Waiter Ann'; }, 10000));
  const people = await call(page, 'pos:people');
  check('anyone can be picked to take an order', people.some((p) => p.name === 'Admin User') && people.some((p) => p.name === 'Waiter Ann'), people);
  await page.dblclick(`#order_details_holder .single_order[data-id="${t1.id}"]`);
  check('Assign to… button in the order details', await waitFor(async () => /Assign to/.test(await page.textContent('.rj-modal').catch(() => ''))));
  await page.keyboard.press('Escape');

  console.log('customers for delivery');
  check('customer phone numbers come from the website', (await call(page, 'pos:catalog')).customers.some((c) => c.name === 'Mary' && c.phone === '0711'));
  const pc = await call(page, 'pos:customerSave', { name: 'Peter Okello', phone: '0772 111222', address: 'Plot 5, Arua' });
  check('new customer saved on this computer at once', pc.ok && pc.customer.id < 0, pc);
  check('new customer added on the website', await waitFor(() => A.S.customers && [...A.S.customers.values()].some((c) => c.name === 'Peter Okello' && c.phone === '0772 111222' && c.address === 'Plot 5, Arua'), 10000));
  check('the website\'s customer number is used here', await waitFor(async () => (await call(page, 'pos:catalog')).customers.some((c) => c.name === 'Peter Okello' && c.id >= 100), 10000));
  await page.click('.delivery_button');
  await page.click('#item_30');
  await page.click('#place_order');
  check('a delivery order asks for the customer', await waitFor(async () => page.isVisible('#rj_customer_list')));
  await page.fill('#rj_customer_list input', '0772');
  check('customers can be found by phone number', await waitFor(async () => (await page.$$('#rj_customer_list [data-id]')).length === 1));
  await page.keyboard.press('Enter');
  await page.click('#place_order');
  const del = await waitFor(async () => (await call(page, 'pos:running')).find((r) => r.customer_name === 'Peter Okello'));
  check('delivery order placed for the customer', !!del && Number(del.order_type) === 3, del);
  if (del) await call(page, 'pos:cancel', del.id);
  await page.click('.dine_in_button');

  console.log('automatic updates from GitHub');
  check('no update while GitHub has no newer version', ['idle', 'uptodate', 'checking'].includes((await call(page, 'update:state')).status), await call(page, 'update:state'));
  GH.release = { tag_name: 'v9.9.9', body: 'test release', assets: [{ name: 'RojeyPOS-Setup-9.9.9.exe', size: GH.bytes.length, digest: 'sha256:' + crypto.createHash('sha256').update(GH.bytes).digest('hex'), browser_download_url: `http://127.0.0.1:${ghPort}/dl/RojeyPOS-Setup-9.9.9.exe` }] };
  check('new version found and downloaded by itself', await waitFor(async () => (await call(page, 'update:state')).status === 'ready', 15000), await call(page, 'update:state'));
  check('downloaded file checked', fs.existsSync(path.join(USER_DATA, 'updates', 'RojeyPOS-Setup-9.9.9.exe')) && fs.readFileSync(path.join(USER_DATA, 'updates', 'RojeyPOS-Setup-9.9.9.exe')).equals(GH.bytes));
  check('admin sees the update button with a green dot', await page.isVisible('#rj_update') && await waitFor(async () => page.isVisible('#rj_update_dot')));
  check('admin can install it with the button', (await call(page, 'update:install')).ok === true);

  console.log('changes on the website arrive by themselves');
  A.S.items[1].price = '210.00';
  check('new price shows without doing anything', await waitFor(async () => /210\.00/.test(await page.textContent('#item_11')), 20000), await page.textContent('#item_11'));
  A.S.addRemoteRunning('CJ261122W1-08', 1);
  check('running order from another till shows within seconds', await waitFor(async () => (await page.textContent('#order_details_holder')).includes('CJ261122W1-08'), 10000));
  A.S.kitchen.delete('CJ261122W1-08');
  await waitFor(async () => !(await page.textContent('#order_details_holder')).includes('CJ261122W1-08'), 20000);
  for (const r of await call(page, 'pos:running')) await call(page, 'pos:cancel', r.id);

  console.log('offline for a while');
  A.S.down = true;
  check('goes offline', await waitFor(async () => !(await call(page, 'status')).online));
  const off1 = await call(page, 'pos:save', { action: 'pay', orderType: 2, lines: [{ food_menu_id: 30, qty: 3 }] });
  const off2 = await call(page, 'pos:save', { action: 'kot', orderType: 1, waiterId: 8, tableId: 101, tableName: 'T1', lines: [{ food_menu_id: 11, qty: 1 }] });
  check('sales saved offline', off1.ok && off2.ok, [off1, off2]);
  check('take-away price used', off1.sale.total_payable === 750, off1.sale.total_payable);
  check('waiting to upload', (await call(page, 'status')).pending === 1);
  A.S.down = false;
  check('uploads by itself when back online', await waitFor(() => A.S.sales.has(off1.saleNo), 20000));
  check('offline running order shared when back', await waitFor(() => A.S.kitchen.has(off2.saleNo), 10000));
  await sleep(1500);
  check('no order uploaded twice', [...A.S.sales.values()].every((v) => v.times === 1), [...A.S.sales.values()].map((v) => v.times));

  console.log('cashier with PIN, register closed on the website');
  await page.click('#rj_logout');
  check('logout goes to sign in', await onPage(page, 'login.html'));
  await page.click('#tab_pin');
  for (const d of '2222') await page.click(`#pinpad [data-k="${d}"]`);
  check('PIN sign in works', await onPage(page, 'pos.html'));
  const cj = await call(page, 'pos:save', { action: 'pay', orderType: 1, lines: [{ food_menu_id: 10, qty: 1 }] });
  check('cashier sale uploaded', await waitFor(() => A.S.sales.has(cj.saleNo)));
  check('register opened by itself', A.S.registerOpens >= 1, A.S.registerOpens);
  check('uploaded as the cashier (id 5)', A.S.sales.get(cj.saleNo).user_id === 5);
  check('cashier cannot open Settings', (await call(page, 'nav', 'setup')).ok === false);
  check('cashier cannot open the sales list', (await call(page, 'nav', 'sales')).ok === false && (await call(page, 'sales:list', {})).ok === false);
  console.log('permissions from the website role');
  const cjUser = await waitFor(async () => { const st = await call(page, 'pos:catalog'); return st.user && st.user.perms && st.user.perms.cancelOrder === false && st.user; });
  check('cashier role permissions downloaded', !!cjUser && cjUser.perms.discount === false && cjUser.perms.invoice === true);
  const disc = await call(page, 'pos:save', { action: 'kot', orderType: 1, discount: '10%', lines: [{ food_menu_id: 11, qty: 1 }] });
  check('discount refused without permission', disc.ok === false && /discount/i.test(disc.error), disc);
  const noWaiter = await call(page, 'pos:save', { action: 'kot', orderType: 2, lines: [{ food_menu_id: 11, qty: 1 }] });
  check('order without a waiter refused', noWaiter.ok === false && /waiter/i.test(noWaiter.error), noWaiter);
  const noTable = await call(page, 'pos:save', { action: 'kot', orderType: 1, waiterId: 7, lines: [{ food_menu_id: 11, qty: 1 }] });
  check('Dine In order without a table refused', noTable.ok === false && /table/i.test(noTable.error), noTable);
  const cjRun = await call(page, 'pos:save', { action: 'kot', orderType: 1, waiterId: 8, tableId: 102, tableName: 'T2', lines: [{ food_menu_id: 11, qty: 1 }] });
  check('cashier can print the last invoice', (await call(page, 'pos:lastInvoice')).ok === true);
  A.S.users.find((u) => u.id === 5).deny.push('pos_13');
  check('permission removed on the website reaches the till by itself', !!(await waitFor(async () => { const c = await call(page, 'pos:catalog'); return c.user.perms.lastInvoice === false; }, 15000)));
  const lastNo = await call(page, 'pos:lastInvoice');
  check('last invoice refused once the permission is removed', lastNo.ok === false && /not allowed/i.test(lastNo.error), lastNo);
  const cxl = await call(page, 'pos:cancel', cjRun.saleId);
  check('cancel refused without permission', cxl.ok === false, cxl);
  await page.reload(); await page.waitForSelector('#rj_items .single_item');
  await page.click('#item_11');
  check('no discount box in the cart', !(await page.$('#rj_cart .discount_cart_input')));
  await page.click(`#order_details_holder .single_order[data-id="${cjRun.saleId}"]`);
  await page.click('#cancel_order_button');
  check('cancel button shows a permission message', await waitFor(async () => /not allowed/i.test(await page.textContent('body'))));
  await page.click('#cancel_button');
  if (await page.$('.rj-modal .rj-primary')) await page.click('.rj-modal .rj-primary');

  console.log('waiter account');
  await page.click('#rj_logout'); await onPage(page, 'login.html');
  await page.click('#tab_pin');
  for (const d of '3333') await page.click(`#pinpad [data-k="${d}"]`);
  check('waiter signs in', await onPage(page, 'pos.html'));
  await page.waitForSelector('#rj_items .single_item');
  check('waiter cannot take payment or print', await waitFor(async () => !(await page.isVisible('#direct_invoice')) && !(await page.isVisible('#cancel_order_button')) && !(await page.isVisible('#rj_kot'))));
  check('waiter is locked as the waiter', await page.isDisabled('#select_waiter'));
  check('waiter sees every running order on this till', (await call(page, 'pos:running')).some((r) => r.sale_no === cjRun.saleNo), (await call(page, 'pos:running')).map((r) => r.sale_no));
  A.S.addRemoteRunning('CJ261122W1-09', 5);
  check('another person\'s order from the website shows for the waiter too', await waitFor(async () => (await call(page, 'pos:running')).some((r) => r.sale_no === 'CJ261122W1-09'), 15000));
  const card9 = '#order_details_holder .single_order:has-text("CJ261122W1-09")';
  check('running card shows the table and waiter name', await waitFor(async () => { const t = await page.textContent(card9).catch(() => ''); return /T2/.test(t) && /Waiter Ann/.test(t); }, 10000));
  await page.dblclick(card9);
  check('double-click opens the order details', await waitFor(async () => /Order CJ261122W1-09/.test(await page.textContent('.rj-modal h3').catch(() => ''))));
  await page.keyboard.press('Escape');
  check('another waiter\'s order cannot be changed by this waiter', (await call(page, 'pos:save', { saleId: (await call(page, 'pos:running')).find((r) => r.sale_no === 'CJ261122W1-09').id, action: 'kot', lines: [{ food_menu_id: 30, qty: 3 }] })).ok === false);
  await page.click('#item_30'); await page.click('#place_order');
  check('waiter is asked for a table', await waitFor(async () => !!(await page.$('#show_tables_modal2 .all-dineIn-table'))));
  await page.click('#show_tables_modal2 [data-name="T1"]');
  check('a busy table can take a new order too', await waitFor(async () => !!(await page.$('#show_tables_modal2 [data-act="use"]'))));
  await page.click('#show_tables_modal2 [data-act="use"]');
  await waitFor(async () => !(await page.$('#show_tables_modal2')));
  await page.click('#place_order');
  const wr = await waitFor(async () => (await call(page, 'pos:running'))[0]);
  check('waiter order saved with the waiter', wr && Number(wr.waiter_id) === 7, wr);
  const wpay = await call(page, 'pos:save', { action: 'pay', orderType: 1, lines: [{ food_menu_id: 11, qty: 1 }] });
  check('waiter cannot invoice', wpay.ok === false, wpay);
  check('waiter order shared with the website', await waitFor(() => A.S.kitchen.has(wr.sale_no)));
  await page.click('#rj_logout'); await onPage(page, 'login.html');
  await page.click('#tab_pin');
  for (const d of '2222') await page.click(`#pinpad [data-k="${d}"]`);
  await onPage(page, 'pos.html');

  console.log('offline sign in');
  A.S.down = true;
  check('goes offline', await waitFor(async () => !(await call(page, 'status')).online));
  await page.click('#rj_logout'); await onPage(page, 'login.html');
  await page.click('#tab_pin');
  for (const d of '1111') await page.click(`#pinpad [data-k="${d}"]`);
  check('PIN never used on this till is refused offline', await waitFor(async () => /No internet/.test(await page.textContent('#err'))));
  for (const d of '2222') await page.click(`#pinpad [data-k="${d}"]`);
  check('cashier PIN works offline', await onPage(page, 'pos.html'));
  await page.click('#rj_logout'); await onPage(page, 'login.html');
  await page.click('#tab_pass');
  await page.fill('#email', 'admin@x.com'); await page.fill('#password', 'secret'); await page.click('#go_pass');
  check('admin email works offline', await onPage(page, 'pos.html'));

  console.log('website address changes');
  const moved = await call(page, 'pos:save', { action: 'pay', orderType: 1, lines: [{ food_menu_id: 11, qty: 2 }] });
  check('sale kept while the old site is down', (await call(page, 'status')).pending === 1);
  const sv = await call(page, 'setup:save', { baseUrl: urlB });
  check('admin can change the address', sv.ok, sv);
  check('waiting order uploads to the new address', await waitFor(() => B.S.sales.has(moved.saleNo), 20000));
  check('nothing lost', (await call(page, 'status')).pending === 0);

  console.log('taxes switched on the website');
  A.S.collectTax = 'No'; B.S.collectTax = 'No';
  check('taxes turned off on the website reach the till', await waitFor(async () => (await call(page, 'pos:catalog')).settings.collectTax === 'No', 20000));
  A.S.collectTax = 'Yes'; B.S.collectTax = 'Yes';
  check('taxes turned on on the website reach the till', await waitFor(async () => (await call(page, 'pos:catalog')).settings.collectTax === 'Yes', 20000));

  console.log('sales screen and clean up');
  await call(page, 'nav', 'sales');
  await onPage(page, 'sales.html');
  check('sales list shows rows', await waitFor(async () => (await page.$$('#tbl tr')).length > 3));
  await page.screenshot({ path: path.join(SHOTS, 'sales.png') });
  await page.fill('#fd', '2000-01-01'); await page.fill('#ft', '00:00'); await page.fill('#td', '2000-01-02'); await page.fill('#tt', '23:59');
  await page.click('#go');
  check('date filter works', await waitFor(async () => (await page.$$('#tbl tr')).length === 1));
  list = await call(page, 'sales:list', {});
  const syncedBefore = list.filter((x) => x.sync_status === 'synced').length;
  await call(page, 'setup:save', { keepSyncedDays: 0 });
  await call(page, 'sync:now');
  list = await call(page, 'sales:list', {});
  check('uploaded orders removed from this computer', syncedBefore > 0 && list.filter((x) => x.sync_status === 'synced').length === 0, list.map((x) => x.sync_status));
  check('running order kept', list.some((x) => x.sync_status === 'running'));

  console.log('quick close and reopen, with orders waiting and an order left by version 1');
  await call(page, 'nav', 'pos'); await onPage(page, 'pos.html');
  await page.screenshot({ path: path.join(SHOTS, 'pos-running.png') });
  B.S.down = true;
  check('offline before closing', await waitFor(async () => !(await call(page, 'status')).online));
  const kept = await call(page, 'pos:save', { action: 'pay', orderType: 1, lines: [{ food_menu_id: 30, qty: 1 }] });
  const t0 = Date.now();
  await app.close();
  check('closes quickly', Date.now() - t0 < 5000, Date.now() - t0);
  {
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(path.join(USER_DATA, 'rojey-pos.db'));
    d.exec(`CREATE TABLE IF NOT EXISTS orders (site TEXT NOT NULL, sale_no TEXT NOT NULL, local_id TEXT, kind TEXT NOT NULL, order_json TEXT NOT NULL, sale_date TEXT, date_time TEXT, total REAL,
      order_type TEXT, customer TEXT, cashier TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, synced_at INTEGER, PRIMARY KEY (site, sale_no))`);
    const v1 = { sale_no: 'AD261120W1-09', user_id: '1', total_payable: '200.00', items: [{ food_menu_id: '11', qty: '1' }], payment_object: JSON.stringify(JSON.stringify([{ payment_id: '1', amount: '200' }])) };
    d.prepare("INSERT INTO orders (site, sale_no, local_id, kind, order_json, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(urlA, v1.sale_no, '77', 'paid', JSON.stringify(v1), 'pending', Date.now(), Date.now());
    d.close();
  }
  ({ app, page } = await launch());
  check('reopens at sign in', await onPage(page, 'login.html'));
  check('waiting orders still there after reopen', await waitFor(async () => { const st = await call(page, 'status'); return st.pending === 1 && st.legacyPending === 1; }, 5000), await call(page, 'status'));
  await page.click('#tab_pin');
  for (const d of '2222') await page.click(`#pinpad [data-k="${d}"]`);
  check('signs in offline after reopen', await onPage(page, 'pos.html'));
  B.S.down = false;
  check('order made before closing uploads after reopen', await waitFor(() => B.S.sales.has(kept.saleNo), 20000));
  check('version 1 order uploads too', await waitFor(() => B.S.sales.has('AD261120W1-09'), 20000));
  check('version 1 order uploaded once', B.S.sales.get('AD261120W1-09') && B.S.sales.get('AD261120W1-09').times === 1);
  await app.close();

  A.server.close(); B.server.close();
  console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
