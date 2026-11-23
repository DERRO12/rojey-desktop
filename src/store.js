// Settings (plain JSON) and sign-ins (encrypted with Windows DPAPI through Electron safeStorage).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  baseUrl: '',
  receiptPrinter: '',
  kitchenPrinter: '',      // used for any kitchen without its own printer
  kitchenPrinters: {},     // { "<kitchen id>": "Windows printer name" or ["printer 1", "printer 2"] }
  paperWidth: '80',        // '80' or '58' (mm)
  autoPrintReceipt: true,
  kotCopies: 1,
  receiptCopies: 1,
  keepSyncedDays: 12,      // uploaded orders (and their KOT copies) are deleted from this computer after this many days
  autoOpenRegister: true,  // open the register on the website by itself when an upload needs it
  counterId: '',
  startFullscreen: false,
  taxesOn: false,          // taxes (VAT) are added only when an admin turns them on here or on the website
  autoUpdate: true,        // download new versions from GitHub by themselves; an admin installs them
  updateRepo: 'DERRO12/rojey-desktop',
  zoomLevel: null,         // screen size, changed with Ctrl + / Ctrl - (null: chosen from the screen size)
  terminalCode: '',
};

class Store {
  constructor(dir, safeStorage) {
    this.dir = dir;
    this.safe = safeStorage;
    this.cfgPath = path.join(dir, 'config.json');
    this.secPath = path.join(dir, 'secure.bin');
    this.cfg = { ...DEFAULTS, ...this._readJson(this.cfgPath) };
    // 2.4: uploaded data is kept 12 days (was 2)
    if (!this.cfg.keep12) { if (Number(this.cfg.keepSyncedDays) === 2) this.cfg.keepSyncedDays = 12; this.cfg.keep12 = true; this.saveConfig({}); }
    if (!this.cfg.terminalCode) {
      this.cfg.terminalCode = 'D' + crypto.randomBytes(1).toString('hex').slice(0, 1).toUpperCase();
      this.saveConfig({});
    }
    this.sec = this._readSecure();
    this.sec.accounts = this.sec.accounts || {};   // identity -> { userId, salt, hash, secret, name, role, designation, savedAt }
  }

  _readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }

  _readSecure() {
    try {
      const raw = fs.readFileSync(this.secPath);
      const txt = this.safe && this.safe.isEncryptionAvailable() ? this.safe.decryptString(raw) : raw.toString('utf8');
      return JSON.parse(txt);
    } catch { return {}; }
  }

  _atomicWrite(p, data) {
    const tmp = p + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, p);
  }

  saveConfig(patch) {
    this.cfg = { ...this.cfg, ...patch };
    this._atomicWrite(this.cfgPath, JSON.stringify(this.cfg, null, 2));
  }

  saveSecure() {
    const txt = JSON.stringify(this.sec);
    const data = this.safe && this.safe.isEncryptionAvailable() ? this.safe.encryptString(txt) : Buffer.from(txt, 'utf8');
    this._atomicWrite(this.secPath, data);
  }

  static identity(creds) {
    if (creds.pin) return { id: 'pin:' + Store.hash(String(creds.pin), 'rojey-pin-key').slice(0, 24), secret: String(creds.pin) };
    return { id: 'email:' + String(creds.email || '').trim().toLowerCase(), secret: String(creds.password || '') };
  }

  static hash(secret, salt) { return crypto.scryptSync(secret, salt, 32).toString('hex'); }

  remember(creds, info) {
    const { id, secret } = Store.identity(creds);
    if (!secret) return null;
    const salt = crypto.randomBytes(16).toString('hex');
    this.sec.accounts[id] = { ...(this.sec.accounts[id] || {}), ...info, salt, hash: Store.hash(secret, salt), creds, savedAt: Date.now() };
    this.saveSecure();
    return id;
  }

  check(creds) {
    const { id, secret } = Store.identity(creds);
    const a = this.sec.accounts[id];
    if (!a || !secret) return null;
    const x = Buffer.from(Store.hash(secret, a.salt), 'hex');
    const y = Buffer.from(a.hash, 'hex');
    if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return null;
    return { id, ...a };
  }

  forget(id) { delete this.sec.accounts[id]; this.saveSecure(); }

  accountForUser(userId) {
    let best = null;
    for (const [id, a] of Object.entries(this.sec.accounts)) {
      if (String(a.userId) === String(userId) && (!best || (a.savedAt || 0) > (best.savedAt || 0))) best = { id, ...a };
    }
    return best;
  }

  anyAccount() {
    let best = null;
    for (const [id, a] of Object.entries(this.sec.accounts)) if (!a.broken && (!best || (a.savedAt || 0) > (best.savedAt || 0))) best = { id, ...a };
    return best;
  }

  markBroken(id, broken) {
    if (!this.sec.accounts[id]) return;
    this.sec.accounts[id].broken = broken ? Date.now() : 0;
    this.saveSecure();
  }
}

module.exports = { Store, DEFAULTS };
