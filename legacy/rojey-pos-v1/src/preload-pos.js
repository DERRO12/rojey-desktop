// Runs inside the POS page (same JavaScript world as the website's own code).
const { ipcRenderer } = require('electron');

// Print popups: the POS opens an empty window, writes the receipt into it and calls print().
// Send that print() to the printer chosen in setup instead of showing a dialog.
const originalOpen = window.open;
let popupCounter = 0;
window.open = function (...args) {
  // The POS reuses one window called "popup" for every print. Give each print its own window
  // so a kitchen ticket and a receipt sent together both print.
  if ((!args[0] || args[0] === 'about:blank') && args[1] === 'popup') args[1] = 'popup_' + (++popupCounter);
  const w = originalOpen.apply(this, args);
  try {
    if (w) {
      const patch = () => { try { w.print = () => ipcRenderer.send('rojey-print-child'); } catch (e) { /* ignore */ } };
      patch();
      // document.write can swap the page inside the popup; patch again once it settles.
      setTimeout(patch, 50);
      setTimeout(patch, 300);
      setTimeout(patch, 800);
    }
  } catch (e) { /* cross-origin popup */ }
  return w;
};

// Used by the POS (patched upload function) and the "Offline sales" page.
window.rojeyDesktop = {
  status: () => ipcRenderer.invoke('rojey:status'),
  checkNow: () => ipcRenderer.invoke('rojey:check-now'),
  openPos: () => ipcRenderer.send('rojey:open-pos'),
  listOrders: (f) => ipcRenderer.invoke('localdb:list', f || {}),
  syncNow: (notify) => ipcRenderer.send('rojey:sync-now', !!notify),
};

// ---------------------------------------------------------------------------
// Copy every order the POS saves into the app's own database, the moment it is saved.
const WATCH = { recent_sales: 'paid', sales: 'open' };
function plain(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; } }
function sendOrder(store, rec) {
  const r = plain(rec);
  if (r) ipcRenderer.send('localdb:upsert', [{ kind: WATCH[store], rec: r }]);
}
try {
  const P = IDBObjectStore.prototype;
  const origAdd = P.add, origPut = P.put, origDelete = P.delete;
  P.add = function (value, key) {
    const req = origAdd.apply(this, arguments);
    if (WATCH[this.name] && value && typeof value === 'object') {
      const store = this.name;
      req.addEventListener('success', () => { const v = Object.assign({}, value); if (v.sales_id == null) v.sales_id = req.result; sendOrder(store, v); });
    }
    return req;
  };
  P.put = function (value, key) {
    const req = origPut.apply(this, arguments);
    if (WATCH[this.name] && value && typeof value === 'object') {
      const store = this.name;
      req.addEventListener('success', () => { const v = Object.assign({}, value); if (v.sales_id == null) v.sales_id = req.result; sendOrder(store, v); });
    }
    return req;
  };
  P.delete = function (key) {
    const req = origDelete.apply(this, arguments);
    if (this.name === 'sales' && (typeof key === 'number' || typeof key === 'string')) {
      req.addEventListener('success', () => ipcRenderer.send('localdb:open-removed', [String(key)]));
    }
    return req;
  };
} catch (e) { /* no IndexedDB */ }

