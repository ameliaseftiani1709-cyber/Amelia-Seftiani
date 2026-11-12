/* =====================================================================
   LabInventory — frontend (HTML/CSS/JS murni) yang terhubung ke REST API (/api/*).
   Halaman: index.html (login), admin.html, staff.html — logika bersama di file ini.
   ===================================================================== */
(() => {
'use strict';

const TOKEN_KEY = 'lims_token';
const API_BASE = window.LIMS_API || '';                 // kosong = server yang sama
const PAGE = window.LIMS_PAGE || 'login';               // 'login' | 'admin' | 'staff'
const PAGE_ROLE = { admin: 'ADMIN', staff: 'STAFF' };
const homeFor = u => (u.role === 'ADMIN' ? 'admin.html' : 'staff.html');

/* ---------- Utilitas ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const fmtTs = iso => iso ? new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

/* ---------- Klien API ---------- */
async function http(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw Object.assign(new Error('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.'), { network: true });
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* bukan JSON */ }
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    localStorage.removeItem(TOKEN_KEY);
    if (PAGE !== 'login') location.href = 'index.html';
    throw Object.assign(new Error((data && data.error) || 'Sesi berakhir. Silakan login kembali.'), { status: 401 });
  }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `Terjadi kesalahan (${res.status}).`), { status: res.status });
  return data;
}

const api = {
  login: async (username, password) => {
    const r = await http('POST', '/api/auth/login', { username, password });
    localStorage.setItem(TOKEN_KEY, r.token); return r.user;
  },
  me: async () => (await http('GET', '/api/auth/me')).user,
  logout: () => localStorage.removeItem(TOKEN_KEY),
  saveItem: (d, id) => (id ? http('PUT', `/api/items/${encodeURIComponent(id)}`, d) : http('POST', '/api/items', d)),
  deleteItem: id => http('DELETE', `/api/items/${encodeURIComponent(id)}`),
  borrow: d => http('POST', '/api/transactions', d),
  returnItem: id => http('POST', `/api/transactions/${encodeURIComponent(id)}/return`),
  saveUser: (d, id) => (id ? http('PUT', `/api/users/${encodeURIComponent(id)}`, { name: d.name, password: d.password }) : http('POST', '/api/users', d)),
  setActive: (id, active) => http('PATCH', `/api/users/${encodeURIComponent(id)}/active`, { active }),
};

/* Data yang dimuat dari server untuk halaman yang sedang dibuka */
const state = { dash: null, items: [], transactions: [], active: [], users: [] };

async function loadData(route) {
  const get = p => http('GET', p);
  switch (route) {
    case 'dashboard': state.dash = await get('/api/dashboard'); break;
    case 'barang': state.items = (await get('/api/items')).items; break;
    case 'peminjaman': {
      const [i, t] = await Promise.all([get('/api/items'), get('/api/transactions')]);
      state.items = i.items; state.transactions = t.transactions; break;
    }
    case 'pengembalian': state.active = (await get('/api/transactions?view=active')).transactions; break;
    case 'riwayat': state.transactions = (await get('/api/transactions')).transactions; break;
    case 'pengguna': state.users = (await get('/api/users')).users; break;
  }
}

/* ---------- Komponen UI kecil ---------- */
function toast(msg, isErr = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : ''); el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 3200);
}

