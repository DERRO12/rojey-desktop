// Reads menus, kitchens, customers, tables, payment methods and settings out of the website's
// POS page (and the IR_api desktop_bootstrap endpoint when the website has it) and stores them in
// the local tables. Nothing on the website is changed.
const vm = require('vm');
const { decodeEntities } = require('./server');

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decodeEntities(m[3] != null ? m[3] : m[4]);
  return out;
}

function hiddenInputs(html) {
  const out = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (a.id && a.value !== undefined && !(a.id in out)) out[a.id] = a.value;
  }
  return out;
}

// window.items = [ {item_id:'1',...}, ... ];  (JavaScript object literals written by the website)
function jsArray(html, name) {
  const re = new RegExp('window\\.' + name + '\\s*=\\s*\\[');
  const m = re.exec(html);
  if (!m) return null;
  // find the matching closing bracket, skipping quoted strings
  let i = m.index + m[0].length - 1; let depth = 0; let q = null;
  for (; i < html.length; i++) {
    const c = html[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) break; }
  }
  const src = html.slice(m.index + m[0].length - 1, i + 1);
  try { return vm.runInNewContext('(' + src + ')', Object.create(null), { timeout: 2000 }); } catch { return null; }
}

// The floor plan an admin drew on the website (table design). It is shown as it is, minus anything that could run.
function cleanDesign(html) {
  return String(html || '')
    .replace(/<(script|iframe|object|embed|link|meta|style)\b[\s\S]*?(<\/\1>|$)/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2')
    .slice(0, 400000);
}

// POS permissions the website gives this person (Settings > Role: POS functions pos_1 ... pos_25)
function posAccess(hid) {
  const out = {}; let any = false;
  for (let n = 1; n <= 30; n++) { const v = hid['pos_' + n]; if (v !== undefined) { out['pos_' + n] = Number(v) ? 1 : 0; any = true; } }
  return any ? out : null;
}

function stripTags(s) { return decodeEntities(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(); }

function parsePosPage(html) {
  const hid = hiddenInputs(html);
  const items = jsArray(html, 'items') || [];
  const kitchens = jsArray(html, 'kitchens') || [];
  const customers = jsArray(html, 'customers') || [];
  const onlyModifiers = jsArray(html, 'only_modifiers') || [];

  // item -> category, from the menu grid: <div id="category_3" class="specific_category_items_holder"> ... id="item_12"
  const itemCat = {};
  const holders = html.split(/<div id="category_(\d+)" class="specific_category_items_holder">/);
  for (let k = 1; k < holders.length; k += 2) {
    const cat = Number(holders[k]);
    for (const im of holders[k + 1].matchAll(/class="single_item[^"]*"[^>]*id="item_(\d+)"/g)) if (!(im[1] in itemCat)) itemCat[im[1]] = cat;
  }
  const categories = [];
  const seenCat = new Set();
  let order = 0;
  for (const cm of html.matchAll(/<a href="#" class="category_button" id="button_category_(\d+)">([\s\S]*?)<\/a>/g)) {
    if (seenCat.has(cm[1])) continue;
    seenCat.add(cm[1]);
    categories.push({ id: Number(cm[1]), category_name: stripTags(cm[2]), order_by: order++, del_status: 'Live' });
  }

  const byId = {};
  for (const it of items) byId[it.item_id] = it;
  const menus = items.map((it, idx) => {
    const parent = it.parent_id && it.parent_id !== '0' ? byId[it.parent_id] : null;
    const catId = itemCat[it.item_id] != null ? itemCat[it.item_id] : (parent && itemCat[parent.item_id] != null ? itemCat[parent.item_id] : null);
    return {
      id: Number(it.item_id), code: it.item_code, name: it.item_name, alternative_name: it.alternative_name,
      category_id: catId, sale_price: Number(it.price) || 0, sale_price_take_away: Number(it.price_take) || Number(it.price) || 0,
      sale_price_delivery: Number(it.price_delivery) || Number(it.price) || 0, tax_information: it.tax_information || '[]',
      veg_item: it.veg_item_status === 'yes' ? 'Veg Yes' : 'Veg No', beverage_item: it.beverage_item_status === 'yes' ? 'Beverage Yes' : 'Beverage No',
      bar_item: '', parent_id: Number(it.parent_id) || 0, product_type: Number(it.product_type) || 1, photo: it.image || '',
      is_variation: it.is_variation || 'No', kitchen_id: it.kitchen_id ? Number(it.kitchen_id) : null, kitchen_name: it.kitchen_name || '',
      del_status: 'Live', sort: idx,
      _modifiers: it.modifiers || [],
    };
  });
  const modifiers = new Map();
  const itemMods = [];
  let imId = 1;
  for (const m of onlyModifiers) modifiers.set(String(m.menu_modifier_id), { id: Number(m.menu_modifier_id), name: m.menu_modifier_name, price: Number(m.menu_modifier_price) || 0, tax_information: m.tax_information || '[]' });
  for (const fm of menus) {
    for (const m of fm._modifiers) {
      if (!modifiers.has(String(m.menu_modifier_id))) modifiers.set(String(m.menu_modifier_id), { id: Number(m.menu_modifier_id), name: m.menu_modifier_name, price: Number(m.menu_modifier_price) || 0, tax_information: m.tax_information || '[]' });
      itemMods.push({ id: Number(m.modifier_row_id) || imId, modifier_id: Number(m.menu_modifier_id), food_menu_id: fm.id });
      imId++;
    }
    delete fm._modifiers;
  }

  // waiters: <select id="select_waiter" ...> <option value="5">Name</option>
  const waiters = [];
  const ws = /<select id="select_waiter"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  if (ws) for (const o of ws[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)) { const a = attrs(o[1]); if (a.value) waiters.push({ id: Number(a.value), full_name: stripTags(o[2]), is_selected: /selected/.test(o[1]) }); }

  // payment methods: <a class="... set_payment" data-name="Cash" data-id="1">
  const payments = [];
  const seenPay = new Set();
  for (const pm of html.matchAll(/<a\b[^>]*class="[^"]*set_payment[^"]*"[^>]*>/g)) {
    const a = attrs(pm[0]);
    if (!a['data-id'] || seenPay.has(a['data-id'])) continue;
    seenPay.add(a['data-id']);
    payments.push({ id: Number(a['data-id']), name: a['data-name'], order_by: payments.length, del_status: 'Live', _default: /\bactive\b/.test(a.class || '') });
  }
  if (!payments.length) {
    const sel = /<select name="finalie_order_payment_method"[^>]*>([\s\S]*?)<\/select>/.exec(html);
    if (sel) for (const o of sel[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)) { const a = attrs(o[1]); if (a.value) payments.push({ id: Number(a.value), name: stripTags(o[2]), order_by: payments.length, _default: /selected/.test(o[1]) }); }
  }

  // tables and areas
  const areas = []; const tables = [];
  const seenTable = new Set();
  const lis = html.split(/<li><div class="set_design[^"]*">/);
  for (let k = 1; k < lis.length; k++) {
    const chunk = lis[k];
    const aTag = /<a class="get_area_table"[^>]*>([\s\S]*?)<\/a>/.exec(chunk);
    const aa = aTag ? attrs(aTag[0].slice(0, aTag[0].indexOf('>') + 1)) : {};
    const areaId = Number(aa['data-id']) || k;
    const end = chunk.lastIndexOf('</div><a class="get_area_table"');
    areas.push({
      id: areaId, area_name: aTag ? stripTags(aTag[1]) : 'Area ' + k, table_design_content: cleanDesign(end >= 0 ? chunk.slice(0, end) : ''),
      floor_bg_color: aa['data-floor_bg_color'] || '', ordered_bg_color: aa['data-ordered_bg_color'] || '',
      ordered_border_color: aa['data-ordered_border_color'] || '', ordered_text_color: aa['data-ordered_text_color'] || '',
    });
    for (const t of chunk.matchAll(/<[a-z0-9]+\b[^>]*class="[^"]*get_table_details[^"]*"[^>]*>/g)) {
      const a = attrs(t[0]);
      if (!a['data-id'] || seenTable.has(a['data-id'])) continue;
      seenTable.add(a['data-id']);
      tables.push({ id: Number(a['data-id']), area: areaId, name: a['data-name'] || ('Table ' + a['data-id']), sit_capacity: a['data-hidden_table_capacity'] || '' });
    }
  }
  if (!areas.length) {
    for (const t of html.matchAll(/<[a-z0-9]+\b[^>]*class="[^"]*get_table_details[^"]*"[^>]*>/g)) {
      const a = attrs(t[0]);
      if (!a['data-id'] || seenTable.has(a['data-id'])) continue;
      seenTable.add(a['data-id']);
      tables.push({ id: Number(a['data-id']), area: 0, name: a['data-name'] || ('Table ' + a['data-id']), sit_capacity: a['data-hidden_table_capacity'] || '' });
    }
  }

  const custRows = customers.map((c) => ({ id: Number(c.customer_id), name: c.customer_name, address: c.customer_address, gst_number: c.gst_number, default_discount: c.default_discount || '0', same_or_diff_state: Number(c.same_or_diff_state) || 0 }));
  // default customer is the <option selected> in #walk_in_customer
  let defaultCustomer = null;
  const wc = /<select[^>]*id="walk_in_customer"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  if (wc) {
    const phones = {};
    for (const o of wc[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)) { const a = attrs(o[1]); if (a.value) phones[a.value] = stripTags(o[2]).trim(); }
    for (const c of custRows) { const t = phones[String(c.id)]; if (t && c.name && t.startsWith(c.name)) c.phone = t.slice(c.name.length).trim(); else if (t && !c.name) c.name = t; }
  }
  if (wc) { const sel = /<option\b[^>]*selected[^>]*value="(\d+)"/.exec(wc[1]) || /<option\b[^>]*value="(\d+)"[^>]*selected/.exec(wc[1]); if (sel) defaultCustomer = Number(sel[1]); }

  const outletName = hid.outlet_name || stripTags((/<div class="pos_outlet_info[^"]*">([\s\S]*?)<\/div>/.exec(html) || [])[1] || '');

  return {
    user: {
      id: Number(hid.user_id) || null, full_name: hid.user_name || '', short_name: hid.username_short || '',
      designation: hid.loggedin_designation || '', role: hid.ur_role || '', pos_access: posAccess(hid),
    },
    outlet: { id: Number(hid.outlet_id_indexdb) || null, outlet_name: outletName, address: hid.outlet_address || '', phone: hid.outlet_phone || '', company_id: Number(hid.company_id_indexdb) || null },
    settings: {
      currency: hid.hidden_currency || '', precision: hid.ir_precision !== undefined && hid.ir_precision !== '' ? Number(hid.ir_precision) : 2,
      collectTax: hid.inv_collect_tax || 'No', taxType: hid.tax_type ? Number(hid.tax_type) : 1, taxIsGst: hid.tax_is_gst || '',
      tableBg: ((/class="all-dineIn-table[^"]*\b(table_bg_\d+)/.exec(html) || [])[1]) || '',
      orderedBg: hid.ordered_bg_color_hidden || '', orderedBorder: hid.ordered_border_color_hidden || '', orderedText: hid.ordered_text_color_hidden || '',
      waiterApp: hid.waiter_app_status || '',
      currencyPosition: hid.currency_position || '', invoiceFooter: hid.invoice_footer || '', defaultOrderType: hid.default_order_type || '',
      taxRegistrationNo: hid.inv_tax_registration_no || '', defaultCustomer, defaultPayment: (payments.find((p) => p._default) || {}).id || null,
      defaultWaiter: (waiters.find((w) => w.is_selected) || {}).id || null, counterId: Number(hid.counter_id) || 0,
    },
    tables: {
      tbl_food_menu_categories: categories,
      tbl_food_menus: menus,
      tbl_modifiers: [...modifiers.values()],
      tbl_food_menus_modifiers: itemMods,
      tbl_kitchens: kitchens.map((k) => ({ id: Number(k.kitchen_id), name: k.kitchen_name, printer_id: Number(k.printer_id) || null })),
      tbl_customers: custRows,
      tbl_areas: areas,
      tbl_tables: tables,
      tbl_payment_methods: payments.map(({ _default, ...p }) => p),
    },
    waiters,
  };
}

// Merge the richer IR_api bootstrap (when the website has it) over what the POS page gave.
function mergeBootstrap(parsed, b) {
  if (!b) return parsed;
  const t = parsed.tables;
  const kitchenOfCat = {};
  for (const kc of b.kitchen_categories || []) kitchenOfCat[kc.cat_id] = kc.kitchen_id;
  const kName = {};
  for (const k of b.kitchens || []) kName[k.id] = k.name;
  if (Array.isArray(b.products) && b.products.length) {
    const fromPage = {};
    for (const m of t.tbl_food_menus) fromPage[m.id] = m;
    t.tbl_food_menus = b.products.map((p, i) => {
      const pg = fromPage[p.id] || {};
      const kid = pg.kitchen_id || kitchenOfCat[p.category_id] || null;
      return { ...p, sale_price: pg.sale_price != null ? pg.sale_price : p.sale_price, sale_price_take_away: pg.sale_price_take_away || p.sale_price_take_away || p.sale_price,
        sale_price_delivery: pg.sale_price_delivery || p.sale_price_delivery || p.sale_price, photo: pg.photo || p.photo,
        kitchen_id: kid, kitchen_name: pg.kitchen_name || kName[kid] || '', is_variation: pg.is_variation || (p.is_variation ? 'Yes' : 'No'),
        category_id: p.category_id || pg.category_id, sort: pg.sort != null ? pg.sort : i };
    });
  }
  if (Array.isArray(b.categories) && b.categories.length) t.tbl_food_menu_categories = b.categories;
  if (Array.isArray(b.modifiers) && b.modifiers.length) t.tbl_modifiers = b.modifiers;
  if (Array.isArray(b.food_menu_modifiers) && b.food_menu_modifiers.length) t.tbl_food_menus_modifiers = b.food_menu_modifiers;
  if (Array.isArray(b.kitchens) && b.kitchens.length) t.tbl_kitchens = b.kitchens;
  if (Array.isArray(b.kitchen_categories)) t.tbl_kitchen_categories = b.kitchen_categories;
  if (Array.isArray(b.printers)) t.tbl_printers = b.printers;
  if (Array.isArray(b.tables) && b.tables.length) t.tbl_tables = b.tables;
  if (Array.isArray(b.payment_methods) && b.payment_methods.length) t.tbl_payment_methods = b.payment_methods;
  if (Array.isArray(b.customers) && b.customers.length > t.tbl_customers.length) t.tbl_customers = b.customers;
  if (Array.isArray(b.users) && b.users.length) t.tbl_users = b.users;
  if (b.outlet) parsed.outlet = { ...parsed.outlet, ...b.outlet };
  return parsed;
}

// Bar items: an item whose kitchen is called "Bar" or whose bar_item is "Bar Yes".
function applyPull(db, parsed) {
  const t = parsed.tables;
  db.tx(() => {
    for (const [name, rows] of Object.entries(t)) {
      if (name === 'tbl_users') continue;
      if (!Array.isArray(rows)) continue;
      // keep what we had if the website returned nothing for a table that used to have rows
      if (!rows.length && ['tbl_food_menus', 'tbl_food_menu_categories', 'tbl_payment_methods'].includes(name)) continue;
      db.replaceTable(name, rows);
    }
    if (t.tbl_users && t.tbl_users.length) {
      for (const u of t.tbl_users) db.upsert('tbl_users', u);
    }
    db.set('waiter_ids', (parsed.waiters || []).map((w) => Number(w.id)));
    for (const w of parsed.waiters || []) {
      const ex = db.user(w.id);
      db.upsert('tbl_users', { id: w.id, full_name: w.full_name, is_waiter: 1, ...(ex ? {} : { designation: 'Waiter' }) });
    }
    if (parsed.user && parsed.user.id) {
      db.upsert('tbl_users', { id: parsed.user.id, full_name: parsed.user.full_name, short_name: parsed.user.short_name, designation: parsed.user.designation, role: parsed.user.role, pos_access: parsed.user.pos_access ? JSON.stringify(parsed.user.pos_access) : null });
    }
    if (parsed.outlet && parsed.outlet.id) db.upsert('tbl_outlets', parsed.outlet);
    const prev = db.get('pos_settings', {}) || {};
    db.set('pos_settings', { ...prev, ...parsed.settings, outletId: parsed.outlet.id, outletName: parsed.outlet.outlet_name, outletAddress: parsed.outlet.address, outletPhone: parsed.outlet.phone, companyId: parsed.outlet.company_id });
    db.set('last_pull', Date.now());
  });
}

module.exports = { parsePosPage, mergeBootstrap, applyPull, hiddenInputs, jsArray };
