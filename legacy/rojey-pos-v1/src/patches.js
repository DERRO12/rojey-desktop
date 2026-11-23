// Small fixes applied to the POS script on this computer only (the website's files are not changed).
// Each fix is a text replacement; if the website's script changes and a fix no longer matches,
// it is simply skipped.
const FIXES = [
  {
    name: 'offline KOT: read the selected order number',
    // print_kot_button() offline reads data-sale_id, which the KOT button never sets (it sets data-sale_no).
    find: /(function print_kot_button\(kot_print\)\{[\s\S]{0,400}?\}else\{\s*let sale_no = \$\("\.print_kot_button"\)\.attr\(")data-sale_id("\))/,
    replace: '$1data-sale_no$2',
  },
  {
    name: 'offline KOT: use the saved order text',
    // getSelectedOrderDetails() resolves with the order text itself, but callers read data.order (always undefined).
    find: /getSelectedOrderDetails\((sale_no)\)\.then\(function\(data\)\{\s*if\(data\.order !== null\) \{\s*print_kot_print\(data\.order,/g,
    replace: "getSelectedOrderDetails($1).then(function(data){ var __o=(data&&typeof data==='object'&&('order' in data))?data.order:data; if(__o) { print_kot_print(__o,",
  },
  {
    name: 'uploads handled by the app (one at a time, from its own database)',
    // The app uploads waiting orders itself, so the page must not upload the same order at the same time.
    find: /function push_next_offline_sale\(always_notify\) \{/,
    replace: 'function push_next_offline_sale(always_notify) { if (window.rojeyDesktop && window.rojeyDesktop.syncNow) { window.rojeyDesktop.syncNow(always_notify); return; }',
    flag: 'appSync',
  },
];

function isPosScript(url) {
  return /\/pos_?script[^/]*\.js(\?|$)/i.test(url);
}

function apply(text) {
  const applied = [];
  const flags = {};
  for (const f of FIXES) {
    const before = text;
    text = text.replace(f.find, f.replace);
    if (text !== before) { applied.push(f.name); if (f.flag) flags[f.flag] = true; }
  }
  return { text, applied, flags };
}

module.exports = { isPosScript, apply, FIXES };
