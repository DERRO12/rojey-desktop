// Talking to the website (iRestora PLUS): sign in, read the POS page for menus and settings,
// open the register when the website asks for it, and upload orders through Sale/push_online.
// Each staff account gets its own cookie jar, so every order uploads under the person who took it.
const { net, session } = require('electron');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) RojeyPOS/2 Safari/537.36';

function jar(key) { return session.fromPartition('persist:rojey-web-' + String(key).replace(/[^a-z0-9_-]/gi, '_')); }

function request(ses, url, { method = 'GET', form = null, timeout = 20000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const req = net.request({ url, method, redirect: 'manual', useSessionCookies: true, session: ses });
    req.setHeader('User-Agent', UA);
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    let body = null;
    if (form) {
      body = Buffer.from(encodeForm(form), 'utf8');
      req.setHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
    }
    const timer = setTimeout(() => {
      if (done) return; done = true;
      try { req.abort(); } catch { /* */ }
      const e = new Error('timeout'); e.code = 'TIMEOUT'; reject(e);
    }, timeout);
    req.on('redirect', (status, _m, location) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ status, location, body: '' });
      try { req.abort(); } catch { /* */ }
    });
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (done) return; done = true; clearTimeout(timer);
        resolve({ status: res.statusCode, location: null, body: Buffer.concat(chunks).toString('utf8'), type: String(res.headers['content-type'] || '') });
      });
      res.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    });
    req.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    if (body) req.write(body);
    req.end();
  });
}

function encodeForm(form) {
  const parts = [];
  for (const [k, v] of Object.entries(form)) {
    if (Array.isArray(v)) for (const x of v) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(x == null ? '' : x));
    else parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v == null ? '' : v));
  }
  return parts.join('&');
}

// GET/POST and follow redirects ourselves (so cookies from every hop are kept).
async function go(ses, url, opts = {}, maxHops = 8) {
  let r = await request(ses, url, opts);
  let finalUrl = url;
  let hops = 0;
  while (r.location && hops++ < maxHops) {
    finalUrl = new URL(r.location, finalUrl).toString();
    r = await request(ses, finalUrl, { timeout: opts.timeout });
  }
  return { ...r, url: finalUrl };
}

