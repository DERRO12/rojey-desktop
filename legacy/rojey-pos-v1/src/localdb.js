// The app's own database (SQLite file in the app's data folder). Every order the POS saves is
// copied here straight away; uploads to the website are driven from here.
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  site        TEXT NOT NULL,
  sale_no     TEXT NOT NULL,
  local_id    TEXT,               -- the POS's own local id (IndexedDB key), sent as sales_id
  kind        TEXT NOT NULL,      -- 'paid' (recent_sales) or 'open' (sales: running, not paid yet)
  order_json  TEXT NOT NULL,
  sale_date   TEXT,
  date_time   TEXT,               -- 'YYYY-MM-DD HH:MM:SS' as the POS writes it
  total       REAL,
  order_type  TEXT,
  customer    TEXT,
  cashier     TEXT,
  status      TEXT NOT NULL,      -- 'open' | 'pending' | 'synced'
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  synced_at   INTEGER,
  PRIMARY KEY (site, sale_no)
);
CREATE INDEX IF NOT EXISTS orders_status ON orders(site, status, created_at);
CREATE INDEX IF NOT EXISTS orders_time ON orders(site, date_time);
CREATE TABLE IF NOT EXISTS sync_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  site    TEXT,
  sale_no TEXT,
  result  TEXT
);
`;

function parseOrder(text) {
  try { return typeof text === 'string' ? JSON.parse(text) : (text || {}); } catch { return {}; }
}

function normDateTime(v) {
  const s = String(v || '');
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) {
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }
  }
  return s.replace('T', ' ');
}

class LocalDb {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    this.db.exec(SCHEMA);
    this.qGet = this.db.prepare('SELECT * FROM orders WHERE site=? AND sale_no=?');
    this.qInsert = this.db.prepare(`INSERT INTO orders
      (site,sale_no,local_id,kind,order_json,sale_date,date_time,total,order_type,customer,cashier,status,created_at,updated_at,synced_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    this.qUpdate = this.db.prepare(`UPDATE orders SET local_id=?,kind=?,order_json=?,sale_date=?,date_time=?,total=?,order_type=?,
      customer=?,cashier=?,status=?,updated_at=?,synced_at=COALESCE(?,synced_at) WHERE site=? AND sale_no=?`);
    this.qPending = this.db.prepare(`SELECT * FROM orders WHERE site=? AND status='pending' ORDER BY attempts, created_at LIMIT ?`);
    this.qCount = this.db.prepare(`SELECT status, COUNT(*) n FROM orders WHERE site=? GROUP BY status`);
    this.qMarkSynced = this.db.prepare(`UPDATE orders SET status='synced', synced_at=?, last_error=NULL, updated_at=? WHERE site=? AND sale_no=? AND order_json=?`);
    this.qMarkFail = this.db.prepare(`UPDATE orders SET attempts=attempts+1, last_error=?, updated_at=? WHERE site=? AND sale_no=?`);
    this.qLog = this.db.prepare('INSERT INTO sync_log (at,site,sale_no,result) VALUES (?,?,?,?)');
  }

  // rec: a record from the POS's local store; kind: 'paid' | 'open'
  upsertFromPos(site, rec, kind) {
    const o = parseOrder(rec.order);
    const saleNo = String(o.sale_no || rec.sale_no || '');
    if (!saleNo) return null;
    const orderJson = typeof rec.order === 'string' ? rec.order : JSON.stringify(rec.order || {});
    const now = Date.now();
    const posSaysPushed = Number(rec.online_push) === 1;
    const prev = this.qGet.get(site, saleNo);
    const fields = {
      local_id: rec.sales_id != null ? String(rec.sales_id) : (prev && prev.local_id) || null,
      sale_date: o.sale_date || String(o.date_time || '').slice(0, 10),
      date_time: normDateTime(o.date_time || o.sale_date),
      total: Number(o.total_payable) || 0,
      order_type: o.order_type != null ? String(o.order_type) : null,
      customer: [o.customer_name, o.orders_table_text || o.selected_table].filter(Boolean).join(' · '),
      cashier: o.user_name || '',
    };
    let status;
    if (kind === 'open') {
      // A running order that later gets paid moves to 'paid'; never move a paid order back to open.
      if (prev && prev.kind === 'paid') return prev.sale_no;
      status = 'open';
    } else if (posSaysPushed) {
      status = 'synced';
    } else if (prev && prev.status === 'synced' && prev.order_json === orderJson) {
      status = 'synced';
    } else {
      status = 'pending';
    }
    if (!prev) {
      this.qInsert.run(site, saleNo, fields.local_id, kind, orderJson, fields.sale_date, fields.date_time, fields.total,
        fields.order_type, fields.customer, fields.cashier, status, now, now, status === 'synced' ? now : null);
    } else {
      const changed = prev.order_json !== orderJson || prev.status !== status || prev.kind !== kind || prev.local_id !== fields.local_id;
      if (!changed) return saleNo;
      this.qUpdate.run(fields.local_id, kind, orderJson, fields.sale_date, fields.date_time, fields.total, fields.order_type,
        fields.customer, fields.cashier, status, now, status === 'synced' ? now : null, site, saleNo);
    }
    return saleNo;
  }

  // Open (running) orders the POS has removed: paid (they come back as 'paid') or cancelled.
  removeOpen(site, localIds, keepOnly) {
    const rows = this.db.prepare("SELECT sale_no, local_id FROM orders WHERE site=? AND kind='open'").all(site);
    const del = this.db.prepare("DELETE FROM orders WHERE site=? AND sale_no=? AND kind='open'");
    for (const r of rows) {
      const gone = keepOnly ? !keepOnly.has(String(r.local_id)) : localIds.includes(String(r.local_id));
      if (gone) del.run(site, r.sale_no);
    }
  }

  pending(site, limit = 20) { return this.qPending.all(site, limit); }

  counts(site) {
    const out = { open: 0, pending: 0, synced: 0 };
    for (const r of this.qCount.all(site)) out[r.status] = r.n;
    return out;
  }

  // Only marks synced if the order wasn't changed again while it was uploading.
  markSynced(site, row) {
    const now = Date.now();
    this.qMarkSynced.run(now, now, site, row.sale_no, row.order_json);
    this.qLog.run(now, site, row.sale_no, 'uploaded');
  }

  markFailed(site, row, err) {
    const now = Date.now();
    this.qMarkFail.run(String(err).slice(0, 300), now, site, row.sale_no);
    this.qLog.run(now, site, row.sale_no, 'failed: ' + String(err).slice(0, 200));
  }

  list(site, { from = '', to = '', status = 'all', limit = 2000 } = {}) {
    const where = ['site = ?'];
    const args = [site];
    if (from) { where.push('date_time >= ?'); args.push(from); }
    if (to) { where.push('date_time <= ?'); args.push(to); }
    if (status === 'open') where.push("status = 'open'");
    else if (status === 'wait') where.push("status = 'pending'");
    else if (status === 'ok') where.push("status = 'synced'");
    args.push(limit);
    return this.db.prepare(`SELECT sale_no, kind, order_json, date_time, total, order_type, customer, cashier, status, last_error
      FROM orders WHERE ${where.join(' AND ')} ORDER BY date_time DESC LIMIT ?`).all(...args);
  }
}

module.exports = { LocalDb, parseOrder, normDateTime };
