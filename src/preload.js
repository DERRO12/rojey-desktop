const { contextBridge, ipcRenderer } = require('electron');

const CALLS = new Set(['app:state', 'auth:login', 'auth:logout', 'nav', 'pos:catalog', 'pos:running', 'pos:get', 'pos:save', 'pos:cancel',
  'pos:reprintKot', 'pos:reprintReceipt', 'pos:lastInvoice', 'pos:people', 'pos:customerSave', 'pos:assign', 'pos:split', 'printers:status', 'sales:web', 'sales:people', 'update:state', 'update:check', 'update:install', 'pos:kots', 'pos:kotAgain', 'print:retry', 'pos:printBill', 'sales:list', 'sync:now', 'data:refresh', 'status', 'setup:get', 'setup:test-site',
  'setup:test-print', 'setup:save', 'setup:done', 'app:quit', 'app:fullscreen', 'app:logs', 'app:zoom']);
const EVENTS = new Set(['status', 'catalog-changed', 'running-changed', 'zoom', 'print-error', 'update']);

contextBridge.exposeInMainWorld('rojey', {
  call: (ch, ...args) => (CALLS.has(ch) ? ipcRenderer.invoke(ch, ...args) : Promise.reject(new Error('unknown call ' + ch))),
  on: (ev, cb) => { if (EVENTS.has(ev)) ipcRenderer.on(ev, (_e, d) => cb(d)); },
});
