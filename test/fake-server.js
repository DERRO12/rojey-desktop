// A small stand-in for the iRestora PLUS website, with just the pages and calls the app uses.
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

function md5(s) { return crypto.createHash('md5').update(String(s)).digest('hex'); }

function createFakeServer() {
  const S = {
    down: false,
    users: [
      { id: 1, full_name: 'Admin User', email: 'admin@x.com', password: 'secret', pin: '1111', role: 'Admin', designation: 'Admin', short: 'AD', outlet_id: 1 },
      { id: 5, full_name: 'Cashier Jane', email: 'jane@x.com', password: 'pw1', pin: '2222', role: 'User', designation: 'Cashier', short: 'CJ', outlet_id: 1, deny: ['pos_2', 'pos_4'] },
      { id: 7, full_name: 'Waiter Tom', email: 'tom@x.com', password: 'pw7', pin: '3333', role: 'User', designation: 'Waiter', short: 'WT', outlet_id: 1, deny: [] },
    ],
    registerOpen: { 1: true, 5: false, 7: true },
    sessions: new Map(),           // sid -> userId
    sales: new Map(),              // sale_no -> { order, user_id, times }
    kitchen: new Map(),            // sale_no -> { content, user_id }
    pushCount: 0, kitchenPushCount: 0, logins: 0, registerOpens: 0, bootstrap: false,
  };

  const items = [
    { item_id: '10', kitchen_id: '1', kitchen_name: 'Kitchen', parent_id: '0', item_code: 'B1', category_name: 'Burgers', item_name: 'Beef Burger', alternative_name: '', price: '500.00', price_take: '450.00', price_delivery: '550.00', image: '', tax_information: '[{"tax_field_id":"1","tax_field_company_id":"1","tax_field_name":"VAT","tax_field_percentage":"16"}]', veg_item_status: 'no', beverage_item_status: 'no', product_type: '1', is_variation: 'No', modifiers: [{ menu_modifier_id: '3', modifier_row_id: '31', menu_modifier_name: 'Extra Cheese', tax_information: '[]', menu_modifier_price: '50.00' }] },
    { item_id: '11', kitchen_id: '1', kitchen_name: 'Kitchen', parent_id: '0', item_code: 'F1', category_name: 'Burgers', item_name: "Chef's Fries", alternative_name: '', price: '200.00', price_take: '200.00', price_delivery: '200.00', image: '', tax_information: '[]', veg_item_status: 'yes', beverage_item_status: 'no', product_type: '1', is_variation: 'No', modifiers: [] },
    { item_id: '20', kitchen_id: '2', kitchen_name: 'Bar', parent_id: '0', item_code: 'D1', category_name: 'Drinks', item_name: 'Mojito', alternative_name: '', price: '300.00', price_take: '300.00', price_delivery: '300.00', image: '', tax_information: '[]', veg_item_status: 'no', beverage_item_status: 'yes', product_type: '1', is_variation: 'Yes', modifiers: [] },
    { item_id: '21', kitchen_id: '2', kitchen_name: 'Bar', parent_id: '20', item_code: 'D1L', category_name: 'Drinks', item_name: 'Large', alternative_name: '', price: '400.00', price_take: '400.00', price_delivery: '400.00', image: '', tax_information: '[]', veg_item_status: 'no', beverage_item_status: 'yes', product_type: '1', is_variation: 'No', modifiers: [] },
    { item_id: '30', kitchen_id: '3', kitchen_name: 'Cafe', parent_id: '0', item_code: 'C1', category_name: 'Coffee', item_name: 'Cappuccino', alternative_name: '', price: '250.00', price_take: '250.00', price_delivery: '250.00', image: 'uploads/items/capp.png', tax_information: '[]', veg_item_status: 'no', beverage_item_status: 'yes', product_type: '1', is_variation: 'No', modifiers: [] },
  ];
  S.items = items;
  const jsObj = (o) => '{' + Object.entries(o).map(([k, v]) => k + ':' + (Array.isArray(v) ? '[' + v.map(jsObj).join(',') + ']' : "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'")).join(',') + '}';

  function posPage(u) {
    const cats = [[1, 'Burgers', ['10', '11']], [2, 'Drinks', ['20']], [3, 'Coffee', ['30']]];
    const grid = cats.map(([id, , ids]) => `<div id="category_${id}" class="specific_category_items_holder">` + ids.map((i) => `<div class="single_item animate__animated animate__flipInX" data-price="1"  id="item_${i}"><img src="x"><p class="item_name">n</p></div>`).join('') + '</div>').join('');
    const catBtns = cats.map(([id, n]) => `<li><a href="#" class="category_button" id="button_category_${id}">${n}</a></li>`).join('');
    return `<!doctype html><html><head><title>POS</title></head><body>
      <input type="hidden" id="user_id" value="${u.id}"><input type="hidden" id="user_name" value="${u.full_name}">
      <input type="hidden" id="outlet_id_indexdb" value="1"><input type="hidden" id="company_id_indexdb" value="1">
      <input type="hidden" id="username_short" value="${u.short}"><input type="hidden" id="loggedin_designation" value="${u.designation}">
      <input type="hidden" id="ur_role" value="${u.role}"><input type="hidden" id="hidden_currency" value="KSh">
      <input type="hidden" id="ir_precision" value="2"><input type="hidden" id="inv_collect_tax" value="${S.collectTax || 'Yes'}"><input type="hidden" id="tax_type" value="1">
      <input type="hidden" id="outlet_name" value="Rojey Main"><input type="hidden" id="outlet_address" value="Arua"><input type="hidden" id="outlet_phone" value="0700">
      <input type="hidden" id="invoice_footer" value="Karibu tena"><input type="hidden" id="counter_id" value="">
      <div class="pos_outlet_info irestora_font_div_pos">Rojey Main</div>
      <ul>${catBtns}</ul><div class="category_items">${grid}</div>
      <select id="select_waiter" class="select2"><option value="">Waiter</option><option value="7" selected>Waiter Tom</option><option value="8">Waiter Ann</option></select>
      <select id="walk_in_customer" class="select2"><option value="">Customer</option><option data-x="1" value="1" selected>Walk-in Customer </option><option value="2">Mary 0711</option></select>
      <ul><li><a class="set_no_access active set_payment" data-mobile-money="0" data-name="Cash" data-id="1" href="#">Cash</a></li>
          <li><a class="set_no_access  set_payment" data-mobile-money="1" data-name="M-Pesa" data-id="4" href="#">M-Pesa</a></li></ul>
      <ul class="dineIn-table-list-of-item"><li><div class="set_design ir_display_none"><div class="div_rectangular img_bg_4 area_all_table area_table_1" style="position: absolute; top: 30px; left: 40px;"><div class="div_box"><h5 class="trigger_to_select_other get_table_details" data-id="101" data-hidden_table_capacity="4" data-booked_id="" data-order_number="" data-merge_id="" data-name="T1">T1</h5></div></div><div class="div_rectangular img_bg_2 area_all_table area_table_1" style="position: absolute; top: 30px; left: 260px; transform: rotate(90deg);"><div class="div_box"><h5 class="trigger_to_select_other get_table_details" data-id="102" data-hidden_table_capacity="2" data-booked_id="" data-order_number="" data-merge_id="" data-name="T2" onclick="alert(1)">T2</h5></div></div><script>alert(2)</script></div><a class="get_area_table" data-floor_bg_color=""  data-ordered_border_color="#c0392b"  data-ordered_bg_color="#ffd9d6"  data-ordered_text_color="#8b0000" data-id="1" href="javascript:void(0)">Main Hall</a></li><li><div class="set_design ir_display_none"></div><a class="get_area_table" data-floor_bg_color=""  data-ordered_border_color=""  data-ordered_bg_color=""  data-ordered_text_color="" data-id="2" href="javascript:void(0)">Terrace</a></li></ul>
      <div class="all-dineIn-table bg-white pos_ml_10 table_bg table_bg_1"></div>
      <input type="hidden" id="is_offline_system" value="">
      ${u.role === 'Admin' ? '' : Array.from({ length: 25 }, (_, i) => `<input type="hidden" id="pos_${i + 1}" value="${(u.deny || []).includes('pos_' + (i + 1)) ? 0 : 1}">`).join('')}
      <input type="hidden" id="ordered_bg_color_hidden" value=""><input type="hidden" id="ordered_border_color_hidden" value=""><input type="hidden" id="ordered_text_color_hidden" value="">
      <script>
      window.customers = [{customer_id:'1',default_discount:'0',same_or_diff_state:'0',customer_name:'Walk-in Customer',customer_address:'',gst_number:''},{customer_id:'2',default_discount:'0',same_or_diff_state:'0',customer_name:'Mary',customer_address:'',gst_number:''}]
      window.items = [${items.map(jsObj).join(',')}];
      window.only_modifiers = [{menu_modifier_id:'3',menu_modifier_name:'Extra Cheese',tax_information:'[]',menu_modifier_price:'50.00'}];
      window.kitchens = [{kitchen_id:'1',kitchen_name:'Kitchen',printer_id:'1'},{kitchen_id:'2',kitchen_name:'Bar',printer_id:'2'},{kitchen_id:'3',kitchen_name:'Cafe',printer_id:'3'}];
      </script></body></html>`;
  }

  const loginHtml = '<html><body><form><input name="email_address"><input name="password"><input name="login_pin"></form></body></html>';

  function readBody(req) {
    return new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c).toString())); });
  }
  function parseForm(body) {
    const out = {};
    for (const part of body.split('&')) {
      if (!part) continue;
      const [k, v = ''] = part.split('=');
      const key = decodeURIComponent(k.replace(/\+/g, ' ')); const val = decodeURIComponent(v.replace(/\+/g, ' '));
      if (key.endsWith('[]')) (out[key] = out[key] || []).push(val); else out[key] = val;
    }
    return out;
  }
  function cookieSid(req) { const m = /sid=([a-f0-9]+)/.exec(req.headers.cookie || ''); return m ? m[1] : null; }
  const redirect = (res, loc, headers = {}) => { res.writeHead(302, { Location: loc, ...headers }); res.end(); };

  const server = http.createServer(async (req, res) => {
    if (S.down) { req.socket.destroy(); return; }
    const u = new URL(req.url, 'http://x');
    const p = u.pathname.replace(/^\/+/, '');
    const body = req.method === 'POST' ? await readBody(req) : '';
    const form = parseForm(body);
    const sid = cookieSid(req);
    const uid = sid ? S.sessions.get(sid) : null;
    const user = S.users.find((x) => x.id === uid);
    const base = 'http://' + req.headers.host + '/';

    if (p === 'uploads/items/capp.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')); }
    if (p === 'Authentication/index' || p === '') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(loginHtml); }
    if (p === 'Authentication/loginCheck') {
      S.logins++;
      const found = form.active_login_button_hidden === '1'
        ? S.users.find((x) => x.email === form.email_address && x.password === form.password)
        : S.users.find((x) => x.pin === form.login_pin);
      if (!found) return redirect(res, base + 'Authentication/index');
      const nsid = crypto.randomBytes(8).toString('hex');
      S.sessions.set(nsid, found.id);
      return redirect(res, base + 'Sale/POS', { 'Set-Cookie': 'sid=' + nsid + '; Path=/; HttpOnly' });
    }
    if (p === '__test/state') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ sales: [...S.sales.entries()].map(([k, v]) => ({ sale_no: k, user_id: v.user_id, times: v.times, total: v.order.total_payable, items: v.order.items.length, order: v.order })), kitchen: [...S.kitchen.keys()], pushCount: S.pushCount, kitchenPushCount: S.kitchenPushCount, logins: S.logins, registerOpens: S.registerOpens })); }
    if (p === 'IR_api/desktop_bootstrap') {
      if (!S.bootstrap) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: true, users: S.users.map((x) => ({ id: x.id, full_name: x.full_name, email_address: x.email, password: md5(x.password), login_pin: x.pin, designation: x.designation, role: x.role })), kitchen_categories: [], products: [] }));
    }
    if (!user) return redirect(res, base + 'Authentication/index');

    if (p === 'Sale/POS') return redirect(res, base + 'POSChecker/posAndWaiterMiddleman');
    if (p === 'POSChecker/posAndWaiterMiddleman') {
      if (!S.registerOpen[user.id]) return redirect(res, base + 'Register/openRegister');
      return redirect(res, base + 'Sale/POS/' + user.id + '/1');
    }
    if (p === 'Register/openRegister') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<form action="${base}Register/addBalance"><select name="counter_id" id="counter_id"><option value="">Select</option><option value="3">Counter 1</option></select>
        <input type="hidden" value="Cash" name="payment_names[]"><input type="hidden" value="1" name="payment_ids[]"><input type="text" name="payments[]"></form>
        <form action="${base}Register/addExistingBalance"><select name="counter_id"><option value="9">Other</option></select></form>`);
    }
    if (p === 'Register/addBalance') {
      if (form.counter_id && form.submit) { S.registerOpen[user.id] = true; S.registerOpens++; }
      return redirect(res, base + 'Dashboard/dashboard');
    }
    if (p === 'Dashboard/dashboard') { res.writeHead(200); return res.end('<html>dashboard</html>'); }
    if (/^Sale\/POS\/\d+\/\d+/.test(p)) {
      if (!S.registerOpen[user.id]) return redirect(res, base + 'Register/openRegister');
      res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(posPage(user));
    }
    if (p.startsWith('Sale/') && !S.registerOpen[user.id]) return redirect(res, base + 'Register/openRegister');
    if (p === 'Sale/push_online') {
      S.pushCount++;
      const order = JSON.parse(form.orders);
      // the website decodes payment_object twice
      JSON.parse(JSON.parse(order.payment_object));
      const ex = S.sales.get(order.sale_no);
      S.sales.set(order.sale_no, { order, user_id: user.id, times: ex ? ex.times + 1 : 1 });
      if (S.kitchen.has(order.sale_no)) S.kitchen.get(order.sale_no).invoiced = true;
      res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(form.sales_id);
    }
    if (p === 'Sale/add_kitchen_sale_by_ajax') {
      S.kitchenPushCount++;
      const o = JSON.parse(form.order);
      S.kitchen.set(o.sale_no, { content: form.order, user_id: user.id });
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ status: true }));
    }
    if (p === 'Sale/add_customer_by_ajax') {
      S.customers = S.customers || new Map(); S.nextCustomer = S.nextCustomer || 100;
      const id = Number(form.customer_id) > 0 ? Number(form.customer_id) : S.nextCustomer++;
      S.customers.set(id, { name: form.customer_name, phone: form.customer_phone, email: form.customer_email, address: form.customer_delivery_address });
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ customer_id: id, online_customer_id: '' }));
    }
    if (p === 'Sale/add_cancel_audit_report') {
      const o = JSON.parse(form.order); S.kitchen.delete(o.sale_no);
      res.writeHead(200); return res.end('');
    }
    if (p === 'Sale/get_all_running_order_for_new_pc') {
      const own = new Set((form.sale_no_all || '').split(',').filter(Boolean));
      const all = (form.sale_no_all_for_invoice || '').split(',').filter(Boolean);
      // like the website: a cashier sees every running order of the outlet, anyone else only their own
      const list = [...S.kitchen.entries()].filter(([no, k]) => !own.has(no) && !k.invoiced && (user.designation === 'Cashier' || Number(k.user_id) === Number(user.id))).map(([no, k], i) => ({ id: i + 1, sale_no: no, self_order_content: k.content }));
      const inv = all.filter((no) => S.sales.has(no)).map((no) => ({ id: 1, sale_no: no }));
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ get_all_running_order_for_new_pc: list, already_invoiced_orders: inv }));
    }
    res.writeHead(404); res.end('not found ' + p);
  });

  // another till places a running order on the website
  S.addRemoteRunning = (saleNo, userId = 5) => {
    const order = { sale_no: saleNo, customer_id: '1', customer_name: 'Walk-in Customer', waiter_id: '8', waiter_name: 'Waiter Ann', order_type: '1', orders_table_text: 'T2',
      orders_table: [{ table_id: '102', persons: '2' }], user_id: String(userId), user_name: 'Cashier Jane', date_time: '2026-11-22 10:00:00', order_time: '10:00:00', sale_date: '2026-11-22',
      sub_total_discount_value: '', delivery_charge: '0', tips_amount: '0',
      items: [{ food_menu_id: '30', menu_name: 'Cappuccino', qty: '2', menu_unit_price: '250.00', modifiers_id: '', modifiers_name: '', modifiers_price: '', item_note: '', kitchen_id: '3', kitchen_name: 'Cafe' }] };
    S.kitchen.set(saleNo, { content: JSON.stringify(order), user_id: userId });
  };
  return { server, S };
}

module.exports = { createFakeServer };

if (require.main === module) {
  const { server } = createFakeServer();
  server.listen(Number(process.env.PORT) || 8099, () => console.log('fake iRestora on', server.address().port));
}
