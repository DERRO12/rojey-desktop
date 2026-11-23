// Pure helpers (no Electron) so they can be unit tested.

const STATIC_RE = /\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|eot|mp3|wav|ogg|map)$/i;

// Turn whatever the person typed ("pos.rojeycreamery.com", "https://x.com/pos") into a base URL
// that ends with "/".
function normalizeBaseUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return ''; }
  let p = u.pathname.replace(/\/index\.php.*$/i, '/');
  // Drop a pasted page path such as /Sale/POS or /Authentication/index
  p = p.replace(/\/(Sale|Authentication|Outlet|Register|Dashboard|Kitchen|Waiter)(\/.*)?$/i, '/');
  if (!p.endsWith('/')) p += '/';
  return `${u.protocol}//${u.host}${p}`;
}

// Path of a URL relative to the POS base, e.g. "Sale/push_online".
function relPath(url, base) {
  if (!url.startsWith(base)) return null;
  return url.slice(base.length).split('?')[0].split('#')[0];
}

function isStatic(url) {
  try { return STATIC_RE.test(new URL(url).pathname); } catch { return false; }
}

// Requests that must never be served from cache.
function isNoCache(rel) {
  return /^(Authentication\/(check_internet|loginCheck|logOut)|Sale\/(push_online|add_|set|delete|cancel|update|change|remove|close)|Register\/(addBalance|closeRegister))/i.test(rel || '');
}

function isLoginPost(rel) {
  return /^Authentication\/loginCheck$/i.test(rel || '');
}

function isLogout(rel) {
  return /^Authentication\/logOut/i.test(rel || '');
}

function isOutletEnter(rel) {
  return /^Outlet\/setOutletSession\//i.test(rel || '');
}

// A redirect that means "your session is gone, log in again".
function isSessionLostRedirect(status, location, base) {
  if (status < 300 || status > 399 || !location) return null;
  let loc;
  try { loc = new URL(location, base).toString(); } catch { return null; }
  const rel = relPath(loc, base);
  if (rel === null) return null;
  if (/^Authentication\/index/i.test(rel) || rel === '' || /^Authentication\/?$/i.test(rel)) return 'login';
  if (/^Outlet\/outlets/i.test(rel)) return 'outlet';
  return null;
}

// Which printer a print popup should go to.
function pickPrinter(kind, cfg) {
  if (kind === 'kitchen') return cfg.kitchenPrinter || cfg.receiptPrinter || '';
  return cfg.receiptPrinter || '';
}

module.exports = {
  normalizeBaseUrl, relPath, isStatic, isNoCache, isLoginPost, isLogout,
  isOutletEnter, isSessionLostRedirect, pickPrinter,
};