function isLoginPage(r) {
  return /Authentication\/index\/?$|Authentication\/?$/i.test(r.url || '') || /name=["']email_address["']/i.test(r.body || '') && /name=["']password["']/i.test(r.body || '');
}

class Server {
  constructor(getBase, log) {
    this.getBase = getBase; // () => 'https://pos.example.com/'
    this.log = log || (() => {});
    this.loggedIn = new Map(); // jarKey -> time of last good sign-in
  }

  url(p) { return this.getBase() + String(p).replace(/^\//, ''); }

  async ping(timeout = 6000) {
    const r = await request(jar('probe'), this.url('Authentication/index'), { timeout });
    return r.status > 0 && r.status < 500;
  }

  // creds: { email, password } or { pin }
  // one sign-in at a time per cookie jar: two at once cleared each other's cookies
  async login(key, creds) {
    this.logins = this.logins || new Map();
    const prev = this.logins.get(key) || Promise.resolve();
    const run = prev.catch(() => {}).then(() => this.loginNow(key, creds));
    this.logins.set(key, run);
    try { return await run; } finally { if (this.logins.get(key) === run) this.logins.delete(key); }
  }

  async loginNow(key, creds) {
    const ses = jar(key);
    await ses.clearStorageData({ storages: ['cookies'] }).catch(() => {});
    const first = await go(ses, this.url('Authentication/index'), { timeout: 15000 });
    if (!first.status || first.status >= 500) { const e = new Error('website error ' + first.status); e.code = 'SERVER'; throw e; }
    const form = creds.pin
      ? { email_address: '', password: '', login_pin: creds.pin, active_login_button_hidden: '2', submit: 'submit' }
      : { email_address: creds.email, password: creds.password, login_pin: '', active_login_button_hidden: '1', submit: 'submit' };
    const r = await go(ses, this.url('Authentication/loginCheck'), { method: 'POST', form, timeout: 20000 });
    if (!r.status || r.status >= 500) { const e = new Error('website error ' + r.status); e.code = 'SERVER'; throw e; }
    const ok = !isLoginPage(r) && r.status < 400;
    if (ok) this.loggedIn.set(key, Date.now()); else this.loggedIn.delete(key);
    return { ok, url: r.url, body: r.body, status: r.status };
  }

  // Opens the POS page. Handles "open register" and "choose outlet" the same way a person would.
  async posPage(key, { outletId, counterId, autoRegister = true } = {}) {
    const ses = jar(key);
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await go(ses, this.url('POSChecker/posAndWaiterMiddleman'), { timeout: 30000 });
      if (isLoginPage(r)) return { ok: false, reason: 'login' };
      if (/Register\/openRegister/i.test(r.url)) {
        if (!autoRegister) return { ok: false, reason: 'register' };
        await this.openRegister(key, r.body, counterId);
        continue;
      }
      if (/Outlet\/outlets/i.test(r.url)) {
        const ok = await this.enterOutlet(key, r.body, outletId);
        if (!ok) return { ok: false, reason: 'outlet' };
        continue;
      }
      if (/Sale\/POS/i.test(r.url) && /window\.items\s*=/.test(r.body)) return { ok: true, html: r.body, url: r.url };
      return { ok: false, reason: 'unexpected page ' + r.url };
    }
    return { ok: false, reason: 'could not open the POS page' };
  }

  async enterOutlet(key, html, outletId) {
    const links = [...String(html).matchAll(/href=["']([^"']*Outlet\/setOutletSession\/[^"']+)["']/gi)].map((m) => m[1]);
    if (!links.length) return false;
    await go(jar(key), new URL(links[0], this.getBase()).toString(), { timeout: 20000 });
    return true;
  }

  async openRegister(key, html, counterId) {
    if (!html || !/Register\/addBalance/.test(html)) {
      html = (await go(jar(key), this.url('Register/openRegister'), { timeout: 20000 })).body;
    }
    const form1 = String(html).split(/Register\/addExistingBalance/)[0];
    const counters = [...form1.matchAll(/<option value="(\d+)"/g)].map((m) => m[1]);
    const names = [...form1.matchAll(/value="([^"]*)" name="payment_names\[\]"/g)].map((m) => decodeEntities(m[1]));
    const ids = [...form1.matchAll(/value="([^"]*)" name="payment_ids\[\]"/g)].map((m) => m[1]);
    const counter = counterId && counters.includes(String(counterId)) ? String(counterId) : counters[0];
    if (!counter) throw new Error('The website has no counter to open the register with');
    const form = { opening_balance: '0', counter_id: counter, 'payment_names[]': names, 'payment_ids[]': ids, 'payments[]': ids.map(() => '0'), submit: 'submit' };
    await go(jar(key), this.url('Register/addBalance'), { method: 'POST', form, timeout: 20000 });
    this.log('register opened on the website for ' + key + ' (counter ' + counter + ')');
  }

  async bootstrap(key, outletId) {
    try {
      const r = await go(jar(key), this.url('IR_api/desktop_bootstrap'), {
        method: 'POST', form: outletId ? { outlet_id: String(outletId) } : {}, timeout: 30000,
      });
      if (r.status !== 200 || !/^\s*\{/.test(r.body)) return null;
      const j = JSON.parse(r.body);
      return j && j.status ? j : null;
    } catch { return null; }
  }

  // Upload one order. Returns 'ok' | 'login' | 'register' | 'error:<text>'
  async push(key, orderJson, localId) {
    const ses = jar(key);
    const r = await request(ses, this.url('Sale/push_online'), { method: 'POST', form: { orders: orderJson, sales_id: String(localId) }, timeout: 30000 });
    if (r.location) {
      if (/Register\/openRegister/i.test(r.location)) return 'register';
      if (/Authentication|Outlet\/outlets/i.test(r.location)) return 'login';
      return 'error:redirect ' + r.location;
    }
    const body = String(r.body || '').trim();
    if (r.status === 200 && body.replace(/^"|"$/g, '') === String(localId)) return 'ok';
    if (isLoginPage({ body })) return 'login';
    return 'error:HTTP ' + r.status + ' ' + body.slice(0, 120).replace(/\s+/g, ' ');
  }

  // POST to a Sale/* endpoint that answers JSON. Returns { state: 'ok'|'login'|'register'|'error', json, text }
  async postJson(key, path, form, timeout = 30000) {
    const r = await request(jar(key), this.url(path), { method: 'POST', form, timeout, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (r.location) {
      if (/Register\/openRegister/i.test(r.location)) return { state: 'register' };
      if (/Authentication|Outlet\/outlets/i.test(r.location)) return { state: 'login' };
      return { state: 'error', text: 'redirect ' + r.location };
    }
    if (isLoginPage({ body: r.body })) return { state: 'login' };
    if (r.status !== 200) return { state: 'error', text: 'HTTP ' + r.status };
    try { return { state: 'ok', json: JSON.parse(String(r.body).trim() || 'null') }; } catch { return { state: 'error', text: 'not JSON: ' + String(r.body).slice(0, 100) }; }
  }

  // Share a running order with the website (kitchen screen, other tills). Same call the web POS makes.
  async kitchenPush(key, orderJson) {
    const r = await this.postJson(key, 'Sale/add_kitchen_sale_by_ajax', { order: orderJson, is_self_order: '', close_order: '0' });
    if (r.state === 'ok' && r.json && r.json.invoice_status) return { state: 'error', text: r.json.invoice_msg || 'not allowed' };
    return r;
  }

  async kitchenCancel(key, orderJson) {
    const r = await request(jar(key), this.url('Sale/add_cancel_audit_report'), { method: 'POST', form: { order: orderJson, reason: 'Cancelled on Rojey POS desktop' }, timeout: 30000 });
    if (r.location) return { state: /Register/i.test(r.location) ? 'register' : 'login' };
    return { state: r.status === 200 ? 'ok' : 'error', text: 'HTTP ' + r.status };
  }

  // Running orders other tills placed (and which of ours were already paid elsewhere).
  // Same call the web POS makes from its "Add customer" box. Returns { customer_id }.
  async saveCustomer(key, c) {
    return this.postJson(key, 'Sale/add_customer_by_ajax', {
      customer_id: Number(c.id) > 0 ? String(c.id) : '', customer_name: c.name || '', customer_phone: c.phone || '', customer_email: c.email || '',
      customer_dob: '', customer_doa: '', customer_password: '', customer_delivery_address: c.address || '', customer_default_discount: '',
      customer_gst_number: '', same_or_diff_state: '', is_new_address: Number(c.id) > 0 ? '' : 'Yes', customer_delivery_address_modal_id: '',
    });
  }

  // a running order that was fully paid as split bills: the website removes it (same call as its own POS)
  async mergeDelete(key, saleNo) {
    const r = await request(jar(key), this.url('Sale/setMergeDelete'), { method: 'POST', form: { sale_no: saleNo }, timeout: 20000, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (r.location) return { state: /Register/i.test(r.location) ? 'register' : 'login' };
    if (isLoginPage({ body: r.body })) return { state: 'login' };
    return { state: r.status === 200 ? 'ok' : 'error', text: 'HTTP ' + r.status };
  }

  // the website's sales list (every till), with its own filters: user_id, from_datetime, to_datetime
  async salesList(key, f) {
    return this.postJson(key, 'Sale/getAjaxData', { draw: '1', start: '0', length: String(f.length || 1000), user_id: String(f.user_id || ''), from_datetime: f.from_datetime || '', to_datetime: f.to_datetime || '', 'search[value]': '' }, 30000);
  }

  async pullRunning(key, ownNos, allNos) {
    return this.postJson(key, 'Sale/get_all_running_order_for_new_pc', { sale_no_all: ownNos.join(','), sale_no_all_for_invoice: allNos.join(',') }, 20000);
  }

  async logout(key) {
    try { await jar(key).clearStorageData({ storages: ['cookies'] }); } catch { /* */ }
    this.loggedIn.delete(key);
  }
}

function decodeEntities(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/g, "'");
}

module.exports = { Server, isLoginPage, decodeEntities, encodeForm };
