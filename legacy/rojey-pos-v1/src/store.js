// Settings (plain JSON) and secrets (encrypted with Windows DPAPI through Electron safeStorage).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  baseUrl: '',
  receiptPrinter: '',
  kitchenPrinter: '',
  kitchenPrinters: {},       // { "Bar": "EPSON TM-T20 (Bar)" }
  autoPrint: true,
  rememberLogin: true,
  startFullscreen: false,
  oneTapKot: true,
  kotItems: 'new',          // 'new' = only items not yet sent to the kitchen, 'all' = whole order
};

class Store {
  constructor(dir, safeStorage) {
    this.dir = dir;
    this.safe = safeStorage;
    this.cfgPath = path.join(dir, 'config.json');
    this.secPath = path.join(dir, 'secure.bin');
    this.cfg = { ...DEFAULTS, ...this._readJson(this.cfgPath) };
    this.sec = this._readSecure();
    this.sec.offlineUsers = this.sec.offlineUsers || {};
  }

  _readJson(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
  }

  _readSecure() {
    try {
      const raw = fs.readFileSync(this.secPath);
      const txt = this.safe && this.safe.isEncryptionAvailable() ? this.safe.decryptString(raw) : raw.toString('utf8');
      return JSON.parse(txt);
    } catch { return {}; }
  }

  _atomicWrite(p, data) {
    fs.writeFileSync(p + '.tmp', data);
    fs.renameSync(p + '.tmp', p);
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

  // ---- offline sign-in -------------------------------------------------
  static identity(form) {
    const usePassword = String(form.active_login_button_hidden || '') === '1' || (form.email_address && form.password);
    if (usePassword) {
      return { id: 'email:' + String(form.email_address || '').trim().toLowerCase(), secret: String(form.password || '') };
    }
    return { id: 'pin', secret: String(form.login_pin || '') };
  }

  static hash(secret, salt) {
    return crypto.scryptSync(secret, salt, 32).toString('hex');
  }

  rememberOfflineUser(form, extra = {}) {
    const { id, secret } = Store.identity(form);
    if (!secret) return null;
    const salt = crypto.randomBytes(16).toString('hex');
    const key = id === 'pin' ? 'pin:' + Store.hash(secret, 'rojey-pin-key') : id;
    const prev = this.sec.offlineUsers[key] || {};
    this.sec.offlineUsers[key] = { ...prev, ...extra, salt, hash: Store.hash(secret, salt), savedAt: Date.now() };
    this.saveSecure();
    return key;
  }

  updateOfflineUser(key, extra) {
    if (!key || !this.sec.offlineUsers[key]) return;
    this.sec.offlineUsers[key] = { ...this.sec.offlineUsers[key], ...extra };
    this.saveSecure();
  }

  checkOfflineUser(form) {
    const { id, secret } = Store.identity(form);
    if (!secret) return null;
    const key = id === 'pin' ? 'pin:' + Store.hash(secret, 'rojey-pin-key') : id;
    const u = this.sec.offlineUsers[key];
    if (!u) return null;
    const a = Buffer.from(Store.hash(secret, u.salt), 'hex');
    const b = Buffer.from(u.hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { key, ...u };
  }
}

module.exports = { Store, DEFAULTS };
