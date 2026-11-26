// The app's own database: a SQLite file (rojey-pos.db) in the app's data folder.
// Tables use the same names and columns as the website's MySQL database (tbl_*), plus a few
// local columns for syncing. Orders are not tied to a website address: whatever address is set
// in Settings is where waiting orders upload, so changing the address never loses an order.
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS tbl_outlets (id INTEGER PRIMARY KEY, outlet_name TEXT, outlet_code TEXT, address TEXT,
  phone TEXT, email TEXT, default_waiter INTEGER, company_id INTEGER, del_status TEXT DEFAULT 'Live');
CREATE TABLE IF NOT EXISTS tbl_food_menu_categories (id INTEGER PRIMARY KEY, category_name TEXT, description TEXT,
  company_id INTEGER, order_by INTEGER DEFAULT 0, del_status TEXT DEFAULT 'Live');
CREATE TABLE IF NOT EXISTS tbl_food_menus (id INTEGER PRIMARY KEY, code TEXT, name TEXT, alternative_name TEXT,
  category_id INTEGER, description TEXT, sale_price REAL, sale_price_take_away REAL, sale_price_delivery REAL,
  tax_information TEXT, veg_item TEXT, beverage_item TEXT, bar_item TEXT, parent_id INTEGER DEFAULT 0,
  product_type INTEGER DEFAULT 1, photo TEXT, is_variation TEXT, company_id INTEGER, del_status TEXT DEFAULT 'Live',
  kitchen_id INTEGER, kitchen_name TEXT, local_image TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tbl_modifiers (id INTEGER PRIMARY KEY, name TEXT, price REAL, description TEXT,
  tax_information TEXT, company_id INTEGER, del_status TEXT DEFAULT 'Live');
CREATE TABLE IF NOT EXISTS tbl_food_menus_modifiers (id INTEGER PRIMARY KEY, modifier_id INTEGER, food_menu_id INTEGER,
  outlet_id INTEGER, company_id INTEGER, del_status TEXT DEFAULT 'Live');
CREATE TABLE IF NOT EXISTS tbl_kitchens (id INTEGER PRIMARY KEY, name TEXT, printer_id INTEGER, print_server_url TEXT,
  company_id INTEGER, outlet_id INTEGER, del_status TEXT DEFAULT 'Live');
CREATE TABLE IF NOT EXISTS tbl_kitchen_categories (id INTEGER PRIMARY KEY, kitchen_id INTEGER, cat_id INTEGER,
  via_printer INTEGER, outlet_id INTEGER, del_status TEXT DEFAULT 'Live');
CREATE TABLE IF NOT EXISTS tbl_printers (id INTEGER PRIMARY KEY, path TEXT, title TEXT, type TEXT, characters_per_line INTEGER,
  printer_ip_address TEXT, printer_port TEXT, company_id INTEGER, outlet_id INTEGER, printing_choice TEXT,
  ipvfour_address TEXT, print_format TEXT, del_status TEXT DEFAULT 'Live');
CREATE TABLE IF NOT EXISTS tbl_users (id INTEGER PRIMARY KEY, full_name TEXT, phone TEXT, email_address TEXT, password TEXT,
  designation TEXT, will_login TEXT, role TEXT, outlet_id INTEGER, outlets TEXT, kitchens TEXT, company_id INTEGER,
  active_status TEXT DEFAULT 'Active', del_status TEXT DEFAULT 'Live', login_pin TEXT, role_id INTEGER,
  short_name TEXT, is_waiter INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tbl_customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, email TEXT, address TEXT,
  gst_number TEXT, default_discount TEXT DEFAULT '0', same_or_diff_state INTEGER DEFAULT 0, company_id INTEGER,
  del_status TEXT DEFAULT 'Live');
CREATE TABLE IF NOT EXISTS tbl_areas (id INTEGER PRIMARY KEY, outlet_id INTEGER, area_name TEXT, del_status TEXT DEFAULT 'Live');
CREATE TABLE IF NOT EXISTS tbl_tables (id INTEGER PRIMARY KEY, area INTEGER, table_type INTEGER DEFAULT 1, name TEXT,
  sit_capacity TEXT, outlet_id INTEGER, company_id INTEGER, del_status TEXT DEFAULT 'Live');
CREATE TABLE IF NOT EXISTS tbl_payment_methods (id INTEGER PRIMARY KEY, name TEXT, description TEXT, company_id INTEGER,
  order_by INTEGER, del_status TEXT DEFAULT 'Live');

CREATE TABLE IF NOT EXISTS tbl_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT, customer_name TEXT, sale_no TEXT UNIQUE NOT NULL,
  total_items INTEGER, sub_total REAL, paid_amount REAL, due_amount REAL, vat REAL, total_payable REAL,
  payment_method_id INTEGER, table_id INTEGER, total_item_discount_amount REAL, sub_total_with_discount REAL,
  sub_total_discount_amount REAL, total_discount_amount REAL, charge_type TEXT, delivery_charge TEXT, tips_amount TEXT,
  sub_total_discount_value TEXT, sub_total_discount_type TEXT, sale_date TEXT, date_time TEXT, order_time TEXT,
  user_id INTEGER, user_name TEXT, waiter_id INTEGER, waiter_name TEXT, outlet_id INTEGER, company_id INTEGER,
  order_status INTEGER, order_type INTEGER, del_status TEXT DEFAULT 'Live', counter_id INTEGER DEFAULT 0,
  given_amount REAL, change_amount REAL, sale_vat_objects TEXT, random_code TEXT, rounding_amount_hidden REAL DEFAULT 0,
  orders_table_text TEXT, token_number TEXT, paid_date_time TEXT,
  sync_status TEXT NOT NULL DEFAULT 'running',   -- running | pending | synced | cancelled
  sync_attempts INTEGER NOT NULL DEFAULT 0, sync_error TEXT, synced_at INTEGER, synced_to TEXT, order_json TEXT,
  kot_count INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  origin TEXT DEFAULT 'local',          -- local | server (pulled from another till / the website)
  kitchen_sync TEXT,                    -- running orders shared with the website: pending | done | cancel | NULL
  kitchen_synced_at INTEGER, server_hash TEXT);