function modal(title, body, { onSubmit, submitText = 'Simpan', danger = false } = {}) {
  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>
    <form novalidate>${body}<p class="form-error" hidden></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-close>Batal</button>
    <button class="btn ${danger ? 'danger' : 'primary'}">${esc(submitText)}</button></div></form></div>`;
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  el.addEventListener('mousedown', e => { if (e.target === el) close(); });
  $('[data-close]', el).onclick = close;
  $('form', el).onsubmit = async e => {
    e.preventDefault();
    const btn = $('.modal-actions .btn:last-child', el), err = $('.form-error', el);
    err.hidden = true; btn.disabled = true;
    try { if (onSubmit) await onSubmit(Object.fromEntries(new FormData(e.target))); close(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  };
  document.body.appendChild(el);
  const first = $('input:not([disabled]),select', el); if (first) first.focus();
  return el;
}

const statusBadge = s => `<span class="badge ${s === 'Dipinjam' ? 'warn' : 'ok'}">${esc(s)}</span>`;
const emptyRow = (cols, text) => `<tr><td class="empty" colspan="${cols}">${esc(text)}</td></tr>`;

/* ---------- Navigasi per role ---------- */
const ROUTES = {
  dashboard:    { label: 'Dashboard',    ico: '📊', roles: ['ADMIN', 'STAFF'] },
  barang:       { label: 'Data Barang',  ico: '📦', roles: ['ADMIN', 'STAFF'] },
  peminjaman:   { label: 'Peminjaman',   ico: '📝', roles: ['ADMIN', 'STAFF'] },
  pengembalian: { label: 'Pengembalian', ico: '↩️', roles: ['ADMIN', 'STAFF'] },
  riwayat:      { label: 'Riwayat',      ico: '🕘', roles: ['ADMIN', 'STAFF'] },
  pengguna:     { label: 'Pengguna',     ico: '👥', roles: ['ADMIN'] },
};

/* ---------- Views ---------- */
const views = {};

views.dashboard = user => {
  const s = state.dash.stats;
  const events = [];
  state.dash.transactions.forEach(t => {
    events.push({ at: t.createdAt, text: `<b>${esc(t.borrower)}</b> meminjam ${t.qty}× ${esc(t.itemName)}`, by: t.createdByName, kind: 'Dipinjam' });
    if (t.status === 'Selesai') events.push({ at: t.returnedAt || t.createdAt, text: `<b>${esc(t.borrower)}</b> mengembalikan ${t.qty}× ${esc(t.itemName)}`, by: t.returnedByName || t.createdByName, kind: 'Selesai' });
  });
  events.sort((a, b) => (a.at < b.at ? 1 : -1));
  const feed = events.slice(0, 7).map(e =>
    `<li><div>${e.text}<div class="when">oleh ${esc(e.by || '-')} · ${fmtTs(e.at)}</div></div>${statusBadge(e.kind)}</li>`).join('');
  return {
    html: `
    <div class="page-head"><div><h2>Dashboard</h2><p>${user.role === 'ADMIN' ? 'Ringkasan seluruh aktivitas laboratorium' : 'Ringkasan aktivitas operasional laboratorium'}</p></div></div>
    <div class="stats">
      <div class="stat"><div class="lb">Total Barang</div><div class="vl">${s.totalUnits}</div><div class="sb">${s.itemTypes} jenis barang</div></div>
      <div class="stat ok"><div class="lb">Barang Tersedia</div><div class="vl">${s.available}</div><div class="sb">unit siap dipinjam</div></div>
      <div class="stat warn"><div class="lb">Barang Dipinjam</div><div class="vl">${s.borrowed}</div><div class="sb">unit sedang keluar</div></div>
      <div class="stat vio"><div class="lb">Total Transaksi</div><div class="vl">${s.totalTransactions}</div><div class="sb">${s.activeTransactions} masih aktif</div></div>
    </div>
    <div class="card"><h3>Aktivitas Terbaru${user.role === 'STAFF' ? ' Anda' : ''}</h3>
      <ul class="feed">${feed || '<li class="empty" style="display:block">Belum ada aktivitas.</li>'}</ul></div>`,
  };
};

views.barang = user => {
  const admin = user.role === 'ADMIN';
  const cats = [...new Set(state.items.map(i => i.category))].sort();
  const html = `
    <div class="page-head"><div><h2>Data Barang</h2><p>${admin ? 'Kelola inventaris laboratorium' : 'Lihat daftar dan ketersediaan barang'}</p></div>
      ${admin ? '<button class="btn primary" id="add-item">+ Tambah Barang</button>' : ''}</div>
    <div class="card">
      <div class="toolbar">
        <input class="search" id="q" type="search" placeholder="Cari kode, nama, atau kategori…">
        <select id="cat"><option value="">Semua kategori</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Kode</th><th>Nama Barang</th><th>Kategori</th><th class="num">Stok</th><th class="num">Dipinjam</th><th class="num">Tersedia</th><th>Status</th>${admin ? '<th></th>' : ''}</tr></thead>
        <tbody id="tbody"></tbody></table></div></div>`;
  const mount = root => {
    const draw = () => {
      const q = $('#q', root).value.trim().toLowerCase(), cat = $('#cat', root).value;
      const rows = state.items.filter(i => (!cat || i.category === cat) && (!q || [i.code, i.name, i.category].some(v => v.toLowerCase().includes(q))))
        .map(i => {
          const st = i.available === 0 ? '<span class="badge bad">Habis</span>' : i.available <= 2 ? '<span class="badge warn">Terbatas</span>' : '<span class="badge ok">Tersedia</span>';
          return `<tr><td class="mono">${esc(i.code)}</td><td>${esc(i.name)}</td><td>${esc(i.category)}</td>
            <td class="num">${i.stock}</td><td class="num">${i.borrowed}</td><td class="num"><b>${i.available}</b></td><td>${st}</td>
            ${admin ? `<td class="act"><button class="btn sm" data-edit="${esc(i.id)}">Edit</button><button class="btn sm danger" data-del="${esc(i.id)}">Hapus</button></td>` : ''}</tr>`;
        }).join('');
      $('#tbody', root).innerHTML = rows || emptyRow(admin ? 8 : 7, 'Barang tidak ditemukan.');
    };
    $('#q', root).oninput = draw; $('#cat', root).onchange = draw; draw();
    if (!admin) return;
    const form = (it = {}) => `
      <div class="row2"><div class="field"><label>Kode</label><input name="code" value="${esc(it.code || '')}" placeholder="BR027" required></div>
      <div class="field"><label>Stok (total unit)</label><input name="stock" type="number" min="0" value="${it.stock ?? ''}" required></div></div>
      <div class="field"><label>Nama Barang</label><input name="name" value="${esc(it.name || '')}" required></div>
      <div class="field"><label>Kategori</label><input name="category" list="cats" value="${esc(it.category || '')}" required>
      <datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>`;
    $('#add-item', root).onclick = () => modal('Tambah Barang', form(), { onSubmit: async d => { await api.saveItem(d); toast('Barang ditambahkan.'); go(); } });
    root.addEventListener('click', e => {
      const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
      if (ed) {
        const it = state.items.find(i => i.id === ed.dataset.edit);
        modal('Edit Barang', form(it), { onSubmit: async d => { await api.saveItem(d, it.id); toast('Barang diperbarui.'); go(); } });
      }
      if (del) {
        const it = state.items.find(i => i.id === del.dataset.del);
        modal('Hapus Barang', `<p>Hapus <b>${esc(it.name)}</b> (${esc(it.code)})? Tindakan ini tidak dapat dibatalkan.</p>`,
          { submitText: 'Hapus', danger: true, onSubmit: async () => { await api.deleteItem(it.id); toast('Barang dihapus.'); go(); } });
      }
    });
  };
  return { html, mount };
};

views.peminjaman = user => {
  const avail = state.items.filter(i => i.available > 0);
  const recent = state.transactions.slice(0, 8);
  const html = `
    <div class="page-head"><div><h2>Peminjaman Barang</h2><p>Catat transaksi peminjaman baru</p></div></div>
    <div class="grid2">
      <div class="card"><h3>Form Peminjaman</h3>
        <form id="borrow-form" novalidate>
          <div class="field"><label>Nama Peminjam</label><input name="borrower" placeholder="Nama peminjam / kelas" required></div>
          <div class="field"><label>Barang</label><select name="itemId" id="item-sel" required>
            <option value="">— Pilih barang —</option>
            ${avail.map(i => `<option value="${esc(i.id)}" data-av="${i.available}">${esc(i.code)} · ${esc(i.name)} (tersedia ${i.available})</option>`).join('')}</select></div>
          <div class="row2">
            <div class="field"><label>Jumlah</label><input name="qty" id="qty" type="number" min="1" value="1" required><div class="hint" id="qty-hint"></div></div>
            <div class="field"><label>Tanggal Pinjam</label><input name="date" type="date" value="${today()}" required></div>
          </div>
          <p class="form-error" id="b-err" hidden></p>
          <button class="btn primary block">Simpan Transaksi</button>
        </form></div>
      <div class="card"><h3>Transaksi Terbaru${user.role === 'STAFF' ? ' Anda' : ''}</h3><div class="table-wrap"><table>
        <thead><tr><th>ID</th><th>Peminjam</th><th>Barang</th><th class="num">Jml</th><th>Tanggal</th><th>Status</th></tr></thead>
        <tbody>${recent.map(t => `<tr><td class="mono">${esc(t.id)}</td><td>${esc(t.borrower)}</td><td>${esc(t.itemName)}</td><td class="num">${t.qty}</td><td>${fmtDate(t.borrowDate)}</td><td>${statusBadge(t.status)}</td></tr>`).join('') || emptyRow(6, 'Belum ada transaksi.')}</tbody>
      </table></div></div>
    </div>`;
  const mount = root => {
    const sel = $('#item-sel', root), qty = $('#qty', root), hint = $('#qty-hint', root);
    sel.onchange = () => { const o = sel.selectedOptions[0]; const av = o && o.dataset.av; qty.max = av || ''; hint.textContent = av ? `Maksimal ${av} unit` : ''; };
    $('#borrow-form', root).onsubmit = async e => {
      e.preventDefault();
      const btn = $('#borrow-form .btn', root), p = $('#b-err', root);
      p.hidden = true; btn.disabled = true;
      try {
        const r = await api.borrow(Object.fromEntries(new FormData(e.target)));
        toast(`Transaksi ${r.transaction.id} tersimpan.`); go();
      } catch (err) { p.textContent = err.message; p.hidden = false; btn.disabled = false; }
    };
  };
  return { html, mount };
};

views.pengembalian = () => {
  const active = state.active;
  const html = `
    <div class="page-head"><div><h2>Pengembalian Barang</h2><p>${active.length} transaksi sedang dipinjam</p></div></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Peminjam</th><th>Barang</th><th class="num">Jumlah</th><th>Tgl Pinjam</th><th>Dicatat Oleh</th><th></th></tr></thead>
      <tbody>${active.map(t => `<tr><td class="mono">${esc(t.id)}</td><td>${esc(t.borrower)}</td><td>${esc(t.itemName)} <span class="mono" style="color:var(--muted)">${esc(t.itemCode)}</span></td>
        <td class="num">${t.qty}</td><td>${fmtDate(t.borrowDate)}</td><td>${esc(t.createdByName)}</td>
        <td class="act"><button class="btn sm primary" data-ret="${esc(t.id)}">Kembalikan</button></td></tr>`).join('') || emptyRow(7, 'Tidak ada barang yang sedang dipinjam. 🎉')}</tbody>
    </table></div></div>`;
  const mount = root => root.addEventListener('click', e => {
    const b = e.target.closest('[data-ret]'); if (!b) return;
    const t = state.active.find(x => x.id === b.dataset.ret);
    modal('Proses Pengembalian', `<p><b>${esc(t.borrower)}</b> mengembalikan <b>${t.qty}× ${esc(t.itemName)}</b>?</p><p class="hint">Stok akan diperbarui dan status transaksi menjadi Selesai.</p>`,
      { submitText: 'Konfirmasi', onSubmit: async () => { await api.returnItem(t.id); toast(`${t.id} selesai, stok diperbarui.`); go(); } });
  });
  return { html, mount };
};

views.riwayat = user => {
  const admin = user.role === 'ADMIN';
  const html = `
    <div class="page-head"><div><h2>Riwayat Transaksi</h2><p>${admin ? 'Seluruh riwayat peminjaman dan pengembalian' : 'Riwayat transaksi yang Anda catat'}</p></div></div>
    <div class="card"><div class="toolbar">
      <input class="search" id="q" type="search" placeholder="Cari peminjam, barang, atau ID…">
      <select id="st"><option value="">Semua status</option><option>Dipinjam</option><option>Selesai</option></select></div>
      <div class="table-wrap"><table>
        <thead><tr><th>ID</th><th>Peminjam</th><th>Barang</th><th class="num">Jml</th><th>Tgl Pinjam</th><th>Tgl Kembali</th><th>Dicatat Oleh</th><th>Status</th></tr></thead>
        <tbody id="tbody"></tbody></table></div></div>`;
  const mount = root => {
    const draw = () => {
      const q = $('#q', root).value.trim().toLowerCase(), st = $('#st', root).value;
      const rows = state.transactions.filter(t => (!st || t.status === st) && (!q || [t.id, t.borrower, t.itemName, t.itemCode].some(v => String(v).toLowerCase().includes(q))))
        .map(t => `<tr><td class="mono">${esc(t.id)}</td><td>${esc(t.borrower)}</td><td>${esc(t.itemName)}</td><td class="num">${t.qty}</td>
          <td>${fmtDate(t.borrowDate)}</td><td>${fmtDate(t.returnDate)}</td><td>${esc(t.createdByName)}</td><td>${statusBadge(t.status)}</td></tr>`).join('');
      $('#tbody', root).innerHTML = rows || emptyRow(8, 'Tidak ada transaksi.');
    };
    $('#q', root).oninput = draw; $('#st', root).onchange = draw; draw();
  };
  return { html, mount };
};

views.pengguna = () => {
  const form = (u = {}) => `
    <div class="field"><label>Nama Lengkap</label><input name="name" value="${esc(u.name || '')}" required></div>
    <div class="field"><label>Username</label><input name="username" value="${esc(u.username || '')}" ${u.id ? 'disabled' : ''} placeholder="mis. andi.staff" required></div>
    <div class="field"><label>Password${u.id ? ' baru' : ''}</label><input name="password" type="password" autocomplete="new-password" ${u.id ? '' : 'required'} placeholder="${u.id ? 'Kosongkan jika tidak diubah' : 'Minimal 6 karakter'}"></div>`;
  const html = `
    <div class="page-head"><div><h2>Manajemen Pengguna</h2><p>Kelola akun Staff laboratorium</p></div><button class="btn primary" id="add-user">+ Tambah Staff</button></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Nama</th><th>Username</th><th>Role</th><th>Dibuat</th><th>Status</th><th></th></tr></thead>
      <tbody>${state.users.map(u => `<tr><td>${esc(u.name)}</td><td class="mono">${esc(u.username)}</td>
        <td><span class="badge info">${esc(u.role)}</span></td><td>${fmtTs(u.createdAt)}</td>
        <td>${u.active ? '<span class="badge ok">Aktif</span>' : '<span class="badge bad">Nonaktif</span>'}</td>
        <td class="act"><button class="btn sm" data-edit="${esc(u.id)}">Edit</button>
        ${u.role === 'ADMIN' ? '' : `<button class="btn sm" data-tog="${esc(u.id)}">${u.active ? 'Nonaktifkan' : 'Aktifkan'}</button>`}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
  const mount = root => {
    $('#add-user', root).onclick = () => modal('Tambah Akun Staff', form(), { onSubmit: async d => { await api.saveUser(d); toast('Akun Staff dibuat.'); go(); } });
    root.addEventListener('click', async e => {
      const ed = e.target.closest('[data-edit]'), tg = e.target.closest('[data-tog]');
      if (ed) {
        const u = state.users.find(x => x.id === ed.dataset.edit);
        modal('Edit Pengguna', form(u), { onSubmit: async d => { await api.saveUser(d, u.id); toast('Data pengguna diperbarui.'); go(); } });
      }
      if (tg) {
        const u = state.users.find(x => x.id === tg.dataset.tog);
        try { await api.setActive(u.id, !u.active); toast(`${u.name} ${u.active ? 'dinonaktifkan' : 'diaktifkan'}.`); go(); }
        catch (err) { toast(err.message, true); }
      }
    });
  };
  return { html, mount };
};

/* ---------- Login ---------- */
function renderLogin() {
  $('#app').innerHTML = `
    <div class="login-wrap"><div class="login-card">
      <div class="brand"><div class="brand-mark">🔬</div>LabInventory</div>
      <h1>Masuk ke akun Anda</h1><p class="sub">Laboratory Inventory & Borrowing Management System</p>
      <form id="login-form" novalidate>
        <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus></div>
        <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
        <p class="form-error" id="l-err" hidden></p>
        <button class="btn primary block">Masuk</button>
      </form>
      <div class="demo-box"><b>Akun demo</b><br>
        Admin: <code>admin</code> / <code>admin123</code> <button data-fill="admin,admin123">isi</button><br>
        Staff: <code>staff</code> / <code>staff123</code> <button data-fill="staff,staff123">isi</button></div>
    </div></div>`;
  $('#login-form').onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const btn = $('#login-form .btn'), p = $('#l-err');
    p.hidden = true; btn.disabled = true;
    try { const u = await api.login(d.username, d.password); location.href = homeFor(u); }
    catch (err) { p.textContent = err.message; p.hidden = false; btn.disabled = false; }
  };
  document.querySelectorAll('[data-fill]').forEach(b => b.onclick = () => {
    const [u, p] = b.dataset.fill.split(','); $('#u').value = u; $('#p').value = p;
  });
}

function renderFatal(msg) {
  $('#app').innerHTML = `
    <div class="login-wrap"><div class="login-card">
      <div class="brand"><div class="brand-mark">🔬</div>LabInventory</div>
      <h1>Gagal memuat data</h1><p class="sub">${esc(msg)}</p>
      <button class="btn primary block" id="retry">Coba lagi</button>
    </div></div>`;
  $('#retry').onclick = () => render();
}

/* ---------- Layout & router ---------- */
function currentRoute(user) {
  const r = (location.hash.replace(/^#\/?/, '') || 'dashboard');
  return ROUTES[r] && ROUTES[r].roles.includes(user.role) ? r : 'dashboard';
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  if (!$('#app').innerHTML) $('#app').innerHTML = '<div class="login-wrap"><div class="login-card"><p class="sub" style="margin:0">Memuat…</p></div></div>';

  let user = null;
  try { if (localStorage.getItem(TOKEN_KEY)) user = await api.me(); }
  catch (e) {
    if (e.network && PAGE !== 'login') { if (seq === renderSeq) renderFatal(e.message); return; }
    user = null;                                    // token kedaluwarsa / tidak valid
  }
  if (seq !== renderSeq) return;

  if (PAGE === 'login') { if (user) { location.href = homeFor(user); return; } renderLogin(); return; }
  if (!user) { location.href = 'index.html'; return; }                       // belum login
  if (user.role !== PAGE_ROLE[PAGE]) { location.href = homeFor(user); return; } // salah halaman

  const route = currentRoute(user);
  try { await loadData(route); }
  catch (e) { if (e.status !== 401 && seq === renderSeq) renderFatal(e.message); return; }
  if (seq !== renderSeq) return;

  const view = views[route](user);
  const nav = Object.entries(ROUTES).filter(([, r]) => r.roles.includes(user.role))
    .map(([k, r]) => `<a href="#/${k}" class="${k === route ? 'active' : ''}"><span class="ico">${r.ico}</span>${r.label}</a>`).join('');
  $('#app').innerHTML = `
    <div class="topbar-m"><button id="menu" aria-label="Menu">☰</button><b>LabInventory</b></div>
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><div class="brand-mark">🔬</div>LabInventory</div>
        <nav class="nav">${nav}</nav>
        <div class="userbox"><div class="nm">${esc(user.name)}</div><div class="rl">${user.role === 'ADMIN' ? 'Admin' : 'Staff'} · @${esc(user.username)}</div>
          <button class="btn" id="logout">Keluar</button></div>
      </aside>
      <main class="main" id="main">${view.html}</main>
    </div>`;
  if (view.mount) view.mount($('#main'));
  $('#logout').onclick = () => { api.logout(); location.href = 'index.html'; };
  $('#menu').onclick = () => $('#sidebar').classList.toggle('open');
  $('#sidebar').addEventListener('click', e => { if (e.target.closest('a')) $('#sidebar').classList.remove('open'); });
}

const go = () => render();
window.addEventListener('hashchange', render);
render();
})();
