// Kitchen tickets (KOT) and receipts. Each item goes to its kitchen's printer (Kitchen, Bar, Cafe...),
// chosen in Settings. Printing is silent: no dialog.
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const calc = require('./ui/calc');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ORDER_TYPES = { 1: 'Dine In', 2: 'Take Away', 3: 'Delivery' };

function page(body, width) {
  const w = width === '58' ? 54 : 76;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; size: ${w + 4}mm auto; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 2mm; width: ${w}mm; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; }
    h1 { font-size: 16px; margin: 0 0 2px; text-align: center; }
    h2 { font-size: 14px; margin: 0 0 4px; text-align: center; }
    .c { text-align: center; } .r { text-align: right; } .b { font-weight: bold; }
    .big { font-size: 15px; }
    table { width: 100%; border-collapse: collapse; }
    td, th { padding: 2px 0; vertical-align: top; }
    th { text-align: left; border-bottom: 1px dashed #000; }
    .line { border-top: 1px dashed #000; margin: 4px 0; }
    .mods { font-size: 11px; padding-left: 8px; }
    .note { font-size: 11px; font-style: italic; padding-left: 8px; }
  </style></head><body>${body}</body></html>`;
}

// One ticket per kitchen. `lines` = [{ menu_name, qty, modifiers, menu_note, kitchen_name }]
function kotHtml(sale, kitchenName, lines, opts = {}) {
  const rows = lines.map((l) => `<tr><td class="big b">${esc(l.qty)} x</td><td class="big b">${esc(l.menu_name)}
      ${(l.modifiers || []).length ? `<div class="mods">+ ${l.modifiers.map((m) => esc(m.name)).join(', ')}</div>` : ''}
      ${l.menu_note ? `<div class="note">${esc(l.menu_note)}</div>` : ''}</td></tr>`).join('');
  return page(`
    <h1 class="kot-print-title">KOT${opts.reprint ? ' (REPRINT)' : ''}</h1>
    <h2>${esc(kitchenName || 'Kitchen')}</h2>
    <div>Order: <b>${esc(sale.sale_no)}</b></div>
    <div>Type: ${esc(ORDER_TYPES[sale.order_type] || '')}${sale.orders_table_text ? ' &nbsp; Table: <b>' + esc(sale.orders_table_text) + '</b>' : ''}</div>
    ${sale.waiter_name ? `<div>Waiter: ${esc(sale.waiter_name)}</div>` : ''}
    ${sale.customer_name ? `<div>Customer: ${esc(sale.customer_name)}</div>` : ''}
    <div>Time: ${esc(opts.time || sale.date_time)}</div>
    <div class="line"></div>
    <table><tr><th style="width:18%">Qty</th><th>Item</th></tr>${rows}</table>
    <div class="line"></div>
    <div class="c">By ${esc(sale.user_name || '')}</div>`, opts.width);
}

function receiptHtml(sale, s, opts = {}) {
  const m = (v) => calc.money(v, s);
  const rows = (sale.lines || []).map((l) => `<tr><td>${esc(l.menu_name)}
      ${(l.modifiers || []).length ? `<div class="mods">+ ${l.modifiers.map((x) => esc(x.name)).join(', ')}</div>` : ''}</td>
      <td class="r">${esc(l.qty)}</td><td class="r">${m(l.menu_price_with_discount)}</td></tr>`).join('');
  const vat = (() => { try { return JSON.parse(sale.sale_vat_objects || '[]'); } catch { return []; } })();
  const pays = (sale.payments || []).map((p) => `<tr><td>${esc(p.payment_name)}</td><td class="r">${m(p.amount)}</td></tr>`).join('');
  const title = opts.bill ? 'BILL' : 'RECEIPT';
  return page(`
    <h1>${esc(s.outletName || 'Rojey')}</h1>
    ${s.outletAddress ? `<div class="c">${esc(s.outletAddress)}</div>` : ''}
    ${s.outletPhone ? `<div class="c">Tel: ${esc(s.outletPhone)}</div>` : ''}
    ${s.taxRegistrationNo && s.collectTax === 'Yes' ? `<div class="c">Tax Reg: ${esc(s.taxRegistrationNo)}</div>` : ''}
    <h2 style="margin-top:4px">${title}${opts.reprint ? ' (COPY)' : ''}</h2>
    <div>Invoice No: <b>${esc(sale.sale_no)}</b></div>
    <div>Date: ${esc(sale.date_time)}</div>
    <div>Type: ${esc(ORDER_TYPES[sale.order_type] || '')}${sale.orders_table_text ? ' &nbsp; Table: ' + esc(sale.orders_table_text) : ''}</div>
    <div>Customer: ${esc(sale.customer_name || '')}</div>
    ${sale.customer_phone ? `<div>Phone: ${esc(sale.customer_phone)}</div>` : ''}
    ${sale.customer_address && Number(sale.order_type) === 3 ? `<div>Deliver to: ${esc(sale.customer_address)}</div>` : ''}
    ${sale.waiter_name ? `<div>Waiter: ${esc(sale.waiter_name)}</div>` : ''}
    <div>Served by: ${esc(sale.user_name || '')}</div>
    <div class="line"></div>
    <table><tr><th>Item</th><th class="r">Qty</th><th class="r">Total</th></tr>${rows}</table>
    <div class="line"></div>
    <table>
      <tr><td>Sub Total</td><td class="r">${m(sale.sub_total)}</td></tr>
      ${Number(sale.total_discount_amount) ? `<tr><td>Discount</td><td class="r">-${m(sale.total_discount_amount)}</td></tr>` : ''}
      ${s.collectTax === 'Yes' ? vat.filter((t) => Number(t.tax_field_amount)).map((t) => `<tr><td>${esc(t.tax_field_type)}</td><td class="r">${m(t.tax_field_amount)}</td></tr>`).join('') : ''}
      ${Number(sale.delivery_charge) ? `<tr><td>Charge</td><td class="r">${m(sale.delivery_charge)}</td></tr>` : ''}
      ${Number(sale.tips_amount) ? `<tr><td>Tips</td><td class="r">${m(sale.tips_amount)}</td></tr>` : ''}
      <tr class="b big"><td>Total Payable</td><td class="r">${m(sale.total_payable)}</td></tr>
    </table>
    ${opts.bill ? '' : `<div class="line"></div><table>${pays}
      ${Number(sale.given_amount) ? `<tr><td>Given</td><td class="r">${m(sale.given_amount)}</td></tr>` : ''}
      ${Number(sale.change_amount) ? `<tr><td>Change</td><td class="r">${m(sale.change_amount)}</td></tr>` : ''}
      ${Number(sale.due_amount) > 0 ? `<tr><td>Due</td><td class="r">${m(sale.due_amount)}</td></tr>` : ''}</table>`}
    <div class="line"></div>
    <div class="c">${esc(s.invoiceFooter || 'Thank you!')}</div>`, opts.width);
}

// Group lines by kitchen. Items without a kitchen go to "Kitchen" (the default kitchen printer).
function groupByKitchen(lines, kitchens) {
  const names = {};
  for (const k of kitchens || []) names[k.id] = k.name;
  const groups = new Map();
  for (const l of lines) {
    const key = l.kitchen_id ? String(l.kitchen_id) : '';
    if (!groups.has(key)) groups.set(key, { kitchenId: key, kitchenName: key ? (names[key] || l.kitchen_name || 'Kitchen') : (l.kitchen_name || 'Kitchen'), lines: [] });
    groups.get(key).lines.push(l);
  }
  return [...groups.values()];
}

// Windows printer state from WMI (Win32_Printer): offline, out of paper, jammed, door open...
const WMI_ERRORS = { 4: 'out of paper', 6: 'out of toner or ink', 7: 'open (door or cover)', 8: 'jammed', 9: 'offline', 10: 'asking for service', 11: 'full (output tray)' };
function problemOf(p) {
  if (!p) return '';
  if (p.WorkOffline) return 'offline (not connected or switched off)';
  if (WMI_ERRORS[p.DetectedErrorState]) return WMI_ERRORS[p.DetectedErrorState];
  if (p.PrinterStatus === 7) return 'offline';
  if (p.PrinterStatus === 6) return 'stopped';
  return '';
}
function friendly(label) {
  if (/^kot-/.test(label)) return 'KOT for ' + label.slice(4);
  return { receipt: 'Receipt', bill: 'Bill', test: 'Test print' }[label] || label || 'Print';
}

class Printer {
  constructor(getCfg, log, onError) {
    this.getCfg = getCfg;
    this.log = log || (() => {});
    this.onError = onError || (() => {});
    this.queue = Promise.resolve();
    this.testDir = process.env.ROJEY_PRINT_DIR || '';
    this.n = 0;
    this.failed = new Map(); this.failSeq = 0;
    this.states = null; this.statesAt = 0; this.defaultName = '';
    if (process.platform === 'win32' && !this.testDir) { this.refreshStates(); setInterval(() => this.refreshStates(), 20000).unref(); }
  }

  // printer states, read in the background so printing never waits for it
  refreshStates() {
    if (this.reading) return this.reading;
    const { execFile } = require('child_process');
    const cmd = 'Get-CimInstance Win32_Printer | Select-Object Name,WorkOffline,PrinterStatus,DetectedErrorState,Default | ConvertTo-Json -Compress';
    this.reading = new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true, timeout: 15000 }, (err, out) => {
        this.reading = null;
        if (err) { resolve(this.states); return; }
        try {
          let list = JSON.parse(String(out || '').trim() || '[]'); if (!Array.isArray(list)) list = [list];
          this.states = new Map(list.map((p) => [String(p.Name).toLowerCase(), p]));
          const d = list.find((p) => p.Default); this.defaultName = d ? d.Name : '';
          this.statesAt = Date.now();
        } catch { /* keep the last states */ }
        resolve(this.states);
      });
    });
    return this.reading;
  }

  // '' when the printer looks fine (or its state is unknown), otherwise what is wrong
  problem(deviceName) {
    if (this.testDir) return /^offline/i.test(deviceName || '') ? 'offline (not connected or switched off)' : '';
    if (!this.states) return '';
    const name = deviceName || this.defaultName;
    if (!name) return deviceName ? '' : 'missing: Windows has no default printer';
    const p = this.states.get(String(name).toLowerCase());
    if (!p) return 'not found on this computer (was it renamed or removed?)';
    return problemOf(p);
  }

  fail(job, reason) {
    const id = ++this.failSeq;
    this.failed.set(id, job);
    if (this.failed.size > 50) this.failed.delete(this.failed.keys().next().value);
    const info = { id, what: friendly(job.label), printer: job.deviceName || 'the Windows default printer', reason, at: Date.now() };
    this.log('PRINT FAILED: ' + info.what + ' on ' + info.printer + ': ' + reason);
    this.onError(info);
  }

  // print a failed ticket again (after the printer is fixed)
  async retry(id) {
    const job = this.failed.get(Number(id));
    if (!job) return { ok: false, error: 'This ticket is no longer waiting. Use reprint instead.' };
    this.failed.delete(Number(id));
    if (process.platform === 'win32' && !this.testDir) await this.refreshStates();
    const ok = await this.print(job.html, job.deviceName, job.copies, job.label);
    return { ok: !!ok };
  }

  // A kitchen can have one printer or several (the same ticket prints on each).
  printersForKitchen(kitchenId) {
    const c = this.getCfg();
    let v = kitchenId && c.kitchenPrinters ? c.kitchenPrinters[String(kitchenId)] : null;
    const list = (Array.isArray(v) ? v : [v]).filter(Boolean);
    return list.length ? [...new Set(list)] : [c.kitchenPrinter || c.receiptPrinter || ''];
  }
  printerForKitchen(kitchenId) { return this.printersForKitchen(kitchenId)[0]; }

  // Prints are queued so that a busy moment never opens many windows at once.
  print(html, deviceName, copies = 1, label = '') {
    const info = { html, deviceName, copies, label };
    const job = async () => {
      const why = (b) => (b.startsWith('missing: ') ? b.slice(9) : 'Windows says the printer is ' + b);
      const bad = this.problem(deviceName);
      if (this.testDir) {
        if (bad) { this.fail(info, why(bad)); return false; }
        fs.mkdirSync(this.testDir, { recursive: true });
        const f = path.join(this.testDir, `${String(++this.n).padStart(4, '0')}-${label.replace(/[^a-z0-9_-]/gi, '_')}-${(deviceName || 'default').replace(/[^a-z0-9_-]/gi, '_')}.html`);
        fs.writeFileSync(f, html);
        return true;
      }
      const win = new BrowserWindow({ show: false, width: 400, height: 600, webPreferences: { sandbox: true, javascript: false } });
      try {
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        const printed = await new Promise((resolve) => {
          win.webContents.print({ silent: true, printBackground: false, deviceName: deviceName || undefined, copies: Math.max(1, Number(copies) || 1), margins: { marginType: 'none' } },
            (ok, reason) => {
              if (!ok) this.fail(info, (reason ? 'Windows said: ' + reason : 'Windows could not print') + (bad ? '. ' + why(bad) : ''));
              resolve(ok);
            });
        });
        if (!printed) return false;
        // The job went to Windows, but the printer has a problem: Windows keeps the ticket and prints it when the
        // printer is back. It is still reported, because the kitchen does not have it yet.
        const later = ' The ticket is waiting in Windows and prints when the printer is back; press Print again only if it never comes out';
        if (bad) this.fail(info, why(bad) + '.' + later);
        else if (process.platform === 'win32') setTimeout(() => this.refreshStates().then(() => { const b = this.problem(deviceName); if (b) this.fail(info, why(b) + '.' + later); }), 3000);
      } catch (e) {
        this.fail(info, e.message);
        return false;
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
      return true;
    };
    this.queue = this.queue.then(job, job);
    return this.queue;
  }

  kot(sale, lines, kitchens, opts = {}) {
    const c = this.getCfg();
    const groups = groupByKitchen(lines, kitchens);
    for (const g of groups) {
      const html = kotHtml(sale, g.kitchenName, g.lines, { ...opts, width: c.paperWidth });
      const devs = this.printersForKitchen(g.kitchenId);
      for (const dev of devs) this.print(html, dev, c.kotCopies, 'kot-' + g.kitchenName);
      if (this.onKot) this.onKot({ saleId: sale.id, saleNo: sale.sale_no, kitchen: g.kitchenName, printers: devs.map((d) => d || 'Windows default printer'), lines: g.lines.map((l) => ({ name: l.menu_name, qty: l.qty, note: l.menu_note || '', modifiers: (l.modifiers || []).map((m) => m.name || m.modifier_name).filter(Boolean) })), html, reprint: !!opts.reprint });
    }
    return groups.map((g) => g.kitchenName);
  }

  receipt(sale, settings, opts = {}) {
    const c = this.getCfg();
    return this.print(receiptHtml(sale, settings, { ...opts, width: c.paperWidth }), c.receiptPrinter, opts.bill ? 1 : c.receiptCopies, opts.bill ? 'bill' : 'receipt');
  }

  test(deviceName, what) {
    const c = this.getCfg();
    const html = page(`<h1>Rojey POS</h1><h2>Test print</h2><div class="c">${esc(what || '')}</div><div class="c">${esc(deviceName || 'Default printer')}</div><div class="c">${new Date().toLocaleString()}</div>`, c.paperWidth);
    return this.print(html, deviceName, 1, 'test');
  }
}

module.exports = { Printer, kotHtml, receiptHtml, groupByKitchen };
