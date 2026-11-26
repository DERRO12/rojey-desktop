(function () {
  const { $, esc, toast } = RJ; const api = window.rojey; const C = window.RojeyCalc;
  let S = {};
  const p = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const hm = (d) => `${p(d.getHours())}:${p(d.getMinutes())}`;
  const okTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const TYPES = { 1: 'Dine In', 2: 'Take Away', 3: 'Delivery' };
  const LABEL = { pending: 'Waiting', synced: 'Uploaded', running: 'Running' };

  const money = (v) => C.num(v).toFixed(S.precision != null ? S.precision : 2);
  function range() {
    const ft = $('#ft').value.trim() || '00:00'; const tt = $('#tt').value.trim() || '23:59';
    if (!okTime(ft) || !okTime(tt)) { toast('Use 24-hour time like 08:00 or 21:30', 'error'); return null; }
    const f = {};
    if ($('#fd').value) f.from = $('#fd').value + ' ' + ft + ':00';
    if ($('#td').value) f.to = $('#td').value + ' ' + tt + ':59';
    if ($('#who').value) f.userId = Number($('#who').value);
    return f;
  }

  // every till's sales, as the website has them (and this till's sales not uploaded yet); refreshes by itself
  async function showWeb(quiet) {
    const f = range(); if (!f) return;
    const r = await api.call('sales:web', f);
    if (!r || r.ok === false || !Array.isArray(r.rows)) { if (!quiet) toast((r && r.error) || 'Could not load', 'error'); return; }
    const rows = r.rows;
    const total = rows.reduce((a, x) => a + C.num(x.total), 0);
    const per = new Map(); for (const x of rows) { const k = x.user || '-'; const v = per.get(k) || { n: 0, t: 0 }; v.n++; v.t += C.num(x.total); per.set(k, v); }
    $('#totals').innerHTML = `<span>Sales: <b>${rows.length}</b></span><span>Total: <b>${C.money(total, S)}</b></span><span>Updated: <b>${RJ.fmtTime(r.at)}</b></span>` + (r.error ? `<span class="rj-warn">${esc(r.error)}</span>` : '');
    $('#bywho').innerHTML = [...per.entries()].sort((a, b) => b[1].t - a[1].t).map(([k, v]) => `<span>${esc(k)}: <b>${v.n}</b> · <b>${C.money(v.t, S)}</b></span>`).join('');
    $('#tbl').innerHTML = '<tr><th>Date &amp; time</th><th>Order</th><th>Type</th><th>Customer</th><th>Sold by</th><th>Payments</th><th class="r">Total</th><th>Where</th></tr>' +
      rows.map((x) => `<tr><td>${esc(x.date_time)}</td><td>${esc(x.sale_no)}</td><td>${esc(TYPES[x.type] || x.type || '')}</td><td>${esc(x.customer || '')}</td><td>${esc(x.user || '')}</td>
        <td>${esc(x.payments || '')}</td><td class="r">${money(x.total)}</td><td><span class="rj-badge ${x.where === 'Website' ? 'synced' : 'pending'}">${esc(x.where)}</span></td></tr>`).join('');
  }

  function show(quiet) {
    const web = $('#src').value === 'web';
    $('#stw').style.display = web ? 'none' : '';
    $('#title').textContent = web ? 'Sales on all tills' : 'Sales on this computer';
    return web ? showWeb(quiet) : showLocal();
  }

  async function showLocal() {
    const f0 = range(); if (!f0) return;
    const f = { ...f0, status: $('#st').value || undefined };
    $('#bywho').innerHTML = '';
    const rows = await api.call('sales:list', f);
    if (!Array.isArray(rows)) return toast(rows.error || 'Could not load', 'error');
    const paid = rows.filter((r) => r.sync_status !== 'running');
    const total = paid.reduce((a, r) => a + C.num(r.total_payable), 0);
    $('#totals').innerHTML = `<span>Sales: <b>${paid.length}</b></span><span>Total: <b>${C.money(total, S)}</b></span>
      <span>Waiting to upload: <b>${rows.filter((r) => r.sync_status === 'pending').length}</b></span><span>Running: <b>${rows.filter((r) => r.sync_status === 'running').length}</b></span>`;
    $('#tbl').innerHTML = '<tr><th>Date &amp; time</th><th>Order</th><th>Type</th><th>Table</th><th>Customer</th><th>Cashier</th><th>Waiter</th><th class="r">Total</th><th>Status</th><th></th></tr>' +
      rows.map((r) => `<tr><td>${esc(r.date_time)}</td><td>${esc(r.sale_no)}</td><td>${TYPES[r.order_type] || ''}</td><td>${esc(r.orders_table_text || '')}</td>
        <td>${esc(r.customer_name || '')}</td><td>${esc(r.user_name || '')}</td><td>${esc(r.waiter_name || '')}</td><td class="r">${C.num(r.total_payable).toFixed(S.precision != null ? S.precision : 2)}</td>
        <td><span class="rj-badge ${r.sync_status}" title="${esc(r.sync_error || '')}">${LABEL[r.sync_status] || r.sync_status}</span></td>
        <td>${r.sync_status !== 'running' ? `<a href="#" data-r="${r.id}">Reprint</a>` : ''}</td></tr>`).join('');
  }

  function setRange(from, to) {
    $('#fd').value = from ? ymd(from) : ''; $('#ft').value = from ? hm(from) : '';
    $('#td').value = to ? ymd(to) : ''; $('#tt').value = to ? hm(to) : '';
    show();
  }
  $('#go').onclick = () => show();
  $('#src').onchange = () => show();
  $('#who').onchange = () => show();
  setInterval(() => { if ($('#src').value === 'web') show(true); }, 15000);
  $('#today').onclick = () => { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(); b.setHours(23, 59, 0, 0); setRange(a, b); };
  $('#last24').onclick = () => setRange(new Date(Date.now() - 86400000), new Date());
  $('#all').onclick = () => setRange(null, null);
  $('#back').onclick = () => api.call('nav', 'pos');
  $('#sync').onclick = async () => { const st = await api.call('sync:now'); toast(st.online ? 'Synced' : 'No internet now. Orders will upload by themselves later.', st.online ? 'success' : 'info'); show(); };
  $('#tbl').onclick = async (e) => { const a = e.target.closest('[data-r]'); if (!a) return; e.preventDefault(); const r = await api.call('pos:reprintReceipt', Number(a.dataset.r)); toast(r.ok === false ? r.error : 'Receipt sent to the printer', r.ok === false ? 'error' : 'success'); };
  api.on('status', (st) => { $('#netline').textContent = (st.online ? 'Online' : 'Offline') + ` · waiting to upload: ${st.pending + (st.legacyPending || 0)} · last upload: ${RJ.fmtTime(st.lastSync)}` + (st.lastError ? ' · last problem: ' + st.lastError : ''); });
  api.call('sales:people').then((list) => { if (Array.isArray(list)) $('#who').innerHTML = '<option value="">Everyone</option>' + list.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join(''); });
  api.call('app:state').then((s) => { S = s.settings || {}; if (!(s.status && s.status.online)) $('#src').value = 'local'; $('#today').click(); });
})();