CREATE INDEX IF NOT EXISTS sales_sync ON tbl_sales(sync_status, created_at);
CREATE INDEX IF NOT EXISTS sales_time ON tbl_sales(date_time);
CREATE TABLE IF NOT EXISTS tbl_sales_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sales_id INTEGER NOT NULL, food_menu_id INTEGER, menu_name TEXT, qty REAL,
  tmp_qty REAL, menu_price_without_discount REAL, menu_price_with_discount REAL, menu_unit_price REAL, menu_taxes TEXT,
  menu_discount_value TEXT, discount_type TEXT, menu_note TEXT, discount_amount REAL, item_type TEXT, cooking_status TEXT,
  previous_id INTEGER, user_id INTEGER, outlet_id INTEGER, is_free_item INTEGER DEFAULT 0, del_status TEXT DEFAULT 'Live',
  kitchen_id INTEGER, kitchen_name TEXT, kot_qty REAL DEFAULT 0, line_no INTEGER);
CREATE INDEX IF NOT EXISTS details_sale ON tbl_sales_details(sales_id);
CREATE TABLE IF NOT EXISTS tbl_sales_details_modifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, modifier_id INTEGER, modifier_name TEXT, modifier_price REAL, food_menu_id INTEGER,
  sales_id INTEGER, sales_details_id INTEGER, menu_taxes TEXT, user_id INTEGER, outlet_id INTEGER, customer_id INTEGER);
CREATE INDEX IF NOT EXISTS mods_sale ON tbl_sales_details_modifiers(sales_id);
CREATE TABLE IF NOT EXISTS tbl_sale_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER, payment_name TEXT, amount REAL, sale_id INTEGER,
  date_time TEXT, counter_id INTEGER DEFAULT 0, user_id INTEGER, outlet_id INTEGER, del_status TEXT DEFAULT 'Live');
