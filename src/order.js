// Builds the order JSON exactly in the shape the website's own POS sends to Sale/push_online,
// from an order saved in the local database.
function s(v) { return v == null ? '' : String(v); }

function buildOrderJson(sale, settings, { running = false } = {}) {
  const p = Number(settings.precision != null ? settings.precision : 2);
  const fx = (v) => (Number(v) || 0).toFixed(p);
  const payments = (sale.payments || []).map((x) => ({ payment_id: s(x.payment_id), payment_name: s(x.payment_name), usage_point: '', amount: fx(x.amount) }));
  const tables = (sale.tables || []).map((t) => ({ table_id: s(t.table_id), persons: s(t.persons || 1) }));
  const items = (sale.lines || []).map((l) => {
    const mods = l.modifiers || [];
    return {
      food_menu_id: s(l.food_menu_id),
      menu_name: s(l.menu_name),
      kitchen_id: s(l.kitchen_id),
      kitchen_name: s(l.kitchen_name),
      is_print: '1',
      is_kot_print: '1',
      is_free: s(l.is_free_item || 0),
      rounding_amount_hidden: '0',
      item_vat: safeJson(l.menu_taxes, []),
      menu_discount_value: s(l.menu_discount_value),
      discount_type: s(l.discount_type || 'fixed'),
      menu_price_without_discount: fx(l.menu_price_without_discount),
      menu_unit_price: fx(l.menu_unit_price),
      qty: s(l.qty),
      tmp_qty: s(l.qty),
      p_qty: '0',
      item_previous_id: '',
      item_cooking_done_time: '',
      item_cooking_start_time: '',
      item_cooking_status: '',
      item_type: s(l.item_type),
      menu_price_with_discount: fx(l.menu_price_with_discount),
      item_discount_amount: fx(l.discount_amount),
      modifiers_id: mods.map((m) => m.id).join(','),
      modifiers_name: mods.map((m) => m.name).join(','),
      modifiers_price: mods.map((m) => fx(m.price)).join(','),
      modifier_vat: mods.length ? mods.map((m) => m.menu_taxes || '').join('|||') : '',
      item_note: s(l.menu_note),
      discount_reason: '',
      menu_combo_items: '',
    };
  });
  const order = {
    sale_no: s(sale.sale_no),
    is_merge: '',
    is_online_order: '',
    edit_sale_id: '',
    waiter_app_status: '',
    hidden_given_amount: s(sale.given_amount || 0),
    hidden_change_amount: s(sale.change_amount || 0),
    counter_id: s(sale.counter_id || ''),
    counter_name: '',
    random_code: s(sale.random_code),
    token_number: s(sale.token_number),
    customer_id: s(sale.customer_id || 1),
    customer_address: '',
    customer_gst_number: '',
    status: 'Pending',
    user_name: s(sale.user_name),
    user_id: s(sale.user_id),
    zatca_invoice_value: '',
    customer_name: s(sale.customer_name),
    delivery_partner_id: '',
    self_order_table_id: '',
    self_order_table_person: '',
    rounding_amount_hidden: s(sale.rounding_amount_hidden || 0),
    previous_due_tmp: '0',
    waiter_id: s(sale.waiter_id || ''),
    waiter_name: s(sale.waiter_name),
    open_invoice_date_hidden: s(sale.sale_date),
    total_items_in_cart: s(sale.total_items),
    sub_total: fx(sale.sub_total),
    sale_date: s(sale.sale_date),
    date_time: s(sale.date_time),
    order_time: s(sale.order_time),
    charge_type: s(sale.charge_type || 'service'),
    total_vat: fx(sale.vat),
    total_payable: fx(sale.total_payable),
    total_item_discount_amount: fx(sale.total_item_discount_amount),
    sub_total_with_discount: fx(sale.sub_total_with_discount),
    sub_total_discount_amount: fx(sale.sub_total_discount_amount),
    total_discount_amount: fx(sale.total_discount_amount),
    delivery_charge: s(sale.delivery_charge || 0),
    tips_amount: s(sale.tips_amount || 0),
    delivery_charge_actual_charge: s(sale.delivery_charge || 0),
    tips_amount_actual_charge: s(sale.tips_amount || 0),
    sub_total_discount_value: s(sale.sub_total_discount_value),
    sub_total_discount_type: s(sale.sub_total_discount_type || 'fixed'),
    order_type: s(sale.order_type || 1),
    order_status: '3',
    sale_vat_objects: safeJson(sale.sale_vat_objects, []),
    orders_table: tables,
    table_id: s(tables[0] ? tables[0].table_id : ''),
    orders_table_text: s(sale.orders_table_text),
    payment_method_type: s(sale.payment_method_id || (payments[0] && payments[0].payment_id) || ''),
    paid_amount: fx(sale.paid_amount),
    due_amount: fx(sale.due_amount),
    is_multi_currency: '',
    multi_currency: '',
    multi_currency_rate: '',
    multi_currency_amount: '',
    // The website decodes this field twice (it is a JSON string inside a JSON string).
    payment_object: JSON.stringify(JSON.stringify(payments)),
    paid_date_time: s(sale.paid_date_time || sale.date_time),
    send_sms_status: '',
    send_email_status: '',
    send_whatsapp_status: '',
    items,
  };
  if (running) {
    order.order_status = '1';
    order.payment_method_type = '';
    order.paid_amount = '0';
    order.due_amount = '0';
    order.payment_object = JSON.stringify(JSON.stringify([]));
    order.paid_date_time = '';
  }
  return JSON.stringify(order);
}

