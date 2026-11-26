// Automatic updates from GitHub releases (github.com/DERRO12/rojey-desktop).
// The newest release's RojeyPOS-Setup-<version>.exe is downloaded in the background and checked
// (size and sha256). An admin installs it with one click: the installer runs silently, keeps all
// data (it lives in %APPDATA%\Rojey POS) and opens the app again.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { net } = require('electron');
const { spawn } = require('child_process');

function newer(a, b) {   // is version a newer than b
  const p = (v) => String(v || '').replace(/^v/i, '').split(/[.-]/).map((x) => Number(x) || 0);
  const x = p(a); const y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

class Updater {
  constructor({ app, getCfg, log, onState }) {
    this.app = app; this.getCfg = getCfg; this.log = log || (() => {}); this.onState = onState || (() => {});
    this.dir = path.join(app.getPath('userData'), 'updates');
    this.state = { status: 'idle', current: app.getVersion(), version: '', notes: '', progress: 0, error: '', checkedAt: 0, portable: !!process.env.PORTABLE_EXECUTABLE_FILE };
    this.file = '';
  }

  api() {
    const repo = this.getCfg().updateRepo || 'DERRO12/rojey-desktop';
    return process.env.ROJEY_UPDATE_API || `https://api.github.com/repos/${repo}/releases/latest`;
  }

  set(patch) { this.state = { ...this.state, ...patch }; this.onState(this.state); }

  async check() {
    if (this.busy) return this.state;
    if (this.getCfg().autoUpdate === false && !this.forced) return this.state;
    this.busy = true;
    try {
      if (this.state.status !== 'ready') this.set({ status: 'checking', error: '' });
      const res = await net.fetch(this.api(), { headers: { 'User-Agent': 'RojeyPOS', Accept: 'application/vnd.github+json' } });
      if (res.status === 404) { this.set({ status: 'idle', checkedAt: Date.now(), error: '' }); return this.state; }   // no release yet
      if (!res.ok) throw new Error('GitHub answered ' + res.status);
      const rel = await res.json();
      const version = String(rel.tag_name || rel.name || '').replace(/^v/i, '');
      if (!version || !newer(version, this.app.getVersion())) { this.set({ status: this.state.status === 'ready' ? 'ready' : 'uptodate', checkedAt: Date.now() }); return this.state; }
      const asset = (rel.assets || []).find((a) => /^RojeyPOS-Setup-.*\.exe$/i.test(a.name));
      if (!asset) throw new Error('release ' + version + ' has no Setup .exe');
      const file = path.join(this.dir, asset.name);
      if (this.state.status === 'ready' && this.state.version === version && fs.existsSync(file)) return this.state;
      const sha = (/sha256:([0-9a-f]{64})/i.exec(asset.digest || '') || /sha256[:\s]+([0-9a-f]{64})/i.exec(rel.body || '') || [])[1] || '';
      this.set({ status: 'downloading', version, notes: String(rel.body || '').slice(0, 2000), progress: 0 });
      await this.download(asset.browser_download_url, file, Number(asset.size) || 0, sha.toLowerCase());
      this.file = file;
      this.set({ status: 'ready', progress: 100, checkedAt: Date.now() });
      this.log('update ' + version + ' downloaded and checked');
    } catch (e) {
      this.log('update check failed: ' + e.message);
      this.set({ status: this.state.status === 'ready' ? 'ready' : 'error', error: e.message, checkedAt: Date.now() });
    } finally { this.busy = false; this.forced = false; }
    return this.state;
  }

  async download(url, file, size, sha) {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) if (path.join(this.dir, f) !== file) { try { fs.unlinkSync(path.join(this.dir, f)); } catch { /* */ } }
    const res = await net.fetch(url, { headers: { 'User-Agent': 'RojeyPOS' } });
    if (!res.ok || !res.body) throw new Error('download failed (' + res.status + ')');
    const tmp = file + '.part';
    const out = fs.createWriteStream(tmp);
    const hash = crypto.createHash('sha256');
    let got = 0; let lastPct = -1;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      hash.update(buf); got += buf.length;
      if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
      const pct = size ? Math.floor((got / size) * 100) : 0;
      if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; this.set({ progress: pct }); }
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    if (size && got !== size) { fs.unlinkSync(tmp); throw new Error('download incomplete (' + got + ' of ' + size + ' bytes)'); }
    const digest = hash.digest('hex');
    if (sha && digest !== sha) { fs.unlinkSync(tmp); throw new Error('download damaged (checksum does not match)'); }
    fs.renameSync(tmp, file);
  }

  canInstall() { return this.state.status === 'ready' && !this.state.portable && !this.installing && !!this.file && fs.existsSync(this.file); }

  // Runs the checked installer silently. reopen: close the app now and open the new version afterwards;
  // otherwise (the app is closing anyway) just install.
  install(reopen = true, why = 'admin') {
    if (this.state.status !== 'ready' || !this.file || !fs.existsSync(this.file)) return { ok: false, error: 'No update is ready yet' };
    if (this.state.portable) return { ok: false, error: 'This is the portable copy. Install Rojey POS with the Setup file to get automatic updates.' };
    if (this.installing) return { ok: true };
    this.installing = true;
    this.log('installing update ' + this.state.version + ' (' + why + ')');
    if (process.platform !== 'win32' || process.env.ROJEY_UPDATE_DRYRUN) { this.log('update install (dry run): ' + this.file); this.installing = false; this.dryRuns = (this.dryRuns || 0) + 1; return { ok: true, dryRun: true }; }
    const child = spawn(this.file, reopen ? ['/S', '/RUN'] : ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    if (reopen) setTimeout(() => this.app.quit(), 300);
    return { ok: true };
  }

  start() {
    setTimeout(() => this.check(), Number(process.env.ROJEY_UPDATE_FIRST_MS) || 20000);
    setInterval(() => this.check(), Number(process.env.ROJEY_UPDATE_MS) || 10 * 60 * 1000).unref();
  }
}

module.exports = { Updater, newer };
