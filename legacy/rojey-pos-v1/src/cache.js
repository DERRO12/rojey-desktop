// Disk cache for pages, scripts, styles and images of the POS website.
// Each entry is two files: <hash>.body (raw bytes) and <hash>.json (status, headers, time).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEEP_HEADERS = ['content-type', 'content-language', 'last-modified', 'etag'];

class DiskCache {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  key(url) {
    return crypto.createHash('sha1').update(url).digest('hex');
  }

  async get(url) {
    const k = this.key(url);
    try {
      const meta = JSON.parse(await fs.promises.readFile(path.join(this.dir, k + '.json'), 'utf8'));
      const body = await fs.promises.readFile(path.join(this.dir, k + '.body'));
      return { ...meta, body };
    } catch {
      return null;
    }
  }

  async put(url, status, headers, body) {
    const k = this.key(url);
    const kept = {};
    for (const h of KEEP_HEADERS) {
      const v = headers.get ? headers.get(h) : headers[h];
      if (v) kept[h] = v;
    }
    const meta = { url, status, headers: kept, savedAt: Date.now() };
    // Write body first, then meta, each via a temp file, so a crash never leaves a half entry.
    const bodyPath = path.join(this.dir, k + '.body');
    const metaPath = path.join(this.dir, k + '.json');
    const tmp = '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    await fs.promises.writeFile(bodyPath + tmp, body);
    await fs.promises.rename(bodyPath + tmp, bodyPath);
    await fs.promises.writeFile(metaPath + tmp, JSON.stringify(meta));
    await fs.promises.rename(metaPath + tmp, metaPath);
  }

  clear() {
    for (const f of fs.readdirSync(this.dir)) {
      try { fs.unlinkSync(path.join(this.dir, f)); } catch { /* ignore */ }
    }
  }
}

module.exports = { DiskCache };
