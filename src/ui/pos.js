// The till screen. Everything here works without internet: it reads and writes the local database
// through the main process, which uploads to the website by itself.
(function () {
  const { $, $$, esc, toast, modal, confirmBox } = window.RJ;
  const api = window.rojey;
  const C = window.RojeyCalc;

  let cat = null; let S = {}; let user = null;
  let itemsById = new Map(); let modsByItem = new Map(); let modsById = new Map(); let childrenOf = new Map();
  let kitchenName = new Map();
  let running = []; let selectedRunning = null;
  let filter = { category: 'all', text: '', veg: false, bev: false };
  let lineSeq = 1;

  const blankOrder = () => ({
    saleId: null, saleNo: '', orderType: Number(S.defaultOrderType) || 1, tableId: null, tableName: '', persons: 1,
    customerId: S.defaultCustomer || '', customerName: '', waiterId: (user && user.perms && user.perms.waiter) ? user.userId : (S.defaultWaiter || ''), waiterName: '',
    lines: [], discount: '', charge: '', tips: '',
  });
  let order = null;

  const P = () => (user && user.perms) || {};
  // same rule as the website: an action the role does not have is refused with a message
  function allowed(flag) {
    if (P()[flag] === false) { toast(P().waiter ? 'This action is not allowed for waiter accounts.' : 'You are not allowed to do this. An admin can give your role this permission on the website.', 'error', 4000); return false; }
    return true;
  }
  const money = (v) => C.money(v, S);
  const fx = (v) => C.num(v).toFixed(Number(S.precision != null ? S.precision : 2));

  // ------------------------------------------------------------------ load
  async function loadCatalog() {
    const r = await api.call('pos:catalog');
    if (r && r.ok === false) { toast(r.error, 'error'); if (/signed in/i.test(r.error)) api.call('nav', 'home'); return; }
    cat = r; S = r.settings || {}; user = r.user;
    itemsById = new Map(cat.items.map((i) => [i.id, i]));
    modsById = new Map(cat.modifiers.map((m) => [m.id, m]));
    modsByItem = new Map();
    for (const im of cat.itemModifiers) {
      const m = modsById.get(im.modifier_id); if (!m) continue;
      if (!modsByItem.has(im.food_menu_id)) modsByItem.set(im.food_menu_id, []);
      if (!modsByItem.get(im.food_menu_id).some((x) => x.id === m.id)) modsByItem.get(im.food_menu_id).push(m);
    }
    childrenOf = new Map();
    for (const i of cat.items) if (i.parent_id) { if (!childrenOf.has(i.parent_id)) childrenOf.set(i.parent_id, []); childrenOf.get(i.parent_id).push(i); }
    kitchenName = new Map(cat.kitchens.map((k) => [k.id, k.name]));
    $('#rj_outlet').textContent = [S.outletName, user && user.name].filter(Boolean).join(' · ');
    document.body.classList.toggle('rj-is-admin', !!(user && user.isAdmin));
    applyPerms();
    fillSelects();
    renderCategories();
    renderItems();
  }

  // what the signed-in person may do (from their role on the website)
  function applyPerms() {
    const p = P();
    document.body.classList.toggle('rj-waiter', !!p.waiter);
    const hide = (sel, on) => $$(sel).forEach((e) => { e.style.display = on ? 'none' : ''; });
    // waiters: like the website, payment, printing and cancelling are hidden
    hide('#direct_invoice, #rj_bill_now, #rj_kot, #create_invoice_and_close, #create_bill_and_close, #cancel_order_button, #print_last_invoice', !!p.waiter);
    hide('.main_top .selected__btn_c', p.orderType === false);
    hide('#rj_order_options', p.discount === false && p.charge === false && p.tips === false);
    $('#select_waiter').disabled = p.chooseWaiter === false;
    if ($('#rj_waiter_pick')) waiterPicker();
  }

  function fillSelects() {
    const w = $('#select_waiter');
    w.innerHTML = '<option value="">Waiter</option>' + cat.waiters.map((x) => `<option value="${x.id}">${esc(x.full_name)}</option>`).join('');
    waiterPicker();
    customerPicker();
    const c = $('#walk_in_customer');
    c.innerHTML = cat.customers.map((x) => `<option value="${x.id}">${esc(x.name)}${x.phone ? ' ' + esc(x.phone) : ''}</option>`).join('') || '<option value="1">Walk-in Customer</option>';
    syncOrderToControls();
  }

  // ------------------------------------------------------------------ menu
  function renderCategories() {
    const ul = $('#rj_categories');
    ul.innerHTML = `<li><a href="#" class="button_category_show_all1 ${filter.category === 'all' ? 'rj-active' : ''}" data-cat="all">All</a></li>` +
      cat.categories.map((c) => `<li><a href="#" class="category_button ${String(filter.category) === String(c.id) ? 'rj-active' : ''}" data-cat="${c.id}">${esc(c.category_name)}</a></li>`).join('');
  }

  function priceFor(it, type = order.orderType) {
    if (type === 2) return it.sale_price_take_away || it.sale_price;
    if (type === 3) return it.sale_price_delivery || it.sale_price;
    return it.sale_price;
  }

  function imgFor(it) { return it.local_image || it.photo || 'web/images/image_thumb.png'; }

  function renderItems() {
    const q = filter.text.trim().toLowerCase();
    const catName = new Map(cat.categories.map((c) => [c.id, c.category_name]));
    const list = cat.items.filter((it) => {
      if (it.parent_id) return false;
      if (filter.category !== 'all' && String(it.category_id) !== String(filter.category)) return false;
      if (filter.veg && !/yes/i.test(it.veg_item || '')) return false;
      if (filter.bev && !/yes/i.test(it.beverage_item || '')) return false;
      if (q) {
        const hay = [it.name, it.code, it.alternative_name, catName.get(it.category_id), /yes/i.test(it.veg_item || '') ? 'veg' : '', /yes/i.test(it.beverage_item || '') ? 'bev beverage' : '', it.kitchen_name].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const html = list.map((it) => `<div class="single_item" data-id="${it.id}" id="item_${it.id}">
        <img src="${esc(imgFor(it))}" alt="" width="142" loading="lazy">
        <p class="item_name">${esc(it.name)}</p>
        <p class="item_price">Price: <span>${fx(priceFor(it))}</span></p></div>`).join('');
    $('#rj_items').innerHTML = `<div class="specific_category_items_holder rj-show">${html || '<p class="rj-empty">No items</p>'}</div>`;
  }

  // ------------------------------------------------------------------ cart
  function addItem(it, mods = [], note = '') {
    const key = (l) => l.food_menu_id + '|' + l.modifiers.map((m) => m.id).sort().join(',') + '|' + (l.menu_note || '');
    const nl = { key: 'n' + lineSeq++, id: null, food_menu_id: it.id, menu_name: it.name, qty: 1, menu_unit_price: priceFor(it),
      modifiers: mods.map((m) => ({ id: m.id, name: m.name, price: Number(m.price) || 0 })), discount: '', menu_note: note, kot_qty: 0,
      kitchen_id: it.kitchen_id, tax_information: it.tax_information };
    const same = order.lines.find((l) => key(l) === key(nl));
    if (same) same.qty += 1; else order.lines.push(nl);
    renderCart(same ? same.key : nl.key);
  }

  function clickItem(id) {
    const it = itemsById.get(id); if (!it) return;
    const kids = childrenOf.get(id) || [];
    if (kids.length) return chooseVariation(it, kids);
    const mods = modsByItem.get(id) || [];
    if (mods.length) return chooseModifiers(it, mods);
    addItem(it);
  }

  function chooseVariation(parent, kids) {
    const m = modal({ title: parent.name, wide: true, body: `<div class="rj-grid">${kids.map((k) => `<button class="rj-tile" data-id="${k.id}"><b>${esc(k.name)}</b><span>${fx(priceFor(k))}</span></button>`).join('')}</div>` });
    $$('.rj-tile', m.el).forEach((b) => b.addEventListener('click', () => {
      m.close();
      const k = itemsById.get(Number(b.dataset.id));
      const mods = modsByItem.get(k.id) || modsByItem.get(parent.id) || [];
      if (mods.length) chooseModifiers(k, mods); else addItem(k);
    }));
  }

  function chooseModifiers(it, mods, line) {
    const chosen = new Set(line ? line.modifiers.map((x) => x.id) : []);
    modal({
      title: it.name + ' - Modifiers',
      body: `<div class="rj-grid">${mods.map((m) => `<label class="rj-tile rj-check"><input type="checkbox" value="${m.id}" ${chosen.has(m.id) ? 'checked' : ''}> <b>${esc(m.name)}</b><span>${fx(m.price)}</span></label>`).join('')}</div>
        <label class="rj-field">Note <input type="text" id="rj_mod_note" value="${esc(line ? line.menu_note : '')}" maxlength="150"></label>`,
      buttons: [
        { text: 'Cancel', cls: 'rj-grey' },
        { text: line ? 'Update' : 'Add to cart', cls: 'rj-primary', onClick: (close, el) => {
          const picked = $$('input[type=checkbox]:checked', el).map((x) => modsById.get(Number(x.value))).filter(Boolean);
          const note = $('#rj_mod_note', el).value.trim();
          if (line) { line.modifiers = picked.map((m) => ({ id: m.id, name: m.name, price: Number(m.price) || 0 })); line.menu_note = note; renderCart(line.key); } else addItem(it, picked, note);
          close();
        } },
      ],
    });
  }

  function editLine(line) {
    const it = itemsById.get(line.food_menu_id);
    const mods = modsByItem.get(line.food_menu_id) || (it && it.parent_id ? modsByItem.get(it.parent_id) : null) || [];
    modal({
      title: line.menu_name,
      body: `<div class="rj-form">
        <label class="rj-field">Quantity <input type="number" id="rj_e_qty" min="0" step="1" value="${line.qty}"></label>
        <label class="rj-field" ${P().discount === false ? 'style="display:none"' : ''}>Discount (amount, or % like 10%) <input type="text" id="rj_e_disc" value="${esc(line.discount)}"></label>
        <label class="rj-field">Note for the kitchen <input type="text" id="rj_e_note" maxlength="150" value="${esc(line.menu_note)}"></label>
        ${mods.length ? `<div class="rj-field">Modifiers<div class="rj-grid">${mods.map((m) => `<label class="rj-tile rj-check"><input type="checkbox" value="${m.id}" ${line.modifiers.some((x) => x.id === m.id) ? 'checked' : ''}> <b>${esc(m.name)}</b><span>${fx(m.price)}</span></label>`).join('')}</div></div>` : ''}
        ${line.kot_qty ? `<p class="rj-muted">${line.kot_qty} already sent to the kitchen.</p>` : ''}</div>`,
      buttons: [
        { text: 'Remove item', cls: 'rj-red', onClick: (c) => { if (order.saleId && line.kot_qty && P().removeSent === false && !allowed('removeSent')) return; removeLine(line.key); c(); } },
        { text: 'Cancel', cls: 'rj-grey' },
        { text: 'Update', cls: 'rj-primary', onClick: (c, el) => {
          const nq = Math.max(0, Math.floor(C.num($('#rj_e_qty', el).value)));
          if (order.saleId && line.kot_qty && nq < line.kot_qty && P().removeSent === false && !allowed('removeSent')) return;
          line.qty = nq;
          line.discount = $('#rj_e_disc', el).value.trim();
          line.menu_note = $('#rj_e_note', el).value.trim();
          if (mods.length) line.modifiers = $$('input[type=checkbox]:checked', el).map((x) => modsById.get(Number(x.value))).filter(Boolean).map((m) => ({ id: m.id, name: m.name, price: Number(m.price) || 0 }));
          if (!line.qty) removeLine(line.key); else renderCart(line.key);
          c();
        } },
      ],
    });
  }

  function removeLine(key) { order.lines = order.lines.filter((l) => l.key !== key); renderCart(); }

  function totals() { return C.totals({ lines: order.lines, discount: order.discount, charge: order.charge, tips: order.tips }, S); }

  function renderCart(focusKey) {
    const t = totals();
    const rows = order.lines.map((l, i) => {
      const lt = t.lines[i];
      const unit = C.num(l.menu_unit_price) + l.modifiers.reduce((a, m) => a + C.num(m.price), 0);
      return `<div class="single_order ${l.key === focusKey ? 'rj-flash' : ''}" data-key="${l.key}">
        <div class="first_portion">
          <div class="single_order_column first_column cart_item_counter fix"><i class="fas fa-pencil-alt edit_item txt_5" data-act="edit"></i> <span>${esc(l.menu_name)}</span>${l.kot_qty ? ' <i class="fas fa-check-circle rj-sent" title="Sent to kitchen: ' + l.kot_qty + '"></i>' : ''}</div>
          <div class="single_order_column second_column fix">${fx(unit)}</div>
          <div class="single_order_column third_column fix"><i class="fal fa-minus decrease_item_table txt_5" data-act="dec"></i> <span class="qty_item_custom">${l.qty}</span> <i class="fal fa-plus increase_item_table txt_5" data-act="inc"></i></div>
          <div class="single_order_column forth_column fix">${P().discount === false ? esc(l.discount || '') : `<input type="text" placeholder="Amt or %" class="discount_cart_input" data-act="disc" value="${esc(l.discount)}">`}</div>
          <div class="single_order_column fifth_column">${fx(lt.menu_price_with_discount)} <i class="fal fa-times removeCartItem" data-act="del"></i></div>
        </div>
        ${l.modifiers.length ? `<div class="second_portion fix"><span class="modifier_txt_custom">Modifiers: ${l.modifiers.map((m) => esc(m.name)).join(', ')}</span></div>` : ''}
        ${l.menu_note ? `<div class="third_portion fix"><span class="rj-note">Note: ${esc(l.menu_note)}</span></div>` : ''}
      </div>`;
    }).join('');
    const holder = $('#rj_cart');
    holder.innerHTML = rows;
    holder.classList.toggle('cardIsEmpty', !order.lines.length);
    $('#total_payable').textContent = money(t.payable);
    $('#rj_summary').innerHTML = `<span>Items: <b>${t.items}</b> (${t.qtyTotal})</span>
      <span>Sub Total: <b>${fx(t.subTotal)}</b></span>
      <span class="rj-link" data-act="options">Discount: <b>${fx(t.totalDiscount)}</b></span>
      ${S.collectTax === 'Yes' ? `<span>Tax: <b>${fx(t.vat)}</b>${t.vat && !t.vatAdded ? ' (incl.)' : ''}</span>` : ''}
      <span class="rj-link" data-act="options">Charge: <b>${fx(t.charge)}</b></span>
      ${t.tips ? `<span>Tips: <b>${fx(t.tips)}</b></span>` : ''}`;
    $('#place_edit_order').textContent = order.saleId ? 'Update Order' : 'Place Order';
    if (focusKey) { const el = holder.querySelector(`[data-key="${focusKey}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }
  }

  // waiter: a box you can type in to find the waiter (the select underneath keeps the value)
  function waiterPicker() {
    const sel = $('#select_waiter');
    let btn = $('#rj_waiter_pick');
    if (!btn) {
      sel.insertAdjacentHTML('afterend', '<button type="button" id="rj_waiter_pick" class="rj-waiter-pick"><i class="fal fa-user"></i> <span>Waiter</span> <i class="fas fa-caret-down"></i></button>');
      sel.style.display = 'none';
      btn = $('#rj_waiter_pick');
      btn.addEventListener('click', openWaiterList);
    }
    const o = sel.options[sel.selectedIndex];
    $('span', btn).textContent = sel.value && o ? o.text : 'Choose waiter';
    btn.classList.toggle('rj-empty-pick', !sel.value);
    btn.disabled = sel.disabled;
  }
  function openWaiterList() {
    const sel = $('#select_waiter'); if (sel.disabled) return;
    const old = $('#rj_waiter_list'); if (old) { old.remove(); return; }
    const btn = $('#rj_waiter_pick'); const box = btn.getBoundingClientRect();
    const pop = document.createElement('div'); pop.id = 'rj_waiter_list'; pop.className = 'rj-waiter-list';
    pop.style.left = box.left + 'px'; pop.style.top = (box.bottom + 2) + 'px'; pop.style.width = Math.max(box.width, 240) + 'px';
    pop.innerHTML = '<input type="search" placeholder="Type a waiter name" autocomplete="off"><div class="rj-wl-items"></div>';
    document.body.appendChild(pop);
    const input = $('input', pop); const list = $('.rj-wl-items', pop);
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const ws = cat.waiters.filter((x) => !q || String(x.full_name).toLowerCase().includes(q));
      list.innerHTML = ws.map((x) => `<div class="rj-wl-item ${String(x.id) === sel.value ? 'rj-on' : ''}" data-id="${x.id}">${esc(x.full_name)}</div>`).join('') || '<div class="rj-wl-none">No waiter with that name</div>';
    };
    const pick = (id) => { sel.value = String(id); readControls(); waiterPicker(); close(); };
    const close = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); };
    const outside = (e) => { if (!pop.contains(e.target) && !btn.contains(e.target)) close(); };
    list.addEventListener('click', (e) => { const it = e.target.closest('[data-id]'); if (it) pick(it.dataset.id); });
    input.addEventListener('input', draw);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') { const first = $('[data-id]', list); if (first) pick(first.dataset.id); }
    });
    document.addEventListener('mousedown', outside, true);
    draw(); input.focus();
  }

  // customer: search by name or phone, add a new one, edit one (website permissions Add/Edit Customer)
  const isWalkIn = (id) => { const c = (cat.customers || []).find((x) => String(x.id) === String(id)); return !id || String(id) === '1' || (c && /walk/i.test(c.name)); };
  function customerPicker() {
    const sel = $('#walk_in_customer');
    let btn = $('#rj_customer_pick');
    if (!btn) {
      sel.insertAdjacentHTML('afterend', '<button type="button" id="rj_customer_pick" class="rj-waiter-pick rj-customer-pick"><i class="fal fa-user-friends"></i> <span>Customer</span> <i class="fas fa-caret-down"></i></button>');
      sel.style.display = 'none';
      btn = $('#rj_customer_pick');
      btn.addEventListener('click', openCustomerList);
    }
    const c = (cat.customers || []).find((x) => String(x.id) === sel.value);
    $('span', btn).textContent = c ? c.name + (c.phone ? ' · ' + c.phone : '') : 'Walk-in Customer';
  }
  function openCustomerList() {
    const sel = $('#walk_in_customer');
    const old = $('#rj_customer_list'); if (old) { old.remove(); return; }
    const btn = $('#rj_customer_pick'); const box = btn.getBoundingClientRect();
    const pop = document.createElement('div'); pop.id = 'rj_customer_list'; pop.className = 'rj-waiter-list';
    pop.style.left = box.left + 'px'; pop.style.top = (box.bottom + 2) + 'px'; pop.style.width = Math.max(box.width, 300) + 'px';
    pop.innerHTML = `<div class="rj-cl-top"><input type="search" placeholder="Name or phone number" autocomplete="off">${P().addCustomer === false ? '' : '<button type="button" class="rj-btn rj-green rj-small" data-new><i class="fas fa-plus"></i> New</button>'}</div><div class="rj-wl-items"></div>`;
    document.body.appendChild(pop);
    const input = $('input', pop); const list = $('.rj-wl-items', pop);
    const draw = () => {
      const q = input.value.trim().toLowerCase(); const qd = q.replace(/\D/g, '');
      const cs = (cat.customers || []).filter((x) => !q || String(x.name || '').toLowerCase().includes(q) || (qd && String(x.phone || '').replace(/\D/g, '').includes(qd))).slice(0, 200);
      list.innerHTML = cs.map((x) => `<div class="rj-wl-item ${String(x.id) === sel.value ? 'rj-on' : ''}" data-id="${x.id}"><span>${esc(x.name)}${x.phone ? ' <small class="rj-muted">' + esc(x.phone) + '</small>' : ''}${x.rj_pending ? ' <small class="rj-muted">(saving)</small>' : ''}</span>${P().editCustomer === false || isWalkIn(x.id) ? '' : `<i class="fal fa-pencil rj-cl-edit" data-edit="${x.id}" title="Edit"></i>`}</div>`).join('')
        || `<div class="rj-wl-none">No customer found${P().addCustomer === false ? '' : '. Press New to add one.'}</div>`;
    };
    const close = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); };
    const outside = (e) => { if (!pop.contains(e.target) && !btn.contains(e.target)) close(); };
    const pick = (id) => { sel.value = String(id); readControls(); customerPicker(); close(); };
    pop.addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit]'); if (ed) { close(); return customerModal((cat.customers || []).find((x) => String(x.id) === ed.dataset.edit)); }
      if (e.target.closest('[data-new]')) { close(); return customerModal(null, input.value.trim()); }
      const it = e.target.closest('[data-id]'); if (it) pick(it.dataset.id);
    });
    input.addEventListener('input', draw);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter') { const f = $('[data-id]', list); if (f) pick(f.dataset.id); } });
    document.addEventListener('mousedown', outside, true);
    draw(); input.focus();
  }
  function customerModal(c, typed) {
    if (!allowed(c ? 'editCustomer' : 'addCustomer')) return;
    const digits = typed && /^[\d +]+$/.test(typed);
    modal({ title: c ? 'Edit customer' : 'Add customer', body: `
      <label class="rj-field">Name <input type="text" id="rj_c_name" value="${esc(c ? c.name : (digits ? '' : typed || ''))}"></label>
      <label class="rj-field">Phone <input type="tel" id="rj_c_phone" value="${esc(c ? c.phone || '' : (digits ? typed : ''))}"></label>
      <label class="rj-field">Email <input type="email" id="rj_c_email" value="${esc(c ? c.email || '' : '')}"></label>
      <label class="rj-field">Delivery address <textarea id="rj_c_addr" rows="2">${esc(c ? c.address || '' : '')}</textarea></label>
      <p class="rj-hint">Saved on this computer at once, and on the website as soon as there is internet.</p>`,
    buttons: [{ text: 'Cancel', cls: 'rj-grey' }, { text: 'Save', cls: 'rj-primary', id: 'rj_c_save', onClick: async (close, el) => {
      const data = { id: c ? c.id : null, name: $('#rj_c_name', el).value, phone: $('#rj_c_phone', el).value, email: $('#rj_c_email', el).value, address: $('#rj_c_addr', el).value };
      if (!data.name.trim()) return toast('Type the customer name', 'error');
      const r = await api.call('pos:customerSave', data);
      if (!r || r.ok === false) return toast((r && r.error) || 'Could not save', 'error', 5000);
      close();
      await loadCatalog();
      $('#walk_in_customer').value = String(r.customer.id);
      if (!$('#walk_in_customer').value) { $('#walk_in_customer').insertAdjacentHTML('beforeend', `<option value="${r.customer.id}">${esc(r.customer.name)}</option>`); $('#walk_in_customer').value = String(r.customer.id); }
      readControls(); customerPicker();
      toast('Customer ' + r.customer.name + ' saved');
    } }] });
  }

  function syncOrderToControls() {
    $$('.main_top .selected__btn_c').forEach((b) => b.setAttribute('data-selected', Number(b.dataset.type) === order.orderType ? 'selected' : 'unselected'));
    $('#rj_table_btn span').textContent = order.tableName ? 'Table: ' + order.tableName : 'Table';
    $('#rj_table_btn').classList.toggle('red_text', !!order.tableName);
    $('#select_waiter').value = order.waiterId ? String(order.waiterId) : '';
    if (order.waiterId && !$('#select_waiter').value && order.waiterName) { $('#select_waiter').insertAdjacentHTML('beforeend', `<option value="${Number(order.waiterId)}">${esc(order.waiterName)}</option>`); $('#select_waiter').value = String(order.waiterId); }
    if ($('#rj_waiter_pick')) waiterPicker();
    if ($('#rj_customer_pick')) customerPicker();
    const c = $('#walk_in_customer');
    if (order.customerId && [...c.options].some((o) => o.value === String(order.customerId))) c.value = String(order.customerId);
    else if (c.options.length) { const walk = [...c.options].find((o) => /walk/i.test(o.text)); c.value = walk ? walk.value : c.options[0].value; }
  }

  function readControls() {
    const w = $('#select_waiter'); const c = $('#walk_in_customer');
    order.waiterId = w.value ? Number(w.value) : null;
    order.waiterName = w.value ? w.options[w.selectedIndex].text : '';
    order.customerId = c.value || 1;
    order.customerName = c.value ? (cat.customers.find((x) => String(x.id) === c.value) || {}).name || c.options[c.selectedIndex].text : 'Walk-in Customer';
  }

  function setOrderType(t) {
    order.orderType = t;
    for (const l of order.lines) { const it = itemsById.get(l.food_menu_id); if (it) l.menu_unit_price = priceFor(it, t); }
    syncOrderToControls(); renderItems(); renderCart();
  }

  function newOrder() { order = blankOrder(); syncOrderToControls(); renderCart(); }

  // ------------------------------------------------------------------ tables (the website's table screen)
  let tableView = null;   // { render() } while the table screen is open
  function tableFallback(areaId) {
    const ts = cat.tables.filter((t) => !cat.areas.length || Number(t.area) === Number(areaId));
    return ts.map((t) => `<div class="div_rectangular area_all_table"><div class="div_box"><h5 class="trigger_to_select_other get_table_details" data-id="${t.id}" data-hidden_table_capacity="${esc(t.sit_capacity || '')}" data-booked_id="" data-order_number="" data-name="${esc(t.name)}">${esc(t.name)}</h5></div></div>`).join('');
  }
  function ordersOnTable(id, name) {
    return running.filter((r) => (r.table_id && Number(r.table_id) === Number(id)) || String(r.orders_table_text || '').split(',').map((x) => x.trim()).includes(String(name)));
  }

  function chooseTable() {
    const areas = cat.areas.length ? cat.areas : [{ id: 0, area_name: 'Tables', table_design_content: '' }];
    const p = P();
    let areaId = areas[0].id; let picked = null; let pickedTable = null;
    const overlay = document.createElement('div'); overlay.className = 'pos__modal__overlay rj-table-overlay';
    const box = document.createElement('div'); box.id = 'show_tables_modal2'; box.className = 'modal rj-open';
    const qa = (act, icon, text, show) => (show === false ? '' : `<tr><td><button data-act="${act}" class="set_quick_action"><i class="fas ${icon}"></i> ${text}</button></td></tr>`);
    box.innerHTML = `<div class="modal-content" id="modal_content_show_tables2">
      <h1 class="ir_pos_relative">Tables <a href="#" class="alertCloseIcon" id="table_modal_cancel_button2"><i class="fal fa-times"></i></a></h1>
      <div class="select_table_modal_info_holder2">
        <div class="table-category-list bg-white pos_p_10">
          <h4 class="bg-white text-center pos_mb_10"><b>Area</b></h4>
          <ul class="dineIn-table-list-of-item">${areas.map((a) => `<li><a class="get_area_table" data-id="${a.id}" href="#">${esc(a.area_name)}</a></li>`).join('')}</ul>
          <p>&nbsp;</p>
          <table class="ir-width-100">${qa('invoice', 'fa-file-invoice', 'Invoice', p.invoice)}${qa('modify', 'fa-edit', 'Modify Order', p.modifyOrder)}${qa('bill', 'fa-file-invoice', 'Bill', p.bill)}${qa('cancel', 'fa-times', 'Cancel Order', p.cancelOrder)}</table>
          <div class="rj-table-info" id="rj_table_info"></div>
        </div>
        <div class="width_86"><div class="all-dineIn-table bg-white pos_ml_10 table_bg ${esc(S.tableBg || '')}" id="rj_floor"></div></div>
      </div>
      <div class="bottom_button_holder_table_modal">
        <div class="left half"><button class="floatright reset_table" id="reset_table"><i class="fa fa-refresh"></i> Reset Table</button></div>
        <div class="right half"><button class="floatright bg_pos_cancel" id="table_modal_cancel_button">Cancel</button></div>
      </div></div>`;
    document.body.append(overlay, box);
    const floor = $('#rj_floor', box);
    const close = () => { overlay.remove(); box.remove(); tableView = null; document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);

    function info() {
      const el = $('#rj_table_info', box);
      if (!picked) { el.innerHTML = order.tableName ? `Cart table: <b>${esc(order.tableName)}</b>` : 'Tap a free table to use it for this order. Tap a busy table to pick its order.'; return; }
      el.innerHTML = `<b>${esc(picked.orders_table_text || '')}</b><br>Order: ${esc(picked.sale_no)}<br>Waiter: ${esc(picked.waiter_name || '-')}<br>Total: ${esc(money(picked.total_payable))}<br><small>Double-tap the table to open it</small>`
        + (!order.saleId && pickedTable ? `<button type="button" data-act="use" class="set_quick_action rj-use-table"><i class="fas fa-plus"></i> New order on ${esc(pickedTable.name)}</button>` : '');
    }
    function render() {
      $$('.get_area_table', box).forEach((a) => { a.classList.toggle('rj-area-on', String(a.dataset.id) === String(areaId)); });
      const area = areas.find((a) => String(a.id) === String(areaId)) || areas[0];
      let html = area.table_design_content || '';
      if (!/get_table_details/.test(html)) html = tableFallback(area.id);
      floor.innerHTML = html || '<p class="rj-empty">No tables in this area</p>';
      if (area.floor_bg_color) floor.style.backgroundColor = area.floor_bg_color;
      const bg = area.ordered_bg_color || S.orderedBg || '#fde2e1';
      const border = area.ordered_border_color || S.orderedBorder || '#e0342f';
      const color = area.ordered_text_color || S.orderedText || '#930000';
      $$('.get_table_details', floor).forEach((t) => {
        t.removeAttribute('contenteditable');
        const holder = t.closest('.div_rectangular') || t.parentElement;
        const orders = ordersOnTable(t.dataset.id, t.dataset.name);
        if (String(order.tableId) === String(t.dataset.id) && !order.saleId) holder.classList.add('rj-table-mine');
        if (orders.length) {
          const o = orders[0];
          t.dataset.booked_id = o.id; t.dataset.order_number = o.sale_no;
          holder.style.border = '1px solid ' + border; holder.style.backgroundColor = bg; holder.style.color = color;
          holder.classList.add('rj-booked');
          const tip = `Table: ${t.dataset.name}\nWaiter: ${o.waiter_name || '-'}\nOrder: ${o.sale_no}\nTotal: ${money(o.total_payable)}` + (orders.length > 1 ? `\n+${orders.length - 1} more order(s)` : '');
          t.innerHTML = `<div class="set_tooltip" title="${esc(tip)}"><span class="table_design_table_number">${esc(t.dataset.name)}</span><br><hr class="table_design_hr">${esc(o.waiter_name || '')}<br>${esc(String(o.sale_no).split('-')[1] || o.sale_no)}${orders.length > 1 ? ' +' + (orders.length - 1) : ''}</div>`;
        }
        if (picked && orders.some((o) => o.id === picked.id)) holder.classList.add('div_rectangular_active');
        // the website turns table names upright on rotated tables
        const m = /rotate\((-?\d+)deg\)/.exec(holder.getAttribute('style') || '');
        if (m) t.style.transform = `rotate(${-Number(m[1])}deg)`;
      });
      info();
    }
    tableView = { render };

    box.addEventListener('click', async (e) => {
      const area = e.target.closest('.get_area_table');
      if (area) { e.preventDefault(); areaId = area.dataset.id; picked = null; render(); return; }
      if (e.target.closest('#table_modal_cancel_button, #table_modal_cancel_button2')) { e.preventDefault(); close(); return; }
      if (e.target.closest('#reset_table')) { order.tableId = null; order.tableName = ''; syncOrderToControls(); toast('Table removed from this order'); close(); return; }
      const q = e.target.closest('.set_quick_action');
      if (q) {
        if (!picked) return toast('Tap a table that has an order first', 'error');
        const id = picked.id; const act = q.dataset.act;
        close();
        if (act === 'use' && pickedTable) { order.tableId = pickedTable.id; order.tableName = pickedTable.name; order.persons = order.persons || 1; if (order.orderType !== 1) setOrderType(1); else syncOrderToControls(); toast('You are ordering now on table ' + pickedTable.name); return; }
        if (act === 'invoice') return invoiceOrder(id);
        if (act === 'modify') return modifyOrder(id);
        if (act === 'bill') return billOrder(id);
        if (act === 'cancel') return cancelOrder(id);
        return;
      }
      const cell = e.target.closest('.div_rectangular') || (e.target.closest('.get_table_details') || {}).parentElement;
      if (!cell || !floor.contains(cell)) return;
      const t = $('.get_table_details', cell) || cell.closest('.get_table_details'); if (!t) return;
      const booked = Number(t.dataset.booked_id);
      $$('.div_rectangular_active', floor).forEach((x) => x.classList.remove('div_rectangular_active'));
      cell.classList.add('div_rectangular_active');
      if (booked) {
        pickedTable = { id: Number(t.dataset.id), name: t.dataset.name };
        picked = running.find((r) => r.id === booked) || null;
        if (picked) { selectedRunning = picked.id; renderRunning(); }
        info();
        return;
      }
      picked = null;
      order.tableId = Number(t.dataset.id); order.tableName = t.dataset.name; order.persons = order.persons || 1;
      if (order.orderType !== 1) setOrderType(1); else syncOrderToControls();
      toast('You are ordering now on table ' + t.dataset.name, 'success');
      close();
    });
    box.addEventListener('dblclick', (e) => {
      const t = e.target.closest('.div_rectangular'); if (!t || !floor.contains(t)) return;
      const d = $('.get_table_details', t); const booked = d && Number(d.dataset.booked_id);
      if (booked) { close(); modifyOrder(booked); }
    });
    overlay.addEventListener('click', close);
    render();
  }

  // actions on a running order (from the left buttons or the table screen)
  async function invoiceOrder(id) { if (!allowed('invoice')) return; await loadIntoCart(id); payModal(afterPaid); }
  async function modifyOrder(id) { if (!allowed('modifyOrder')) return; selectedRunning = id; renderRunning(); await loadIntoCart(id); }
  async function billOrder(id) { if (!allowed('bill')) return; const r = await api.call('pos:printBill', id); if (r.ok === false) toast(r.error, 'error'); else toast('Bill printed'); }
  async function cancelOrder(id) {
    if (!allowed('cancelOrder')) return;
    const r0 = running.find((x) => x.id === id);
    if (!(await confirmBox('Cancel order', 'Cancel order ' + (r0 ? r0.sale_no : '') + '? This cannot be undone.', 'Cancel order'))) return;
    const r = await api.call('pos:cancel', id);
    if (r && r.ok === false) return toast(r.error, 'error');
    if (order.saleId === id) newOrder();
    selectedRunning = null; loadRunning(); toast('Order cancelled');
  }

  // ------------------------------------------------------------------ running orders
  async function loadRunning() {
    running = await api.call('pos:running');
    if (!Array.isArray(running)) running = [];
    renderRunning();
    if (tableView) tableView.render();
  }

  const TYPE_NAMES = { 1: 'Dine In', 2: 'Take Away', 3: 'Delivery' };
  const tableOf = (r) => r.orders_table_text || ((cat.tables || []).find((t) => Number(t.id) === Number(r.table_id)) || {}).name || '';
  function renderRunning() {
    const q = ($('#search_running_orders').value || '').toLowerCase();
    const now = Date.now();
    const shown = running.filter((r) => !q || q.split(/\s+/).every((w) => [r.customer_name, r.waiter_name, r.sale_no, tableOf(r), 'table ' + tableOf(r), TYPE_NAMES[r.order_type], r.total_payable, r.user_name].join(' ').toLowerCase().includes(w)));
    $('#rj_order_count').textContent = q ? `${shown.length} of ${running.length} orders` : `${running.length} running order${running.length === 1 ? '' : 's'}`;
    $('.rj-order-search').classList.toggle('rj-has-text', !!q);
    const html = shown.map((r) => {
      const mins = Math.max(0, Math.floor((now - new Date(String(r.date_time).replace(' ', 'T')).getTime()) / 60000));
      return `<div class="single_order fix ${now - new Date(String(r.date_time).replace(' ', 'T')).getTime() < 120000 ? 'rj-new-order' : ''}" data-id="${r.id}" data-selected="${selectedRunning === r.id ? 'selected' : 'unselected'}">
        <div class="inside_single_order_container fix ${selectedRunning === r.id ? 'active' : ''}"><div class="single_order_content_holder_inside fix">
          <p class="oder_list_class txt_1 rj-run-head"><span class="rj-run-table">${tableOf(r) ? '<i class="fal fa-table"></i> ' + esc(tableOf(r)) : esc(TYPE_NAMES[r.order_type] || '')}</span> <span class="rj-run-waiter"><i class="fal fa-user"></i> ${esc(r.waiter_name || 'No waiter')}</span></p>
          <p class="rj-run-sub"><span class="running_order_order_number">${esc(r.sale_no)}</span> · ${esc(r.customer_name || 'Walk-in')} · <b>${fx(r.total_payable)}</b></p>
          <p>Table: <span class="running_order_table_name">${esc(tableOf(r) || 'None')}</span> · ${TYPE_NAMES[r.order_type] || ''}</p>
          <p><span class="running_order_customer_name">Cust: ${esc(r.customer_name || '')}</span></p>
          <p>Waiter: <span class="running_order_waiter_name">${esc(r.waiter_name || '')}</span></p>
          ${r.origin === 'server' ? '<p class="rj-muted">From another till</p>' : ''}
          <p class="txt_4 rj-run-meta">Time Count: ${mins} M · ${fx(r.total_payable)}</p>
        </div></div></div>`;
    }).join('');
    $('#order_details_holder').innerHTML = html || '<p class="rj-empty">No running orders</p>';
  }

  // select a card without redrawing the list (so a double-click lands on the same card)
  function markSelected() {
    $$('#order_details_holder .single_order').forEach((c) => {
      const on = Number(c.dataset.id) === selectedRunning;
      c.setAttribute('data-selected', on ? 'selected' : 'unselected');
      const inner = $('.inside_single_order_container', c); if (inner) inner.classList.toggle('active', on);
    });
  }

  function selectedOrThrow() {
    if (!selectedRunning) { toast('Select a running order first', 'error'); return null; }
    return selectedRunning;
  }

  async function loadIntoCart(id) {
    const s = await api.call('pos:get', id);
    if (!s || s.ok === false) return toast('Order not found', 'error');
    order = {
      saleId: s.id, saleNo: s.sale_no, orderType: Number(s.order_type) || 1, tableId: s.tables[0] ? s.tables[0].table_id : (s.table_id || null),
      tableName: s.orders_table_text || '', persons: s.tables[0] ? s.tables[0].persons : 1, customerId: s.customer_id, customerName: s.customer_name,
      waiterId: s.waiter_id, waiterName: s.waiter_name,
      discount: s.sub_total_discount_type === 'percentage' && s.sub_total_discount_value && !String(s.sub_total_discount_value).endsWith('%') ? s.sub_total_discount_value + '%' : (s.sub_total_discount_value || ''),
      charge: Number(s.delivery_charge) ? String(s.delivery_charge) : '', tips: Number(s.tips_amount) ? String(s.tips_amount) : '',
      lines: s.lines.map((l) => ({ key: 'n' + lineSeq++, id: l.id, food_menu_id: l.food_menu_id, menu_name: l.menu_name, qty: l.qty, menu_unit_price: l.menu_unit_price,
        modifiers: l.modifiers.map((m) => ({ id: m.id, name: m.name, price: m.price })), discount: l.menu_discount_value || '', menu_note: l.menu_note || '',
        kot_qty: l.kot_qty || 0, kitchen_id: l.kitchen_id, kitchen_name: l.kitchen_name, tax_information: (itemsById.get(l.food_menu_id) || {}).tax_information || l.menu_taxes })),
    };
    syncOrderToControls(); renderCart();
    return s;
  }

  // ------------------------------------------------------------------ save
  let saving = false;
  async function save(action, payments, given) {
    if (saving) return null;
    readControls();
    if (!order.lines.length) { toast('Add at least one item', 'error'); return null; }
    saving = true;
    try {
      const r = await api.call('pos:save', {
        saleId: order.saleId, action, orderType: order.orderType, tableId: order.tableId, tableName: order.tableName, persons: order.persons,
        customerId: order.customerId, customerName: order.customerName, waiterId: order.waiterId, waiterName: order.waiterName,
        discount: order.discount, charge: order.charge, tips: order.tips, payments, given,
        lines: order.lines.map((l) => ({ id: l.id, food_menu_id: l.food_menu_id, menu_name: l.menu_name, qty: l.qty, menu_unit_price: l.menu_unit_price, modifiers: l.modifiers, discount: l.discount, menu_note: l.menu_note, kot_qty: l.kot_qty, kitchen_id: l.kitchen_id, kitchen_name: l.kitchen_name })),
      });
      if (!r || r.ok === false) { toast((r && r.error) || 'Could not save', 'error', 5000); return null; }
      return r;
    } finally { saving = false; }
  }

  // like the website: a waiter is needed, and a Dine In order needs a table
  function readyToPlace() {
    readControls();
    if (!order.lines.length) { toast('Add at least one item', 'error'); return false; }
    if (!order.waiterId) {
      toast('Choose a waiter before placing the order', 'error', 3500);
      const w = $('#rj_waiter_pick') || $('#select_waiter'); w.classList.add('rj-need'); setTimeout(() => w.classList.remove('rj-need'), 2500); openWaiterList();
      return false;
    }
    if (Number(order.orderType) === 3 && isWalkIn(order.customerId)) {
      toast('Choose or add the customer for this delivery', 'error', 3500);
      openCustomerList();
      return false;
    }
    if (Number(order.orderType) === 1 && !order.tableId) {
      toast('Choose a table for this Dine In order', 'error', 3500);
      chooseTable();
      return false;
    }
    return true;
  }

  async function placeOrder() {
    if (!readyToPlace()) return;
    const r = await save('kot');
    if (!r) return;
    toast(`Order ${r.saleNo} placed${r.kitchens.length ? ' · KOT to ' + r.kitchens.join(', ') : ''}`);
    selectedRunning = r.saleId;
    newOrder(); loadRunning();
  }

  // give orders to another person (e.g. the person who took them has signed out)
  async function assignOrders(ids, s) {
    if (!allowed('modifyOrder')) return;
    const people = await api.call('pos:people');
    if (!people || people.ok === false) return toast((people && people.error) || 'Could not load people', 'error');
    const others = running.filter((r) => r.id !== s.id && ((s.waiter_id && Number(r.waiter_id) === Number(s.waiter_id)) || (!s.waiter_id && Number(r.user_id) === Number(s.user_id))));
    modal({ title: 'Assign order ' + s.sale_no, body: `<p class="rj-muted">Now: waiter <b>${esc(s.waiter_name || '-')}</b>, taken by <b>${esc(s.user_name || '-')}</b>.</p>
      <input type="search" class="rj-input" id="rj_assign_q" placeholder="Type a name" autocomplete="off" style="width:100%;margin-bottom:8px">
      ${others.length ? `<label class="rj-field" style="margin-bottom:8px"><input type="checkbox" id="rj_assign_all" style="display:inline;width:auto"> Also the other ${others.length} running order(s) of ${esc(s.waiter_name || s.user_name || 'this person')}</label>` : ''}
      <div class="rj-wl-items" id="rj_assign_list"></div>`,
    onOpen: (el, close) => {
      const list = $('#rj_assign_list', el); const q = $('#rj_assign_q', el);
      const draw = () => { const t = q.value.trim().toLowerCase(); list.innerHTML = people.filter((p) => !t || p.name.toLowerCase().includes(t)).map((p) => `<div class="rj-wl-item" data-id="${p.id}">${esc(p.name)} <small class="rj-muted">${esc(p.waiter ? 'Waiter' : (p.designation || ''))}</small></div>`).join('') || '<div class="rj-wl-none">Nobody with that name</div>'; };
      q.addEventListener('input', draw); draw();
      list.addEventListener('click', async (e) => {
        const it = e.target.closest('[data-id]'); if (!it) return;
        const all = $('#rj_assign_all', el) && $('#rj_assign_all', el).checked;
        const r = await api.call('pos:assign', all ? ids.concat(others.map((o) => o.id)) : ids, Number(it.dataset.id));
        if (r && r.ok === false) return toast(r.error, 'error', 5000);
        toast(`${r.count} order(s) given to ${r.to} (${r.as})`); close(); loadRunning();
      });
    }, buttons: [{ text: 'Close', cls: 'rj-grey' }] });
  }

  // admin: updates from GitHub
  let upd = {};
  function showUpdate(st) {
    upd = st || {};
    const dot = $('#rj_update_dot'); if (!dot) return;
    dot.style.display = upd.status === 'ready' ? 'block' : 'none';
    $('#rj_update').title = upd.status === 'ready' ? `Update ${upd.version} is ready: click to install` : upd.status === 'downloading' ? `Downloading update ${upd.version} (${upd.progress || 0}%)` : 'Updates (this is version ' + (upd.current || '') + ')';
  }
  async function updateClick() {
    if (upd.status === 'ready') {
      if (upd.portable) return toast('This is the portable copy. Install with the Setup file to get automatic updates.', 'info', 6000);
      if (!(await confirmBox('Install update', `Install Rojey POS ${upd.version} now? The app closes and opens again by itself in about 30 seconds. Orders and settings are kept.`, 'Install now'))) return;
      const r = await api.call('update:install');
      if (r && r.ok === false) toast(r.error, 'error', 6000); else toast('Installing the update…', 'info', 6000);
      return;
    }
    toast('Checking for updates…', 'info', 2000);
    const st = await api.call('update:check');
    if (!st || st.ok === false) return toast((st && st.error) || 'Could not check', 'error');
    showUpdate(st);
    if (st.status === 'ready') updateClick();
    else if (st.status === 'uptodate' || st.status === 'idle') toast('Rojey POS ' + st.current + ' is the newest version', 'success', 3500);
    else if (st.status === 'downloading') toast(`Downloading ${st.version}: ${st.progress || 0}%`, 'info');
    else if (st.status === 'error') toast('Update check failed: ' + st.error, 'error', 6000);
  }

  async function printLastInvoice() {
    if (!allowed('lastInvoice')) return;
    const r = await api.call('pos:lastInvoice');
    if (r && r.ok === false) toast(r.error, 'error'); else toast(`Last invoice ${r.saleNo} printed`);
  }

  async function printBillNow() {
    const r = await save('bill');
    if (!r) return;
    toast(`Bill printed for ${r.saleNo}`);
    selectedRunning = r.saleId;
    newOrder(); loadRunning();
  }

  function payModal(onDone) {
    readControls();
    if (!order.lines.length) { toast('Add at least one item', 'error'); return; }
    const t = totals();
    const pms = cat.paymentMethods.length ? cat.paymentMethods : [{ id: 1, name: 'Cash' }];
    let method = pms.find((p) => String(p.id) === String(S.defaultPayment)) || pms[0];
    const rows = [];
    const m = modal({
      title: 'Finalize Sale', wide: true, cls: 'rj-pay',
      body: `<div class="rj-pay-top"><div>Total Payable</div><div class="rj-big" id="rj_p_total">${money(t.payable)}</div></div>
        <div class="rj-pay-cols"><div><div class="rj-pay-methods">${pms.map((p) => `<button class="rj-pm ${p.id === method.id ? 'rj-on' : ''}" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div></div>
        <div><label class="rj-field">Amount <input type="number" step="any" id="rj_p_amount" value="${fx(t.payable)}"></label>
          <button class="rj-btn rj-blue" id="rj_p_add" type="button">Add Payment</button>
          <div id="rj_p_rows" class="rj-p-rows"></div>
          <label class="rj-field">Given Amount <input type="number" step="any" id="rj_p_given" placeholder="Cash given by the customer"></label>
          <div class="rj-pay-line">Paid: <b id="rj_p_paid">0</b> &nbsp; Due: <b id="rj_p_due">0</b> &nbsp; Change: <b id="rj_p_change">0</b></div></div></div>`,
      buttons: [
        { text: 'Cancel', cls: 'rj-grey' },
        { text: 'Submit', cls: 'rj-primary', id: 'rj_p_submit', onClick: async (close, el) => {
          let pays = rows.slice();
          if (!pays.length) pays = [{ payment_id: method.id, payment_name: method.name, amount: C.num($('#rj_p_amount', el).value) || t.payable }];
          const given = C.num($('#rj_p_given', el).value) || pays.reduce((a, p) => a + p.amount, 0);
          close();
          const r = await save('pay', pays, given);
          if (r) onDone(r);
        } },
      ],
    });
    const el = m.el;
    const upd = () => {
      const paid = rows.reduce((a, p) => a + p.amount, 0);
      const given = C.num($('#rj_p_given', el).value) || paid || C.num($('#rj_p_amount', el).value);
      $('#rj_p_paid', el).textContent = fx(paid || C.num($('#rj_p_amount', el).value));
      $('#rj_p_due', el).textContent = fx(Math.max(0, t.payable - (paid || C.num($('#rj_p_amount', el).value))));
      $('#rj_p_change', el).textContent = fx(Math.max(0, given - t.payable));
      $('#rj_p_rows', el).innerHTML = rows.map((p, i) => `<div class="rj-p-row"><span>${esc(p.payment_name)}</span><b>${fx(p.amount)}</b><i class="fal fa-times" data-i="${i}"></i></div>`).join('');
    };
    $$('.rj-pm', el).forEach((b) => b.addEventListener('click', () => { method = pms.find((p) => String(p.id) === b.dataset.id); $$('.rj-pm', el).forEach((x) => x.classList.toggle('rj-on', x === b)); }));
    $('#rj_p_add', el).addEventListener('click', () => {
      const amt = C.num($('#rj_p_amount', el).value); if (!amt) return;
      rows.push({ payment_id: method.id, payment_name: method.name, amount: amt });
      const left = Math.max(0, t.payable - rows.reduce((a, p) => a + p.amount, 0));
      $('#rj_p_amount', el).value = fx(left); upd();
    });
    $('#rj_p_rows', el).addEventListener('click', (e) => { const i = e.target.dataset.i; if (i != null) { rows.splice(Number(i), 1); upd(); } });
    $('#rj_p_given', el).addEventListener('input', upd);
    $('#rj_p_amount', el).addEventListener('input', upd);
    upd();
  }

  function afterPaid(r) {
    toast(`Sale ${r.saleNo} done${r.kitchens.length ? ' · KOT to ' + r.kitchens.join(', ') : ''}`);
    if (order.saleId === selectedRunning) selectedRunning = null;
    newOrder(); loadRunning();
  }

  function optionsModal() {
    modal({
      title: 'Discount, Charge and Tips',
      body: `<div class="rj-form"><label class="rj-field" ${P().discount === false ? 'style="display:none"' : ''}>Discount on the whole order (amount, or % like 10%) <input type="text" id="rj_o_disc" value="${esc(order.discount)}"></label>
        <label class="rj-field" ${P().charge === false ? 'style="display:none"' : ''}>Service / delivery charge (amount, or %) <input type="text" id="rj_o_charge" value="${esc(order.charge)}"></label>
        <label class="rj-field" ${P().tips === false ? 'style="display:none"' : ''}>Tips <input type="number" step="any" id="rj_o_tips" value="${esc(order.tips)}"></label></div>`,
      buttons: [{ text: 'Cancel', cls: 'rj-grey' }, { text: 'Apply', cls: 'rj-primary', onClick: (c, el) => {
        order.discount = $('#rj_o_disc', el).value.trim(); order.charge = $('#rj_o_charge', el).value.trim(); order.tips = $('#rj_o_tips', el).value.trim();
        renderCart(); c();
      } }],
    });
  }

  async function reprintKot() {
    const id = selectedOrThrow(); if (!id) return;
    const s = await api.call('pos:get', id);
    const groups = new Map();
    for (const l of s.lines) { const k = l.kitchen_name || kitchenName.get(l.kitchen_id) || 'Kitchen'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
    const body = [...groups.entries()].map(([k, ls]) => `<div class="rj-kgroup"><label class="rj-khead"><input type="checkbox" class="rj-kall" checked> <b>${esc(k)}</b></label>
      ${ls.map((l) => `<label class="rj-kline"><input type="checkbox" class="rj-kl" value="${l.id}" checked> ${esc(l.qty)} x ${esc(l.menu_name)}${l.modifiers.length ? ' <small>(' + l.modifiers.map((m) => esc(m.name)).join(', ') + ')</small>' : ''}</label>`).join('')}</div>`).join('');
    const m = modal({ title: 'Reprint KOT · ' + s.sale_no, body: `<p class="rj-muted">Pick what to print. Each kitchen gets its own ticket.</p>${body}`,
      buttons: [{ text: 'Cancel', cls: 'rj-grey' }, { text: 'Print KOT', cls: 'rj-primary', onClick: async (c, el) => {
        const ids = $$('.rj-kl:checked', el).map((x) => Number(x.value));
        if (!ids.length) return toast('Pick at least one item', 'error');
        c();
        const r = await api.call('pos:reprintKot', id, ids);
        if (r.ok === false) toast(r.error, 'error'); else toast('KOT sent to ' + r.kitchens.join(', '));
      } }] });
    $$('.rj-kall', m.el).forEach((a) => a.addEventListener('change', () => $$('.rj-kl', a.closest('.rj-kgroup')).forEach((x) => { x.checked = a.checked; })));
  }

  async function orderDetails() {
    const id = selectedOrThrow(); if (!id) return;
    const s = await api.call('pos:get', id);
    const kots = (await api.call('pos:kots', s.sale_no)) || [];
    const t2 = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };
    const kotHtml = kots.length ? `<h4 class="rj-kot-h">Kitchen tickets (KOT) kept on this computer</h4><table class="rj-table rj-kot-table"><tr><th>Time</th><th>Kitchen</th><th>Items</th><th></th></tr>${kots.map((k) => `<tr><td>${t2(k.at)}${k.reprint ? ' <small>(reprint)</small>' : ''}</td><td>${esc(k.kitchen)}<br><small>${esc(k.printers)}</small></td><td>${k.lines.map((l) => `${esc(l.qty)} × ${esc(l.name)}`).join('<br>')}</td><td>${P().waiter ? '' : `<button type="button" class="rj-btn rj-grey rj-small" data-kot-again="${k.id}">Print</button>`}</td></tr>`).join('')}</table>` : '';
    modal({ title: 'Order ' + s.sale_no, wide: true, onOpen: (el) => el.addEventListener('click', async (e) => { const b = e.target.closest('[data-kot-again]'); if (!b) return; const r = await api.call('pos:kotAgain', Number(b.dataset.kotAgain)); if (r && r.ok === false) toast(r.error, 'error'); else toast('KOT printed again'); }), body: `<table class="rj-table"><tr><th>Item</th><th>Qty</th><th>Kitchen</th><th class="r">Total</th></tr>
      ${s.lines.map((l) => `<tr><td>${esc(l.menu_name)}${l.modifiers.length ? '<br><small>' + l.modifiers.map((m) => esc(m.name)).join(', ') + '</small>' : ''}${l.menu_note ? '<br><small><i>' + esc(l.menu_note) + '</i></small>' : ''}</td><td>${l.qty}</td><td>${esc(l.kitchen_name || '')}</td><td class="r">${fx(l.menu_price_with_discount)}</td></tr>`).join('')}
      <tr><td colspan="3"><b>Total Payable</b></td><td class="r"><b>${money(s.total_payable)}</b></td></tr></table>${kotHtml}
      <p class="rj-muted">Customer: ${esc(s.customer_name)} · Waiter: ${esc(s.waiter_name || '-')} · Table: ${esc(tableOf(s) || '-')} · ${esc(s.date_time)} · by ${esc(s.user_name)}</p>`,
    buttons: [
      { text: 'Modify Order', cls: 'rj-blue', onClick: (c) => { c(); modifyOrder(id); } },
      ...(P().waiter ? [] : [{ text: 'Assign to…', cls: 'rj-grey', onClick: (c) => { c(); assignOrders([id], s); } }]),
      ...(P().waiter ? [] : [{ text: 'Invoice', cls: 'rj-green', onClick: (c) => { c(); invoiceOrder(id); } }]),
      { text: 'Close', cls: 'rj-primary' },
    ] });
  }

  // ------------------------------------------------------------------ status
  function showStatus(st) {
    if (!st) return;
    const a = $('#online_status');
    a.classList.toggle('bg__green', !!st.online); a.classList.toggle('bg__red', !st.online);
    $('#rj_online_text').textContent = st.online ? 'Online' : 'Offline';
    const waiting = (st.pending || 0) + (st.legacyPending || 0);
    $('#rj_pending').textContent = waiting ? '(' + waiting + ')' : '';
    a.title = (st.online ? 'Connected to ' + st.baseUrl : 'No connection to ' + st.baseUrl + '. Billing continues; orders upload by themselves later.') +
      `\nWaiting to upload: ${waiting}\nLast upload: ${RJ.fmtTime(st.lastSync)}\nMenu downloaded: ${RJ.fmtTime(st.lastPull)}` + (st.lastError ? '\nLast problem: ' + st.lastError : '');
    $('#sync_online i').classList.toggle('fa-spin', !!st.syncing);
    $('#rj_refresh i').classList.toggle('rj-pulse', !!st.pulling);
  }

  // ------------------------------------------------------------------ events
  function bind() {
    // a picture that cannot load (no internet, removed on the website) shows the default picture
    document.addEventListener('error', (e) => { const t = e.target; if (t && t.tagName === 'IMG' && !t.dataset.rjFallback) { t.dataset.rjFallback = '1'; t.src = 'web/images/image_thumb.png'; } }, true);
    $('#rj_categories').addEventListener('click', (e) => { const a = e.target.closest('a[data-cat]'); if (!a) return; e.preventDefault(); filter.category = a.dataset.cat; renderCategories(); renderItems(); });
    $('#rj_items').addEventListener('click', (e) => { const d = e.target.closest('.single_item'); if (d) clickItem(Number(d.dataset.id)); });
    $('#search').addEventListener('input', (e) => { filter.text = e.target.value; renderItems(); });
    $('#search_form').addEventListener('submit', (e) => { // Enter adds the item when the search finds exactly one
      e.preventDefault();
      const tiles = $$('#rj_items .single_item');
      if (tiles.length === 1) { clickItem(Number(tiles[0].dataset.id)); e.target.reset(); filter.text = ''; renderItems(); }
    });
    $$('.veg_bev_item').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const k = a.dataset.status; filter[k] = !filter[k]; a.classList.toggle('rj-on', filter[k]); renderItems(); }));

    $('#rj_cart').addEventListener('click', (e) => {
      const row = e.target.closest('.single_order'); if (!row) return;
      const l = order.lines.find((x) => x.key === row.dataset.key); if (!l) return;
      const act = e.target.dataset.act;
      const sentGuard = (newQty) => !(order.saleId && l.kot_qty && newQty < l.kot_qty && P().removeSent === false) || allowed('removeSent');
      if (act === 'inc') { l.qty += 1; renderCart(l.key); }
      else if (act === 'dec') { if (!sentGuard(l.qty - 1)) return; l.qty -= 1; if (l.qty <= 0) removeLine(l.key); else renderCart(l.key); }
      else if (act === 'del') { if (!sentGuard(0)) return; removeLine(l.key); }
      else if (act === 'edit' || (!act && e.target.tagName !== 'INPUT')) editLine(l);
    });
    $('#rj_cart').addEventListener('change', (e) => {
      if (e.target.dataset.act !== 'disc') return;
      const l = order.lines.find((x) => x.key === e.target.closest('.single_order').dataset.key);
      if (l) { l.discount = e.target.value.trim(); renderCart(l.key); }
    });
    $('#rj_summary').addEventListener('click', (e) => { if (e.target.closest('[data-act=options]')) optionsModal(); });
    $('#rj_order_options').addEventListener('click', (e) => { e.preventDefault(); optionsModal(); });
    // the running-order timer and "new" marks stay current; the website's orders arrive by themselves
    setInterval(() => { if (!document.hidden) loadRunning(); }, 5000);
    $('#cart_item_option_open').addEventListener('click', () => document.body.classList.toggle('rj-hide-summary'));

    $$('.main_top .selected__btn_c').forEach((b) => b.addEventListener('click', () => setOrderType(Number(b.dataset.type))));
    $('#rj_table_btn').addEventListener('click', chooseTable);
    $('#select_waiter').addEventListener('change', readControls);
    $('#walk_in_customer').addEventListener('change', readControls);

    $('#cancel_button').addEventListener('click', async () => { if (!order.lines.length || await confirmBox('Clear cart', 'Remove all items from the cart?')) newOrder(); });
    $('#place_order').addEventListener('click', () => { if (allowed(order.saleId ? 'modifyOrder' : 'placeOrder')) placeOrder(); });
    $('#direct_invoice').addEventListener('click', () => { if (allowed(order.saleId ? 'invoice' : 'directInvoice')) payModal(afterPaid); });
    $('#rj_bill_now').addEventListener('click', () => { if (allowed('bill')) printBillNow(); });

    $('#order_details_holder').addEventListener('click', (e) => {
      const d = e.target.closest('.single_order'); if (!d) return;
      selectedRunning = Number(d.dataset.id); markSelected();
    });
    $('#order_details_holder').addEventListener('dblclick', (e) => { const d = e.target.closest('.single_order'); if (d) { selectedRunning = Number(d.dataset.id); markSelected(); orderDetails(); } });
    $('#search_running_orders').addEventListener('input', renderRunning);
    $('#search_running_orders').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.target.value = ''; renderRunning(); }
      if (e.key === 'Enter') { const first = $('#order_details_holder .single_order'); if (first) { selectedRunning = Number(first.dataset.id); renderRunning(); } }
    });
    $('#rj_clear_order_search').addEventListener('click', () => { $('#search_running_orders').value = ''; renderRunning(); $('#search_running_orders').focus(); });
    $('#print_last_invoice').addEventListener('click', (e) => { e.preventDefault(); printLastInvoice(); });
    $('#rj_update').addEventListener('click', (e) => { e.preventDefault(); updateClick(); });
    api.on('update', showUpdate);
    api.call('update:state').then(showUpdate);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F4') { e.preventDefault(); $('#search_running_orders').focus(); $('#search_running_orders').select(); }
      if (e.key === 'F8') { e.preventDefault(); printLastInvoice(); }
    });
    $('#refresh_order').addEventListener('click', loadRunning);
    $('#modify_order').addEventListener('click', () => { const id = selectedOrThrow(); if (id) modifyOrder(id); });
    $('#single_order_details').addEventListener('click', orderDetails);
    $('#rj_kot').addEventListener('click', () => { if (allowed('kot')) reprintKot(); });
    $('#create_invoice_and_close').addEventListener('click', () => { const id = selectedOrThrow(); if (id) invoiceOrder(id); });
    $('#create_bill_and_close').addEventListener('click', () => { const id = selectedOrThrow(); if (id) billOrder(id); });
    $('#cancel_order_button').addEventListener('click', () => { const id = selectedOrThrow(); if (id) cancelOrder(id); });

    $('#rj_logout').addEventListener('click', async (e) => { e.preventDefault(); await api.call('auth:logout'); });
    $('#rj_sales').addEventListener('click', (e) => { e.preventDefault(); api.call('nav', 'sales'); });
    $('#rj_settings').addEventListener('click', async (e) => { e.preventDefault(); const r = await api.call('nav', 'setup'); if (r.ok === false) toast(r.error, 'error'); });
    $('#rj_fullscreen').addEventListener('click', (e) => { e.preventDefault(); api.call('app:fullscreen'); });
    $('#rj_refresh').addEventListener('click', async (e) => {
      e.preventDefault(); toast('Downloading menu, tables and users…', 'info');
      const r = await api.call('data:refresh');
      if (r.ok === false) toast(r.error, 'error', 6000); else toast('Menu and settings are up to date');
    });
    $('#sync_online').addEventListener('click', async (e) => { e.preventDefault(); const st = await api.call('sync:now'); showStatus(st); loadRunning(); toast(st.online ? 'Synced' : 'No internet: orders are kept and will upload later', st.online ? 'success' : 'info'); });
    $('#pull_running_order').addEventListener('click', async (e) => { e.preventDefault(); await api.call('sync:now'); await loadRunning(); toast('Running orders updated'); });
    $('#online_status').addEventListener('click', (e) => e.preventDefault());

    api.on('status', showStatus);
    api.on('catalog-changed', () => loadCatalog().then(() => renderCart()));
    api.on('running-changed', (info) => {
      loadRunning();
      const mod = (info && info.modified) || [];
      if (order && order.saleNo && mod.includes(order.saleNo)) toast(`Order ${order.saleNo} was changed on the website or another till. Open it again to see the changes.`, 'info', 6000);
      else if (mod.length) toast(`Order ${mod.join(', ')} updated from the website`, 'info', 2500);
    });
    setInterval(renderRunning, 30000);
  }

  (async function start() {
    order = { lines: [], orderType: 2 };
    await loadCatalog();
    if (!cat) return;
    order = blankOrder();
    bind();
    syncOrderToControls(); renderCart();
    await loadRunning();
    showStatus(await api.call('status'));
    $('#search').focus();
  })();
})();