CREATE INDEX IF NOT EXISTS pay_sale ON tbl_sale_payments(sale_id);
CREATE TABLE IF NOT EXISTS tbl_orders_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT, persons INTEGER, booking_time TEXT, sale_id INTEGER, sale_no TEXT,
  outlet_id INTEGER, table_id INTEGER, del_status TEXT DEFAULT 'Live');
CREATE INDEX IF NOT EXISTS ot_sale ON tbl_orders_table(sale_id);
CREATE TABLE IF NOT EXISTS rj_kot_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, sale_id INTEGER, sale_no TEXT,
  kitchen TEXT, printers TEXT, lines_json TEXT, html TEXT, reprint INTEGER DEFAULT 0, user_name TEXT);
CREATE INDEX IF NOT EXISTS rj_kot_log_sale ON rj_kot_log(sale_no);
CREATE TABLE IF NOT EXISTS rj_sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, sale_no TEXT, result TEXT, message TEXT);
`;

const MASTER_TABLES = ['tbl_outlets', 'tbl_food_menu_categories', 'tbl_food_menus', 'tbl_modifiers',
  'tbl_food_menus_modifiers', 'tbl_kitchens', 'tbl_kitchen_categories', 'tbl_printers', 'tbl_users',
  'tbl_customers', 'tbl_areas', 'tbl_tables', 'tbl_payment_methods'];

const pad = (n) => String(n).padStart(2, '0');
function nowDateTime(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

class Db {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=3000;');
    this.db.exec(SCHEMA);
    // columns added after 2.0.0 (older databases get them here)
    const add = (t, c, type) => { const have = this.db.prepare(`PRAGMA table_info(${t})`).all().map((x) => x.name); if (!have.includes(c)) this.db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`); };
    for (const c of ['table_design_content', 'floor_bg_color', 'ordered_bg_color', 'ordered_border_color', 'ordered_text_color']) add('tbl_areas', c, 'TEXT');
    add('tbl_users', 'pos_access', 'TEXT');
    add('tbl_customers', 'rj_pending', 'INTEGER DEFAULT 0');
    add('tbl_sales', 'uploaded_by', 'INTEGER');     // whose website sign-in uploaded the sale (the website records that person)
    add('tbl_customers', 'phone', 'TEXT');
    this.cols = {};
    for (const t of [...MASTER_TABLES, 'tbl_sales', 'tbl_sales_details', 'tbl_sales_details_modifiers', 'tbl_sale_payments', 'tbl_orders_table']) {
      this.cols[t] = this.db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    }
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* */ } throw e; }
  }

  // ---- settings ---------------------------------------------------------------------------
  get(key, dflt = null) {
    const r = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    if (!r) return dflt;
    try { return JSON.parse(r.value); } catch { return dflt; }
  }
  set(key, value) {
    this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }

  // ---- master data ------------------------------------------------------------------------
  _clean(table, row) {
    const out = {};
    for (const c of this.cols[table]) {
      if (row[c] === undefined) continue;
      let v = row[c];
      if (v !== null && typeof v === 'object') v = JSON.stringify(v);
      if (typeof v === 'boolean') v = v ? 1 : 0;
      out[c] = v;
    }
    return out;
  }

  // Replace a whole master table with fresh rows from the website (in one transaction, so a
  // failed pull never leaves half a menu). Rows missing an id are skipped.
  replaceTable(table, rows) {
    if (!MASTER_TABLES.includes(table)) throw new Error('not a master table: ' + table);
    // customers added or changed here and not yet on the website are kept
    const keep = table === 'tbl_customers' ? this.db.prepare('SELECT * FROM tbl_customers WHERE rj_pending=1').all() : [];
    this.db.exec(`DELETE FROM ${table}`);
    for (const r of rows) this.upsert(table, r);
    for (const r of keep) this.upsert(table, r);
  }

  // ---- customers ------------------------------------------------------------------------------
  customer(id) { return this.db.prepare('SELECT * FROM tbl_customers WHERE id=?').get(id) || null; }
  saveCustomer(c) {
    const id = Number(c.id) > 0 ? Number(c.id) : -Date.now();
    const row = { id, name: String(c.name || '').trim(), phone: String(c.phone || '').trim(), email: String(c.email || '').trim(), address: String(c.address || '').trim(), rj_pending: 1, del_status: 'Live' };
    const ex = this.customer(id);
    if (ex) this.db.prepare('UPDATE tbl_customers SET name=?, phone=?, email=?, address=?, rj_pending=1 WHERE id=?').run(row.name, row.phone, row.email, row.address, id);
    else this.upsert('tbl_customers', row);
    return this.customer(id);
  }
  pendingCustomers() { return this.db.prepare('SELECT * FROM tbl_customers WHERE rj_pending=1 ORDER BY id').all(); }
  // the website gave the new customer its number: use it everywhere
  customerSynced(oldId, newId) {
    this.tx(() => {
      if (Number(oldId) !== Number(newId)) {
        this.db.prepare('DELETE FROM tbl_customers WHERE id=?').run(newId);
        this.db.prepare('UPDATE tbl_customers SET id=? WHERE id=?').run(newId, oldId);
        this.db.prepare('UPDATE tbl_sales SET customer_id=? WHERE customer_id=?').run(String(newId), String(oldId));
      }
      this.db.prepare('UPDATE tbl_customers SET rj_pending=0 WHERE id=?').run(newId);
    });
  }

  upsert(table, row) {
    const r = this._clean(table, row);
    if (r.id === undefined || r.id === null || r.id === '') return;
    const keys = Object.keys(r);
    const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})
      ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== 'id').map((k) => `${k}=excluded.${k}`).join(',') || 'id=id'}`;
    this.db.prepare(sql).run(...keys.map((k) => r[k]));
  }

  all(table, where = "del_status IS NULL OR del_status='Live'", order = 'id') {
    return this.db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${order}`).all();
  }

  counts() {
    const out = {};
    for (const t of MASTER_TABLES) out[t] = this.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    return out;
  }

  hasMenu() { return this.db.prepare('SELECT COUNT(*) n FROM tbl_food_menus').get().n > 0; }

  catalog() {
    return {
      categories: this.all('tbl_food_menu_categories', "del_status IS NULL OR del_status='Live'", 'order_by, category_name'),
      items: this.all('tbl_food_menus', "del_status IS NULL OR del_status='Live'", 'sort, name'),
      modifiers: this.all('tbl_modifiers'),
      itemModifiers: this.all('tbl_food_menus_modifiers'),
      kitchens: this.all('tbl_kitchens', "del_status IS NULL OR del_status='Live'", 'name'),
      kitchenCategories: this.all('tbl_kitchen_categories'),
      customers: this.all('tbl_customers', "del_status IS NULL OR del_status='Live'", 'name'),
      tables: this.all('tbl_tables', "del_status IS NULL OR del_status='Live'", 'area, name'),
      areas: this.all('tbl_areas', "del_status IS NULL OR del_status='Live'", 'id'),
      paymentMethods: this.all('tbl_payment_methods', "del_status IS NULL OR del_status='Live'", 'order_by, id'),
      waiters: this.waiters(),
      printers: this.all('tbl_printers'),
    };
  }

  user(id) { return this.db.prepare('SELECT * FROM tbl_users WHERE id=?').get(id) || null; }
  userByEmail(email) {
    return this.db.prepare('SELECT * FROM tbl_users WHERE lower(email_address)=lower(?) AND (del_status IS NULL OR del_status=\'Live\')').get(String(email || '').trim()) || null;
  }
  userByPin(pin) {
    return this.db.prepare("SELECT * FROM tbl_users WHERE login_pin=? AND login_pin<>'' AND (del_status IS NULL OR del_status='Live')").all(String(pin || ''));
  }

  // ---- orders -----------------------------------------------------------------------------
  nextSaleCounter() {
    const n = (this.get('sale_counter', 0) || 0) + 1;
    this.set('sale_counter', n);
    return n;
  }

  // Save a whole order (header + lines + modifiers + payments + table) in one transaction.
  // `sale` is the header (tbl_sales columns), `lines` carry their own modifiers array.
  saveSale(sale, lines, payments, table) {
    return this.tx(() => {
      const now = Date.now();
      let existing = sale.sale_no ? this.db.prepare('SELECT * FROM tbl_sales WHERE sale_no=?').get(sale.sale_no) : null;
      if (existing && existing.sync_status === 'synced' && sale.sync_status !== 'synced') {
        // An already uploaded order is being changed again: upload it again (push_online updates by sale_no).
      }
      const header = this._clean('tbl_sales', { ...sale, updated_at: now });
      let id;
      if (existing) {
        id = existing.id;
        const keys = Object.keys(header).filter((k) => k !== 'id' && k !== 'created_at');
        this.db.prepare(`UPDATE tbl_sales SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => header[k]), id);
        this.db.prepare('DELETE FROM tbl_sales_details WHERE sales_id=?').run(id);
        this.db.prepare('DELETE FROM tbl_sales_details_modifiers WHERE sales_id=?').run(id);
        this.db.prepare('DELETE FROM tbl_sale_payments WHERE sale_id=?').run(id);
        this.db.prepare('DELETE FROM tbl_orders_table WHERE sale_id=?').run(id);
      } else {
        header.created_at = now;
        delete header.id;
        const keys = Object.keys(header);
        id = Number(this.db.prepare(`INSERT INTO tbl_sales (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => header[k])).lastInsertRowid);
      }
      let lineNo = 0;
      for (const l of lines) {
        const d = this._clean('tbl_sales_details', { ...l, sales_id: id, line_no: lineNo++ });
        delete d.id;
        const keys = Object.keys(d);
        const did = Number(this.db.prepare(`INSERT INTO tbl_sales_details (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => d[k])).lastInsertRowid);
        for (const m of l.modifiers || []) {
          this.db.prepare(`INSERT INTO tbl_sales_details_modifiers (modifier_id, modifier_name, modifier_price, food_menu_id, sales_id,
            sales_details_id, menu_taxes, user_id, outlet_id, customer_id) VALUES (?,?,?,?,?,?,?,?,?,?)`)
            .run(m.id, m.name, Number(m.price) || 0, l.food_menu_id, id, did, m.menu_taxes || '', sale.user_id || null, sale.outlet_id || null, Number(sale.customer_id) || null);
        }
      }
      for (const p of payments || []) {
        this.db.prepare(`INSERT INTO tbl_sale_payments (payment_id, payment_name, amount, sale_id, date_time, counter_id, user_id, outlet_id)
          VALUES (?,?,?,?,?,?,?,?)`).run(p.payment_id, p.payment_name, Number(p.amount) || 0, id, p.date_time || nowDateTime(), sale.counter_id || 0, sale.user_id || null, sale.outlet_id || null);
      }
      if (table && table.table_id) {
        this.db.prepare('INSERT INTO tbl_orders_table (persons, booking_time, sale_id, sale_no, outlet_id, table_id) VALUES (?,?,?,?,?,?)')
          .run(Number(table.persons) || 1, nowDateTime(), id, sale.sale_no, sale.outlet_id || null, table.table_id);
      }
      return id;
    });
  }

  saleById(id) {
    const s = this.db.prepare('SELECT * FROM tbl_sales WHERE id=?').get(id);
    if (!s) return null;
    const lines = this.db.prepare('SELECT * FROM tbl_sales_details WHERE sales_id=? ORDER BY line_no, id').all(id);
    const mods = this.db.prepare('SELECT * FROM tbl_sales_details_modifiers WHERE sales_id=? ORDER BY id').all(id);
    for (const l of lines) l.modifiers = mods.filter((m) => m.sales_details_id === l.id).map((m) => ({ id: m.modifier_id, name: m.modifier_name, price: m.modifier_price, menu_taxes: m.menu_taxes }));
    s.lines = lines;
    s.payments = this.db.prepare('SELECT * FROM tbl_sale_payments WHERE sale_id=? ORDER BY id').all(id);
    s.tables = this.db.prepare('SELECT * FROM tbl_orders_table WHERE sale_id=?').all(id);
    return s;
  }
  saleByNo(no) {
    const r = this.db.prepare('SELECT id FROM tbl_sales WHERE sale_no=?').get(no);
    return r ? this.saleById(r.id) : null;
  }

  runningOrders() {
    return this.db.prepare("SELECT * FROM tbl_sales WHERE sync_status='running' ORDER BY date_time DESC, id DESC").all();
  }

  setKotPrinted(saleId, lineIds) {
    this.tx(() => {
      for (const id of lineIds) this.db.prepare('UPDATE tbl_sales_details SET kot_qty=qty WHERE id=? AND sales_id=?').run(id, saleId);
      this.db.prepare('UPDATE tbl_sales SET kot_count=kot_count+1 WHERE id=?').run(saleId);
    });
  }

  cancelSale(id) {
    const s = this.db.prepare('SELECT kitchen_sync, kitchen_synced_at, origin FROM tbl_sales WHERE id=?').get(id);
    const shared = s && (s.kitchen_synced_at || s.origin === 'server');
    this.db.prepare(`UPDATE tbl_sales SET sync_status='cancelled', del_status='Deleted', kitchen_sync=?, updated_at=? WHERE id=? AND sync_status='running'`)
      .run(shared ? 'cancel' : null, Date.now(), id);
  }

  // ---- running orders shared with the website (tbl_kitchen_sales there) ---------------------
  kitchenPending(limit = 20) {
    return this.db.prepare("SELECT id, sale_no, user_id, updated_at, kitchen_sync, sync_status FROM tbl_sales WHERE kitchen_sync IN ('pending','cancel','delete') ORDER BY updated_at LIMIT ?").all(limit);
  }
  // a running order whose items were all paid as split bills: closed here, and taken off the website
  closeSplitParent(id) {
    this.tx(() => {
      this.db.prepare("UPDATE tbl_sales SET sync_status='cancelled', del_status='Split', kitchen_sync='delete', updated_at=? WHERE id=?").run(Date.now(), id);
      this.db.prepare('DELETE FROM tbl_orders_table WHERE sale_id=?').run(id);
    });
  }
  kitchenDone(id, updatedAt, state) {
    // server_hash is cleared: the website now holds this till's version, and the next pull adopts its hash
    this.db.prepare('UPDATE tbl_sales SET kitchen_sync=?, kitchen_synced_at=?, server_hash=NULL WHERE id=? AND updated_at=?').run(state === 'cancel' || state === 'delete' ? null : 'done', Date.now(), id, updatedAt);
  }
  // the website's waiter list (users whose role is Waiter), the same as its POS shows
  waiters() {
    const ids = this.get('waiter_ids', null);
    const all = this.db.prepare("SELECT id, full_name, designation FROM tbl_users WHERE (del_status IS NULL OR del_status='Live') ORDER BY full_name").all();
    if (Array.isArray(ids) && ids.length) { const set = new Set(ids.map(Number)); return all.filter((u) => set.has(Number(u.id))); }
    return all.filter((u) => String(u.designation || '').toLowerCase() === 'waiter');
  }
  // give a running order to another person (waiter, or the person responsible for it)
  assignSale(id, fields) {
    const keys = Object.keys(fields);
    this.db.prepare(`UPDATE tbl_sales SET ${keys.map((k) => k + '=?').join(', ')}, kitchen_sync='pending', server_hash=NULL, updated_at=? WHERE id=? AND sync_status='running'`)
      .run(...keys.map((k) => fields[k]), Date.now(), id);
  }
  setServerHash(id, hash) {
    this.db.prepare('UPDATE tbl_sales SET server_hash=? WHERE id=?').run(hash, id);
  }
  // the last paid sale on this computer (for "Print last invoice")
  lastPaidSale() {
    const r = this.db.prepare("SELECT id FROM tbl_sales WHERE sync_status IN ('pending','synced') AND order_status=3 ORDER BY COALESCE(paid_date_time, '') DESC, updated_at DESC, id DESC LIMIT 1").get();
    return r ? this.saleById(r.id) : null;
  }
  // sale_nos this till already has as running orders that it owns (so the website doesn't send them back)
  runningSaleNos() {
    return this.db.prepare("SELECT sale_no, origin, kitchen_sync, server_hash, user_id FROM tbl_sales WHERE sync_status='running'").all();
  }
  closedElsewhere(saleNo) {
    this.db.prepare("UPDATE tbl_sales SET sync_status='cancelled', del_status='Closed elsewhere', kitchen_sync=NULL, updated_at=? WHERE sale_no=? AND sync_status='running' AND (kitchen_sync IS NULL OR kitchen_sync='done')").run(Date.now(), saleNo);
  }

  pendingSales(limit = 20) {
    return this.db.prepare("SELECT id, sale_no, user_id, updated_at FROM tbl_sales WHERE sync_status='pending' ORDER BY sync_attempts, created_at LIMIT ?").all(limit);
  }

  markSynced(id, updatedAt, site, json, by) {
    // Only if the order didn't change while it was uploading.
    return this.db.prepare("UPDATE tbl_sales SET sync_status='synced', synced_at=?, synced_to=?, sync_error=NULL, order_json=?, uploaded_by=? WHERE id=? AND updated_at=? AND sync_status='pending'")
      .run(Date.now(), site, json, by == null ? null : Number(by), id, updatedAt).changes > 0;
  }

  // paid sales the website recorded under someone other than the person who invoiced them
  wrongUploader() {
    return this.db.prepare("SELECT id, user_id, user_name, sale_no FROM tbl_sales WHERE sync_status='synced' AND uploaded_by IS NOT NULL AND user_id IS NOT NULL AND uploaded_by != user_id").all();
  }

  // upload these again (the website updates a sale by its number, so nothing is doubled)
  requeue(ids) {
    const st = this.db.prepare("UPDATE tbl_sales SET sync_status='pending', sync_attempts=0, sync_error=NULL WHERE id=? AND sync_status='synced'");
    let n = 0; for (const id of ids) n += st.run(id).changes; return n;
  }

  paidSince(dateTime) {
    return this.db.prepare("SELECT id FROM tbl_sales WHERE sync_status='synced' AND order_status=3 AND uploaded_by IS NULL AND COALESCE(paid_date_time, date_time) >= ?").all(dateTime).map((r) => r.id);
  }

  markFailed(id, msg) {
    this.db.prepare('UPDATE tbl_sales SET sync_attempts=sync_attempts+1, sync_error=? WHERE id=?').run(String(msg || '').slice(0, 300), id);
  }

  log(saleNo, result, message) {
    try {
      this.db.prepare('INSERT INTO rj_sync_log (at, sale_no, result, message) VALUES (?,?,?,?)').run(Date.now(), saleNo || '', result, String(message || '').slice(0, 300));
      this.db.prepare('DELETE FROM rj_sync_log WHERE id < (SELECT MAX(id) - 2000 FROM rj_sync_log)').run();
    } catch { /* the log must never stop an upload */ }
  }

  syncCounts() {
    const r = {};
    for (const row of this.db.prepare('SELECT sync_status s, COUNT(*) n FROM tbl_sales GROUP BY sync_status').all()) r[row.s] = row.n;
    return { running: r.running || 0, pending: r.pending || 0, synced: r.synced || 0 };
  }

  // Delete uploaded orders older than `keepDays` so the database stays small.
  // a copy of every kitchen ticket, kept on this computer
  saveKot(k) {
    try {
      this.db.prepare('INSERT INTO rj_kot_log (at, sale_id, sale_no, kitchen, printers, lines_json, html, reprint, user_name) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(Date.now(), k.saleId || null, k.saleNo || '', k.kitchen || '', (k.printers || []).join(', '), JSON.stringify(k.lines || []), k.html || '', k.reprint ? 1 : 0, k.userName || '');
    } catch { /* never stop an order because of the copy */ }
  }
  kotsFor(saleNo) {
    return this.db.prepare('SELECT id, at, kitchen, printers, lines_json, reprint, user_name FROM rj_kot_log WHERE sale_no=? ORDER BY id').all(saleNo)
      .map((k) => ({ ...k, lines: (() => { try { return JSON.parse(k.lines_json); } catch { return []; } })() }));
  }
  kotById(id) { return this.db.prepare('SELECT * FROM rj_kot_log WHERE id=?').get(id); }

  purgeSynced(keepDays) {
    const cutoff = Date.now() - Math.max(0, Number(keepDays) || 0) * 86400000;
    // KOT copies go with their orders: only once the order is uploaded and older than the kept days
    try { this.db.prepare("DELETE FROM rj_kot_log WHERE at < ? AND sale_no NOT IN (SELECT sale_no FROM tbl_sales WHERE sync_status IN ('running','pending'))").run(cutoff); } catch { /* */ }
    return this.tx(() => {
      const ids = this.db.prepare("SELECT id FROM tbl_sales WHERE (sync_status='synced' AND synced_at < ?) OR (sync_status='cancelled' AND updated_at < ?)").all(cutoff, cutoff).map((r) => r.id);
      for (const id of ids) {
        this.db.prepare('DELETE FROM tbl_sales_details WHERE sales_id=?').run(id);
        this.db.prepare('DELETE FROM tbl_sales_details_modifiers WHERE sales_id=?').run(id);
        this.db.prepare('DELETE FROM tbl_sale_payments WHERE sale_id=?').run(id);
        this.db.prepare('DELETE FROM tbl_orders_table WHERE sale_id=?').run(id);
        this.db.prepare('DELETE FROM tbl_sales WHERE id=?').run(id);
      }
      return ids.length;
    });
  }

  // Sales list for the Sales screen. from/to are 'YYYY-MM-DD HH:MM:SS' strings (24h).
  listSales({ from, to, status, userId } = {}) {
    const where = ["sync_status <> 'cancelled'"];
    const args = [];
    if (from) { where.push('date_time >= ?'); args.push(from); }
    if (to) { where.push('date_time <= ?'); args.push(to); }
    if (status) { where.push('sync_status = ?'); args.push(status); }
    if (userId) { where.push('user_id = ?'); args.push(userId); }
    return this.db.prepare(`SELECT id, sale_no, date_time, customer_name, user_name, waiter_name, order_type, total_payable, paid_amount,
      total_items, sync_status, sync_error, orders_table_text FROM tbl_sales WHERE ${where.join(' AND ')} ORDER BY date_time DESC LIMIT 5000`).all(...args);
  }

  // ---- orders saved by version 1 of the app (table "orders"), still waiting to upload --------
  legacyPending() {
    try {
      return this.db.prepare("SELECT rowid AS rid, sale_no, local_id, order_json, attempts FROM orders WHERE status='pending' AND kind='paid' ORDER BY attempts, created_at LIMIT 20").all();
    } catch { return []; }
  }
  legacyDone(rid) {
    try { this.db.prepare("UPDATE orders SET status='synced', synced_at=? WHERE rowid=?").run(Date.now(), rid); } catch { /* */ }
  }
  legacyFailed(rid, msg) {
    try { this.db.prepare('UPDATE orders SET attempts=attempts+1, last_error=? WHERE rowid=?').run(String(msg).slice(0, 300), rid); } catch { /* */ }
  }
}

module.exports = { Db, MASTER_TABLES, nowDateTime };
