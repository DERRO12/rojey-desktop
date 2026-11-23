// Small helpers shared by the screens: escaping, toasts, modals.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, kind = 'success', ms = 2600) {
    let root = $('#rj_toasts');
    if (!root) { root = document.createElement('div'); root.id = 'rj_toasts'; document.body.appendChild(root); }
    const el = document.createElement('div');
    el.className = 'rj-toast rj-toast-' + kind;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.classList.add('rj-hide'); setTimeout(() => el.remove(), 300); }, ms);
  }

  // modal({ title, body (html), buttons: [{ text, cls, onClick(close) }], wide, onOpen(el) })
  function modal({ title, body, buttons = [], wide = false, onOpen, onClose, cls = '' }) {
    let root = $('#rj_modal_root');
    if (!root) { root = document.createElement('div'); root.id = 'rj_modal_root'; document.body.appendChild(root); }
    const wrap = document.createElement('div');
    wrap.className = 'rj-overlay';
    wrap.innerHTML = `<div class="rj-modal ${wide ? 'rj-wide' : ''} ${cls}" role="dialog">
      <div class="rj-modal-head"><h3>${esc(title || '')}</h3><span class="rj-x" title="Close">&times;</span></div>
      <div class="rj-modal-body">${body || ''}</div>
      <div class="rj-modal-foot"></div></div>`;
    const foot = $('.rj-modal-foot', wrap);
    let closed = false;
    const close = () => { if (closed) return; closed = true; wrap.remove(); document.removeEventListener('keydown', onKey, true); if (onClose) onClose(); };
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'rj-btn ' + (b.cls || '');
      el.innerHTML = b.html || esc(b.text);
      if (b.id) el.id = b.id;
      el.addEventListener('click', () => b.onClick ? b.onClick(close, wrap) : close());
      foot.appendChild(el);
    }
    if (!buttons.length) foot.remove();
    $('.rj-x', wrap).addEventListener('click', close);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Enter' && !/TEXTAREA|SELECT/.test(e.target.tagName)) {
        const primary = $('.rj-primary', wrap);
        if (primary && !e.target.closest('button')) { e.preventDefault(); primary.click(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    root.appendChild(wrap);
    if (onOpen) onOpen(wrap, close);
    const first = $('input:not([type=hidden]):not([readonly]), select', wrap);
    if (first) setTimeout(() => first.focus(), 30);
    return { el: wrap, close };
  }

  function confirmBox(title, text, okText = 'Yes') {
    return new Promise((resolve) => {
      modal({ title, body: `<p class="rj-confirm">${esc(text)}</p>`, onClose: () => resolve(false), buttons: [
        { text: 'No', cls: 'rj-grey', onClick: (c) => { c(); } },
        { text: okText, cls: 'rj-primary', onClick: (c) => { resolve(true); c(); } },
      ] });
    });
  }

  function fmtTime(ms) {
    if (!ms) return 'never';
    const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  window.RJ = { $, $$, esc, toast, modal, confirmBox, fmtTime };
  // Ctrl + / Ctrl - / Ctrl 0: say the new screen size
  // a ticket that did not print: always shown, with Retry, until someone closes it
  function printError(e) {
    let box = $('#rj_print_errors');
    if (!box) {
      box = document.createElement('div'); box.id = 'rj_print_errors';
      box.innerHTML = '<div class="rj-pe-head"><i class="fas fa-exclamation-triangle"></i> Printing failed<button type="button" class="rj-pe-close" title="Close all">&times;</button></div><div class="rj-pe-list"></div>';
      document.body.appendChild(box);
      box.addEventListener('click', async (ev) => {
        if (ev.target.closest('.rj-pe-close')) { box.remove(); return; }
        const item = ev.target.closest('.rj-pe-item'); if (!item) return;
        if (ev.target.closest('[data-pe-ok]')) { item.remove(); }
        if (ev.target.closest('[data-pe-retry]')) {
          item.remove();
          const r = await window.rojey.call('print:retry', Number(item.dataset.id));
          if (r && r.ok) toast('Printed'); else if (r && r.error) toast(r.error, 'error', 5000);
        }
        if (!$('.rj-pe-item', box)) box.remove();
      });
    }
    const t = new Date(e.at || Date.now()); const p = (n) => String(n).padStart(2, '0');
    $('.rj-pe-list', box).insertAdjacentHTML('afterbegin', `<div class="rj-pe-item" data-id="${e.id}">
      <div><b>${esc(e.what)}</b> did not print on <b>${esc(e.printer)}</b> (${p(t.getHours())}:${p(t.getMinutes())}).</div>
      <div class="rj-pe-why">${esc(e.reason)}.</div><div>Check that the printer is on, connected and has paper.</div>
      <div class="rj-pe-btns"><button type="button" class="rj-btn rj-primary" data-pe-retry>Print again</button><button type="button" class="rj-btn rj-grey" data-pe-ok>OK</button></div></div>`);
    try { const a = new AudioContext(); const o = a.createOscillator(); o.frequency.value = 660; o.connect(a.destination); o.start(); o.stop(a.currentTime + 0.25); } catch { /* no sound */ }
  }
  if (window.rojey) window.rojey.on('print-error', printError);
  if (window.rojey) window.rojey.on('zoom', (z) => toast('Screen size ' + z.percent + '%  (Ctrl + bigger, Ctrl - smaller, Ctrl 0 normal)', 'info', 1800));
})();