// Safety net: every 15 s copy everything (catches anything saved before the app started watching).
function openPosDb(cb) {
  try {
    const rq = indexedDB.open('irestora_plus');
    rq.onupgradeneeded = (e) => { e.target.transaction.abort(); };
    rq.onsuccess = () => cb(rq.result);
    rq.onerror = () => {};
  } catch (e) { /* ignore */ }
}
function fullScan() {
  if (!/\/Sale\/POS/i.test(location.pathname)) return;
  openPosDb((db) => {
    const names = Object.keys(WATCH).filter((n) => db.objectStoreNames.contains(n));
    if (!names.length) { db.close(); return; }
    const out = []; const openIds = [];
    const tx = db.transaction(names);
    for (const n of names) {
      tx.objectStore(n).openCursor().onsuccess = (e) => {
        const c = e.target.result; if (!c) return;
        const v = plain(c.value); if (v) { if (v.sales_id == null) v.sales_id = c.primaryKey; out.push({ kind: WATCH[n], rec: v }); if (n === 'sales') openIds.push(String(v.sales_id)); }
        c.continue();
      };
    }
    tx.oncomplete = () => { db.close(); ipcRenderer.send('localdb:upsert', out, { openIds }); };
  });
}
setInterval(fullScan, 15000);
window.addEventListener('load', () => setTimeout(fullScan, 1500));

// After the app uploads an order, tick it as uploaded in the POS too (so its counter is right).
ipcRenderer.on('rojey:mark-pushed', (_e, localIds) => {
  openPosDb((db) => {
    if (!db.objectStoreNames.contains('recent_sales')) { db.close(); return; }
    const tx = db.transaction('recent_sales', 'readwrite');
    const st = tx.objectStore('recent_sales');
    for (const id of localIds) {
      const key = /^\d+$/.test(id) ? Number(id) : id;
      const g = st.get(key);
      g.onsuccess = () => { const v = g.result; if (v && Number(v.online_push) !== 1) { v.online_push = 1; st.put(v); } };
    }
    tx.oncomplete = () => db.close();
  });
});

// ---------------------------------------------------------------------------
// One-tap KOT when offline. The POS normally needs: KOT -> "All items / New items" (-> "Print KOT").
// After the POS handles the first tap, pick the configured option automatically.
let cfg = {};
try { cfg = ipcRenderer.sendSync('rojey:cfg-sync') || {}; } catch (e) { cfg = {}; }

function q(sel) { return document.querySelector(sel); }
function waitFor(test, ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function loop() {
      let ok = false; try { ok = test(); } catch (e) { ok = false; }
      if (ok) return resolve(true);
      if (Date.now() - t0 > ms) return resolve(false);
      setTimeout(loop, 40);
    })();
  });
}

let autoKotBusy = false;
window.addEventListener('click', (e) => {
  if (cfg.oneTapKot === false || autoKotBusy || !e.isTrusted) return;
  // Online the POS's own KOT flow is kept as it is; this only shortens it when offline.
  const off = document.getElementById('is_offline_system');
  if (!off || String(off.value) !== '0') return;
  const t = e.target && e.target.closest && e.target.closest('.print_kot_button');
  if (!t) return;
  autoKotBusy = true;
  setTimeout(async () => {
    try {
      // The POS opens the small "All items / New items" box only when an order is selected.
      if (!q('.invoice_box_kot.active')) return;
      const type = cfg.kotItems === 'all' ? '1' : '2';
      const choice = q('.kot_btn_class[data-type="' + type + '"]');
      if (!choice) return;
      document.body.classList.add('rojey-autokot');
      choice.click();
      // Online the POS shows a kitchen list with all kitchens ticked; press its Print KOT button.
      const opened = await waitFor(() => q('#kot_list_modal.active'), 2500);
      if (opened) {
        await new Promise((r) => setTimeout(r, 250));
        const btn = q('#print_kot_modal');
        if (btn) btn.click();
      }
      const box = q('.invoice_box_kot.active');
      if (box) box.classList.remove('active');
    } finally {
      setTimeout(() => { document.body && document.body.classList.remove('rojey-autokot'); autoKotBusy = false; }, 1200);
    }
  }, 0);
}, false);

document.addEventListener('DOMContentLoaded', () => {
  const st = document.createElement('style');
  st.textContent = 'body.rojey-autokot #kot_list_modal, body.rojey-autokot .pos__modal__overlay, body.rojey-autokot .invoice_box_kot{opacity:0 !important;pointer-events:none !important}';
  document.head.appendChild(st);
});
