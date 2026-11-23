(function () {
  const { $, esc, toast } = RJ; const api = window.rojey; const C = window.RojeyCalc;
  let S = {};
  const p = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const hm = (d) => `${p(d.getHours())}:${p(d.getMinutes())}`;
  const okTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const TYPES = { 1: 'Dine In', 2: 'Take Away', 3: 'Delivery' };
  const LABEL = { pending: 'Waiting', synced: 'Uploaded', running: 'Running' };

  async function show() {
    const ft = $('#ft').value.trim() || '00:00'; const tt = $('#tt').value.trim() || '23:59';
    if (!okTime(ft) || !okTime(tt)) return toast('Use 24-hour time like 08:00 or 21:30', 'error');
    const f = { status: $('#st').value || undefined };
    if ($('#fd').value) f.from = $('#fd').value + ' ' + ft + ':00';
    if ($('#td').value) f.to = $('#td').value + ' ' + tt + ':59';
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
  $('#go').onclick = show;
  $('#today').onclick = () => { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(); b.setHours(23, 59, 0, 0); setRange(a, b); };
  $('#last24').onclick = () => setRange(new Date(Date.now() - 86400000), new Date());
  $('#all').onclick = () => setRange(null, null);
  $('#back').onclick = () => api.call('nav', 'pos');
  $('#sync').onclick = async () => { const st = await api.call('sync:now'); toast(st.online ? 'Synced' : 'No internet now. Orders will upload by themselves later.', st.online ? 'success' : 'info'); show(); };
  $('#tbl').onclick = async (e) => { const a = e.target.closest('[data-r]'); if (!a) return; e.preventDefault(); const r = await api.call('pos:reprintReceipt', Number(a.dataset.r)); toast(r.ok === false ? r.error : 'Receipt sent to the printer', r.ok === false ? 'error' : 'success'); };
  api.on('status', (st) => { $('#netline').textContent = (st.online ? 'Online' : 'Offline') + ` · waiting to upload: ${st.pending + (st.legacyPending || 0)} · last upload: ${RJ.fmtTime(st.lastSync)}` + (st.lastError ? ' · last problem: ' + st.lastError : ''); });
  api.call('app:state').then((s) => { S = s.settings || {}; $('#today').click(); });
})();
