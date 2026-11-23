(function () {
  const { $ } = RJ; const api = window.rojey;
  let mode = 'pass';
  function setMode(m) {
    mode = m;
    $('#tab_pass').classList.toggle('rj-on', m === 'pass'); $('#tab_pin').classList.toggle('rj-on', m === 'pin');
    $('#f_pass').style.display = m === 'pass' ? '' : 'none'; $('#f_pin').style.display = m === 'pin' ? '' : 'none';
    (m === 'pass' ? $('#email') : $('#pin')).focus();
    try { localStorage.setItem('rj-login-mode', m); } catch {}
  }
  $('#tab_pass').onclick = () => setMode('pass');
  $('#tab_pin').onclick = () => setMode('pin');
  $('#pinpad').innerHTML = [1,2,3,4,5,6,7,8,9,'C',0,'⌫'].map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('');
  $('#pinpad').onclick = (e) => {
    const k = e.target.dataset.k; if (k == null) return;
    const p = $('#pin');
    if (k === 'C') p.value = ''; else if (k === '⌫') p.value = p.value.slice(0, -1); else if (p.value.length < 4) p.value += k;
    if (p.value.length === 4) go();
  };
  let busy = false;
  async function go(e) {
    if (e) e.preventDefault();
    if (busy) return;
    const creds = mode === 'pin' ? { pin: $('#pin').value.trim() } : { email: $('#email').value.trim(), password: $('#password').value };
    $('#err').textContent = ''; busy = true;
    document.querySelectorAll('.rj-primary').forEach((b) => { b.disabled = true; b.textContent = 'Signing in…'; });
    const r = await api.call('auth:login', creds);
    busy = false;
    document.querySelectorAll('.rj-primary').forEach((b) => { b.disabled = false; b.textContent = 'Sign in'; });
    if (!r.ok) { $('#err').textContent = r.error; if (mode === 'pin') $('#pin').value = ''; return; }
    api.call('nav', 'pos');
  }
  $('#f_pass').onsubmit = go; $('#f_pin').onsubmit = go;
  $('#settings').onclick = async (e) => { e.preventDefault(); const r = await api.call('nav', 'setup'); if (r.ok === false) $('#err').textContent = 'Sign in as an admin, then open Settings from the POS screen.'; };
  $('#quit').onclick = (e) => { e.preventDefault(); api.call('app:quit'); };
  function status(st) {
    if (!st) return;
    $('#dot').classList.toggle('on', !!st.online);
    $('#net').textContent = st.online ? 'Online' : 'Offline: you can still sign in and sell';
    const w = (st.pending || 0) + (st.legacyPending || 0);
    $('#pending').textContent = w ? w + ' waiting to upload' : '';
  }
  api.on('status', status);
  api.call('app:state').then((s) => {
    status(s.status);
    $('#outlet').textContent = s.outletName ? s.outletName + ' · sign in' : 'Sign in';
    if (!s.hasData) $('#err').textContent = s.online ? '' : 'First sign-in needs internet to download the menu.';
    let m = 'pass'; try { m = localStorage.getItem('rj-login-mode') || 'pass'; } catch {}
    setMode(m);
  });
})();