function safeJson(t, d) {
  if (t == null || t === '') return d;
  if (typeof t !== 'string') return t;
  try { return JSON.parse(t); } catch { return d; }
}

// A running order that another till (or the website) placed: turn the website's order JSON
// back into local rows. Items already went to the kitchen there, so they are marked as printed.
function parseServerOrder(o) {
  if (typeof o === 'string') o = JSON.parse(o);
  const tables = Array.isArray(o.orders_table) ? o.orders_table : [];
  const lines = (o.items || []).map((it) => {
    const ids = s(it.modifiers_id).split(',').filter(Boolean);
    const names = s(it.modifiers_name).split(',');
    const prices = s(it.modifiers_price).split(',');
    const qty = Number(it.qty) || 1;
    return {
      food_menu_id: Number(it.food_menu_id), menu_name: s(it.menu_name), qty,
      menu_unit_price: Number(it.menu_unit_price) || 0, discount: s(it.menu_discount_value),
      menu_note: s(it.item_note), kitchen_id: it.kitchen_id ? Number(it.kitchen_id) : null, kitchen_name: s(it.kitchen_name),
      modifiers: ids.map((id, i) => ({ id: Number(id), name: names[i] || '', price: Number(prices[i]) || 0 })),
      kot_qty: qty, item_type: s(it.item_type),
    };
  });
  return {
    header: {
      sale_no: s(o.sale_no), customer_id: s(o.customer_id || 1), customer_name: s(o.customer_name), waiter_id: Number(o.waiter_id) || null,
      waiter_name: s(o.waiter_name), order_type: Number(o.order_type) || 1, orders_table_text: s(o.orders_table_text),
      user_id: Number(o.user_id) || null, user_name: s(o.user_name), date_time: s(o.date_time), order_time: s(o.order_time),
      sale_date: s(o.sale_date || o.open_invoice_date_hidden), random_code: s(o.random_code), token_number: s(o.token_number),
      counter_id: Number(o.counter_id) || 0,
    },
    discount: s(o.sub_total_discount_type) === 'percentage' && s(o.sub_total_discount_value) && !s(o.sub_total_discount_value).endsWith('%') ? s(o.sub_total_discount_value) + '%' : s(o.sub_total_discount_value),
    charge: s(o.delivery_charge), tips: s(o.tips_amount),
    table: tables[0] && tables[0].table_id ? { table_id: Number(tables[0].table_id), persons: Number(tables[0].persons) || 1 } : null,
    lines,
  };
}

module.exports = { buildOrderJson, parseServerOrder };
