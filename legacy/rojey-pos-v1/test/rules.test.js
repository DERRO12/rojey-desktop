const test = require('node:test'); const assert = require('node:assert');
const R = require('../src/rules');
test('normalizeBaseUrl', () => {
  assert.equal(R.normalizeBaseUrl('pos.rojeycreamery.com'), 'https://pos.rojeycreamery.com/');
  assert.equal(R.normalizeBaseUrl('https://pos.rojeycreamery.com/Sale/POS'), 'https://pos.rojeycreamery.com/');
  assert.equal(R.normalizeBaseUrl('http://example.com/pos/index.php/Authentication/index'), 'http://example.com/pos/');
  assert.equal(R.normalizeBaseUrl(''), '');
});
test('session lost redirects', () => {
  const b = 'https://x.com/';
  assert.equal(R.isSessionLostRedirect(302, 'https://x.com/Authentication/index', b), 'login');
  assert.equal(R.isSessionLostRedirect(302, '/Outlet/outlets', b), 'outlet');
  assert.equal(R.isSessionLostRedirect(302, 'https://x.com/Sale/POS', b), null);
  assert.equal(R.isSessionLostRedirect(200, 'https://x.com/Authentication/index', b), null);
});
test('static + printers', () => {
  assert.ok(R.isStatic('https://x.com/frequent_changing/js/pos_script_v7.3.js?v=7.6.20'));
  assert.ok(!R.isStatic('https://x.com/Sale/POS'));
  assert.equal(R.pickPrinter('kitchen', { receiptPrinter: 'A' }), 'A');
  assert.equal(R.pickPrinter('kitchen', { receiptPrinter: 'A', kitchenPrinter: 'K' }), 'K');
});
