// Runs in receipt / kitchen ticket popups. Their print() goes to the configured printer.
const { ipcRenderer } = require('electron');
const send = () => ipcRenderer.send('rojey-print');
window.print = send;
document.addEventListener('DOMContentLoaded', () => { window.print = send; });
