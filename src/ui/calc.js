// Order totals, worked out the same way as the website's POS screen.
// Used by the POS screen (live totals) and by the main process (the saved numbers).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RojeyCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function round(v, p) { const f = Math.pow(10, p); return Math.round((num(v) + Number.EPSILON) * f) / f; }
  function parseTaxes(t) {
    if (!t) return [];
    if (Array.isArray(t)) return t;
    try { const a = JSON.parse(t); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  // "10" -> fixed 10, "10%" -> 10 percent
  function discountOf(value, base) {
    const s = String(value == null ? '' : value).trim();
    if (!s) return { amount: 0, type: 'fixed', value: '' };
    if (s.endsWith('%')) {
      const p = Math.min(100, Math.max(0, num(s.slice(0, -1))));
      return { amount: base * p / 100, type: 'percentage', value: s };
    }
    return { amount: Math.min(base, Math.max(0, num(s))), type: 'fixed', value: s };
  }

  // settings: { precision, collectTax ('Yes'/'No'), taxType (1 = added on top, other = included in price) }
  // order: { lines:[{qty, menu_unit_price, modifiers:[{price}], discount, tax_information}], discount, charge, chargeType, tips }
  function totals(order, settings) {
    const p = Number(settings && settings.precision != null ? settings.precision : 2);
    const collect = !settings || String(settings.collectTax || 'Yes') === 'Yes';
    // only the taxes an admin ticked in Settings (when a list is given)
    const allowed = settings && Array.isArray(settings.enabledTaxes) ? new Set(settings.enabledTaxes.map((n) => String(n).trim().toLowerCase())) : null;
    const exclusive = Number(settings && settings.taxType != null ? settings.taxType : 1) === 1;
    const taxMap = {};
    let subTotal = 0; let itemDiscount = 0; let items = 0; let qtyTotal = 0;
    const lines = (order.lines || []).map((l) => {
      const qty = num(l.qty);
      const unit = num(l.menu_unit_price);
      const modEach = (l.modifiers || []).reduce((a, m) => a + num(m.price), 0);
      const without = (unit + modEach) * qty;
      const d = discountOf(l.discount != null ? l.discount : l.menu_discount_value, without);
      const withDisc = without - d.amount;
      const taxes = [];
      if (collect) {
        for (const t of parseTaxes(l.tax_information)) {
          const pct = num(t.tax_field_percentage);
          if (!pct) continue;
          const amt = exclusive ? withDisc * pct / 100 : withDisc - withDisc / (1 + pct / 100);
          const name = t.tax_field_name || ('Tax ' + (t.tax_field_id || ''));
          if (allowed && !allowed.has(String(name).trim().toLowerCase())) continue;
          if (!taxMap[name]) taxMap[name] = { tax_field_id: String(t.tax_field_id || ''), tax_field_type: name, amount: 0 };
          taxMap[name].amount += amt;
          taxes.push({ ...t, tax_field_amount: round(amt, p).toFixed(p) });
        }
      }
      subTotal += withDisc; itemDiscount += d.amount; items += 1; qtyTotal += qty;
      return {
        menu_price_without_discount: round(without, p), menu_price_with_discount: round(withDisc, p),
        discount_amount: round(d.amount, p), discount_type: d.type, menu_discount_value: d.value, taxes,
      };
    });
    const od = discountOf(order.discount, subTotal);
    const afterDisc = subTotal - od.amount;
    let charge = 0;
    const cs = String(order.charge == null ? '' : order.charge).trim();
    if (cs) charge = cs.endsWith('%') ? afterDisc * num(cs.slice(0, -1)) / 100 : num(cs);
    const tips = num(order.tips);
    const vatObjects = Object.values(taxMap).map((t) => ({ tax_field_id: t.tax_field_id, tax_field_type: t.tax_field_type, tax_field_amount: round(t.amount, p).toFixed(p) }));
    const vatTotal = vatObjects.reduce((a, t) => a + num(t.tax_field_amount), 0);
    const payable = afterDisc + (exclusive ? vatTotal : 0) + charge + tips;
    return {
      lines,
      items, qtyTotal,
      subTotal: round(subTotal, p),
      itemDiscount: round(itemDiscount, p),
      orderDiscount: round(od.amount, p),
      orderDiscountType: od.type,
      orderDiscountValue: od.value,
      subTotalWithDiscount: round(afterDisc, p),
      totalDiscount: round(itemDiscount + od.amount, p),
      charge: round(charge, p),
      chargeValue: cs,
      tips: round(tips, p),
      vatObjects,
      vat: round(vatTotal, p),
      vatAdded: exclusive,
      payable: round(payable, p),
      precision: p,
    };
  }

  function money(v, settings) {
    const p = Number(settings && settings.precision != null ? settings.precision : 2);
    const parts = num(v).toFixed(p).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const s = parts.join('.');
    const c = (settings && settings.currency) || '';
    if (!c) return s;
    return settings.currencyPosition === 'After Amount' ? s + ' ' + c : c + ' ' + s;
  }

  return { totals, money, num, round, parseTaxes, discountOf };
});
