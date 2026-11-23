const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  get: () => ipcRenderer.invoke('setup:get'),
  printers: () => ipcRenderer.invoke('setup:printers'),
  testSite: (address) => ipcRenderer.invoke('setup:test-site', address),
  testPrint: (printer, label) => ipcRenderer.invoke('setup:test-print', printer, label),
  pending: () => ipcRenderer.invoke('setup:pending'),
  save: (patch) => ipcRenderer.invoke('setup:save', patch),
});
