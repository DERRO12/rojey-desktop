(function () {
  const { $, $$, esc, toast } = RJ; const api = window.rojey;
  let data = null;

  function options(list, value, emptyText) {
    return `<option value="">${esc(emptyText)}</option>` + list.map((p) => `<option value="${esc(p.name)}" ${p.name === value ? 'selected' : ''}>${esc(p.displayName)}${p.isDefault ? ' (Windows default)' : ''}</option>`).join('');
  }

  async function load() {
    data = await api.call('setup:get');
    const c = data.cfg;
    $('#baseUrl').value = c.baseUrl || '';
    $('#receiptPrinter').innerHTML = options(data.printers, c.receiptPrinter, 'Windows default printer');
    $('#kitchenPrinter').innerHTML = options(data.printers, c.kitchenPrinter, 'Same as receipt printer');
    $('#paperWidth').value = c.paperWidth || '80';
    $('#kotCopies').value = c.kotCopies || 1;
    $('#receiptCopies').value = c.receiptCopies || 1;
    $('#autoPrintReceipt').checked = c.autoPrintReceipt !== false;
    $('#keepSyncedDays').value = c.keepSyncedDays != null ? c.keepSyncedDays : 12;
    $('#counterId').value = c.counterId || '';
    $('#autoOpenRegister').checked = c.autoOpenRegister !== false;
    $('#startFullscreen').checked = !!c.startFullscreen;
    $('#taxesOn').checked = !!c.taxesOn;
    $('#autoUpdate').checked = c.autoUpdate !== false;
    api.call('update:state').then((u) => { if (u && u.current) $('#updMsg').textContent = `This is version ${u.current}.` + (u.status === 'ready' ? ` Version ${u.version} is downloaded and ready: install it with the update button at the top of the POS screen.` : ' New versions come from GitHub and download by themselves; an admin installs them with the update button at the top of the POS screen.'); });
    $('#pendingMsg').textContent = data.pending ? data.pending + ' order(s) are waiting to upload. They are kept if you change the address.' : '';
    const ks = data.kitchens || [];
    $('#kitchens').innerHTML = ks.length
      ? ks.map((k) => `<div class="rj-printer-box rj-printer-kitchen">
          <div class="rj-printer-title"><i class="fas ${/caf|coffee/i.test(k.name) ? 'fa-coffee' : /bar|drink/i.test(k.name) ? 'fa-glass-martini' : 'fa-utensils'}"></i> ${esc(k.name)}: kitchen tickets (KOT)</div>
          ${kitchenRows(k, c)}
          <button class="rj-btn rj-blue rj-small" type="button" data-add-k="${k.id}" data-name="${esc(k.name)}"><i class="fas fa-plus"></i> Add another printer for ${esc(k.name)}</button></div>`).join('')
      : '<div class="rj-printer-box"><p class="rj-hint">Your kitchens (Kitchen, Cafe…) appear here with a printer box each after the first sign-in downloads them from the website.</p></div>';
    renderMap();
    $('#back').style.display = c.baseUrl ? '' : 'none';
  }

  // one or more printers per kitchen: the same KOT prints on each
  function kitchenRow(k, value, n) {
    return `<div class="rj-row rj-krow" data-krow="${k.id}"><label class="rj-field" style="flex:1">${esc(k.name)} printer${n ? ' ' + (n + 1) : ''} <select data-kitchen="${k.id}">${options(data.printers, value, n ? 'None' : 'Use the default KOT printer below')}</select></label>
      <button class="rj-btn rj-grey" type="button" data-test-k="${k.id}" data-test-name="${esc(k.name)}">Test print</button>${n ? '<button class="rj-btn rj-red rj-small" type="button" data-del-k title="Remove this printer"><i class="fas fa-times"></i></button>' : ''}</div>`;
  }
  function kitchenRows(k, c) {
    const v = (c.kitchenPrinters || {})[String(k.id)];
    const list = Array.isArray(v) ? v : [v || ''];
    return list.map((x, i) => kitchenRow(k, x, i)).join('');
  }
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-k]');
    if (add) { const k = { id: add.dataset.addK, name: add.dataset.name }; add.insertAdjacentHTML('beforebegin', kitchenRow(k, '', $$(`[data-krow="${k.id}"]`).length)); renderMap(); return; }
    const del = e.target.closest('[data-del-k]');
    if (del) { del.closest('.rj-krow').remove(); renderMap(); }
  });

  // where each kind of ticket will print, in plain words
  function renderMap() {
    if (!data) return;
    const name = (v, dflt) => esc(v || dflt);
    const rec = $('#receiptPrinter').value; const kot = $('#kitchenPrinter').value;
    const rows = [`<li><b>Receipts and bills</b> print on <b>${name(rec, 'the Windows default printer')}</b></li>`];
    for (const k of data.kitchens || []) {
      const picked = $$(`[data-kitchen="${k.id}"]`).map((x) => x.value).filter(Boolean);
      const where = picked.length ? picked.map((x) => esc(x)).join('</b> and <b>') : name(kot || rec, 'the Windows default printer');
      rows.push(`<li><b>${esc(k.name)}</b> KOT prints on <b>${where}</b></li>`);
    }
    $('#printMap').innerHTML = '<div class="rj-printer-title">Where things print</div><ul>' + rows.join('') + '</ul>';
  }
  document.addEventListener('change', (e) => { if (e.target.matches('select')) renderMap(); });

  function collect() {
    const kp = {};
    $$('[data-kitchen]').forEach((s) => { if (!s.value) return; const id = s.dataset.kitchen; kp[id] = kp[id] ? [].concat(kp[id], s.value) : s.value; });
    return {
      baseUrl: $('#baseUrl').value.trim(), receiptPrinter: $('#receiptPrinter').value, kitchenPrinter: $('#kitchenPrinter').value, kitchenPrinters: kp,
      paperWidth: $('#paperWidth').value, kotCopies: Math.max(1, Number($('#kotCopies').value) || 1), receiptCopies: Math.max(1, Number($('#receiptCopies').value) || 1),
      autoPrintReceipt: $('#autoPrintReceipt').checked, keepSyncedDays: Number($('#keepSyncedDays').value), counterId: $('#counterId').value.trim(),
      autoOpenRegister: $('#autoOpenRegister').checked, startFullscreen: $('#startFullscreen').checked, taxesOn: $('#taxesOn').checked, autoUpdate: $('#autoUpdate').checked,
    };
  }

  $('#check').onclick = async () => {
    $('#siteMsg').textContent = 'Checking…'; $('#siteMsg').className = 'rj-hint';
    const r = await api.call('setup:test-site', $('#baseUrl').value);
    $('#siteMsg').textContent = r.ok ? 'Found it: ' + r.baseUrl : r.error;
    $('#siteMsg').className = 'rj-hint ' + (r.ok ? 'rj-ok' : 'rj-bad');
    if (r.ok) $('#baseUrl').value = r.baseUrl;
  };
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-test],[data-test-k]'); if (!t) return;
    const name = t.dataset.test ? $('#' + t.dataset.test).value : ($('[data-kitchen]', t.closest('.rj-krow')).value || $('#kitchenPrinter').value);
    await api.call('setup:test-print', name, t.dataset.test === 'receiptPrinter' ? 'Cashier receipt printer' : t.dataset.test ? 'Default KOT printer' : (t.dataset.testName || 'Kitchen') + ' KOT printer');
    toast('Test sent to ' + (name || 'the Windows default printer'));
  });
  $('#save').onclick = async () => {
    const cfg = collect();
    if (!cfg.baseUrl) return toast('Type the website address first', 'error');
    const r = await api.call('setup:save', cfg);
    if (r.ok === false) return toast(r.error, 'error', 5000);
    toast('Saved');
    setTimeout(() => api.call('setup:done'), 400);
  };
  $('#back').onclick = () => api.call('setup:done');
  $('#logs').onclick = (e) => { e.preventDefault(); api.call('app:logs'); };
  load();
})();
