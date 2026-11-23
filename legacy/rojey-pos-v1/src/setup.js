(async function () {
  const $ = (id) => document.getElementById(id);
  const { cfg, version } = await window.setup.get();
  let printers = [];
  let checkedBase = cfg.baseUrl || '';

  $('ver').textContent = 'Version ' + version;
  $('site').value = cfg.baseUrl ? cfg.baseUrl.replace(/^https:\/\//, '').replace(/\/$/, '') : '';
  $('autoPrint').checked = cfg.autoPrint !== false;
  $('rememberLogin').checked = cfg.rememberLogin !== false;
  $('startFullscreen').checked = !!cfg.startFullscreen;
  $('oneTapKot').checked = cfg.oneTapKot !== false;
  $('kotItems').value = cfg.kotItems === 'all' ? 'all' : 'new';

  function fill(select, value) {
    select.innerHTML = '';
    const ask = document.createElement('option');
    ask.value = ''; ask.textContent = 'Ask every time (show print window)';
    select.appendChild(ask);
    for (const p of printers) {
      const o = document.createElement('option');
      o.value = p.name; o.textContent = p.displayName + (p.isDefault ? '  (default)' : '');
      select.appendChild(o);
    }
    if (value && !printers.some((p) => p.name === value)) {
      const o = document.createElement('option');
      o.value = value; o.textContent = value + '  (not found now)';
      select.appendChild(o);
    }
    select.value = value || '';
  }

  function addKitchenRow(name, printer) {
    const row = document.createElement('div');
    row.className = 'kitchen-row';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.placeholder = 'Kitchen name, e.g. Bar'; inp.value = name || '';
    const sel = document.createElement('select');
    fill(sel, printer || '');
    const del = document.createElement('button');
    del.textContent = 'Remove';
    del.onclick = () => row.remove();
    row.append(inp, sel, del);
    $('kitchens').appendChild(row);
  }

  try { printers = await window.setup.printers(); } catch (e) { printers = []; }
  fill($('receipt'), cfg.receiptPrinter);
  fill($('kitchen'), cfg.kitchenPrinter);
  for (const [n, p] of Object.entries(cfg.kitchenPrinters || {})) addKitchenRow(n, p);
  $('addKitchen').onclick = () => addKitchenRow('', '');

  function msg(el, text, ok) {
    el.textContent = text;
    el.className = 'msg ' + (ok === true ? 'ok' : ok === false ? 'bad' : '');
  }

  async function checkSite() {
    const v = $('site').value.trim();
    if (!v) { msg($('siteMsg'), 'Type your POS website first.', false); return null; }
    $('testSite').disabled = true;
    msg($('siteMsg'), 'Checking…');
    const r = await window.setup.testSite(v);
    $('testSite').disabled = false;
    msg($('siteMsg'), r.ok ? r.message + ' (' + r.baseUrl + ')' : r.message, r.ok);
    if (r.ok) checkedBase = r.baseUrl;
    return r;
  }
  $('testSite').onclick = checkSite;

  for (const b of document.querySelectorAll('[data-test]')) {
    b.onclick = async () => {
      const which = b.getAttribute('data-test');
      const printer = $(which).value;
      if (!printer) { msg($('printMsg'), 'Pick a printer first.', false); return; }
      msg($('printMsg'), 'Sending a test page to ' + printer + '…');
      const r = await window.setup.testPrint(printer, which === 'receipt' ? 'receipt printer' : 'kitchen printer');
      msg($('printMsg'), r.ok ? 'Test page sent to ' + printer + '.' : 'Printing failed: ' + (r.reason || 'unknown'), r.ok);
    };
  }

  $('save').onclick = async () => {
    const typed = $('site').value.trim();
    let baseUrl = checkedBase;
    const typedNorm = typed.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const checkedNorm = (checkedBase || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!typed) { msg($('siteMsg'), 'Type your POS website first.', false); return; }
    if (typedNorm !== checkedNorm) {
      const r = await checkSite();
      if (!r || !r.ok) {
        if (!confirm('The website could not be reached right now. Save it anyway?')) return;
        baseUrl = /^https?:\/\//i.test(typed) ? typed : 'https://' + typed;
        if (!baseUrl.endsWith('/')) baseUrl += '/';
      } else baseUrl = r.baseUrl;
    }
    if (cfg.baseUrl && baseUrl !== cfg.baseUrl) {
      const n = await window.setup.pending();
      if (n > 0 && !confirm(n + ' order(s) from the old website have not uploaded yet. If you switch now they stay on this computer and will not upload to the new website. Switch anyway?')) return;
    }
    const kitchenPrinters = {};
    for (const row of document.querySelectorAll('.kitchen-row')) {
      const name = row.querySelector('input').value.trim();
      const p = row.querySelector('select').value;
      if (name && p) kitchenPrinters[name] = p;
    }
    $('save').disabled = true;
    await window.setup.save({
      baseUrl,
      receiptPrinter: $('receipt').value,
      kitchenPrinter: $('kitchen').value,
      kitchenPrinters,
      autoPrint: $('autoPrint').checked,
      rememberLogin: $('rememberLogin').checked,
      startFullscreen: $('startFullscreen').checked,
      oneTapKot: $('oneTapKot').checked,
      kotItems: $('kotItems').value,
    });
  };
})();
