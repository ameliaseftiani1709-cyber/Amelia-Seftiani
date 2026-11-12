// app.js — seluruh logika tampilan: login, menu, dan setiap halaman

/* =====================================================
   HELPER
===================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tag = (kode) => `<span class="tag">${esc(kode)}</span>`;
const empty = (text) => `<div class="empty">${text}</div>`;
const state = { user: null };
const isAdmin = () => state.user?.role === 'admin';

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
const toDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v));
const fmtDate = (v) => (v ? toDate(v).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
const daysSince = (v) => Math.max(0, Math.round((toDate(todayISO()) - toDate(v)) / 86400000));
function timeAgo(v) {
  const m = Math.floor((Date.now() - toDate(v)) / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  if (m < 1440) return `${Math.floor(m / 60)} jam lalu`;
  if (m < 10080) return `${Math.floor(m / 1440)} hari lalu`;
  return fmtDate(v);
}

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 3500);
  setTimeout(() => el.remove(), 3900);
}

function setLoading(btn, on, label = 'Memproses…') {
  if (on) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${label}`; }
  else { btn.disabled = false; if (btn.dataset.html) btn.innerHTML = btn.dataset.html; }
}

function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
  setTimeout(() => $('#modal-body input:not([readonly]), #modal-body select, #modal-body button')?.focus(), 30);
  return $('#modal-body');
}
function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal-body').innerHTML = '';
}
function confirmDialog(title, message, okText) {
  return new Promise((resolve) => {
    const body = openModal(title, `<p style="margin-bottom:18px">${message}</p>
      <div class="modal-actions"><button class="btn btn-ghost" data-no>Batal</button><button class="btn btn-danger" data-yes>${esc(okText)}</button></div>`);
    $('[data-no]', body).onclick = () => { closeModal(); resolve(false); };
    $('[data-yes]', body).onclick = () => { closeModal(); resolve(true); };
  });
}

/* =====================================================
   PEMANGGIL API (batas waktu 15 detik, jadi tidak macet)
===================================================== */
const TOKEN_KEY = 'labinv_token';
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* abaikan */ } };

async function api(path, { method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const headers = { 'Content-Type': 'application/json' };
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
  try {
    const res = await fetch(`/api${path}`, { method, headers, signal: ctrl.signal, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/auth/login') { logout(data.error || 'Sesi berakhir, silakan login kembali.'); }
    if (!res.ok) throw new Error(data.error || `Permintaan gagal (kode ${res.status}).`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Server terlalu lama merespons. Coba lagi.');
    if (err instanceof TypeError) throw new Error('Tidak dapat terhubung ke server.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* =====================================================
   HALAMAN: DASHBOARD
===================================================== */
const FEED_ICON = { pinjam: 'ri-hand-coin-line', kembali: 'ri-arrow-go-back-line', barang: 'ri-archive-line', hapus: 'ri-delete-bin-line', pengguna: 'ri-user-line' };

async function dashboard(el) {
  const { stats: s, logs } = await api('/dashboard');
  const pct = s.total ? Math.round((s.tersedia / s.total) * 100) : 0;
  const kpi = (label, value, sub) => `<div class="kpi"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;

  actions(el, '<a class="btn btn-primary" href="#/peminjaman"><i class="ri-add-line"></i> Catat peminjaman</a>');
  el.innerHTML = `
    <div class="kpis">
      ${kpi('Total barang', s.total, `${s.jenis} jenis barang`)}
      ${kpi('Tersedia', s.tersedia, `${pct}% dari total unit`)}
      ${kpi('Dipinjam', s.dipinjam, `${s.aktif} transaksi berjalan`)}
      ${kpi('Total transaksi', s.transaksi, 'semua peminjaman')}
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Aktivitas terbaru</h2><a href="#/riwayat">Lihat riwayat</a></div>
      ${logs.length ? logs.map((l) => `
        <div class="feed-item">
          <span class="feed-icon ${esc(l.aksi)}"><i class="${FEED_ICON[l.aksi] || 'ri-information-line'}"></i></span>
          <div><p>${esc(l.detail)}</p><small>${esc(l.actor_name || 'Sistem')}, ${timeAgo(l.created_at)}</small></div>
        </div>`).join('') : empty('Belum ada aktivitas.')}
    </section>`;
}

/* =====================================================
   HALAMAN: DATA BARANG
===================================================== */
function itemForm(item, items, onSaved) {
  const nums = items.map((i) => /^BR(\d+)$/.exec(i.kode)?.[1]).filter(Boolean).map(Number);
  const nextKode = `BR${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
  const dipinjam = item ? item.stok - item.tersedia : 0;
  const cats = [...new Set(items.map((i) => i.kategori))].sort();

  const body = openModal(item ? 'Ubah barang' : 'Tambah barang', `
    <form class="form">
      <div class="grid-2">
        <label class="field"><span>Kode</span><input name="kode" required maxlength="20" value="${esc(item?.kode ?? nextKode)}" /></label>
        <label class="field"><span>Kategori</span><input name="kategori" required maxlength="50" list="cats" value="${esc(item?.kategori ?? '')}" placeholder="mis. Laptop" />
          <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      </div>
      <label class="field"><span>Nama barang</span><input name="nama" required maxlength="100" value="${esc(item?.nama ?? '')}" /></label>
      <label class="field"><span>Jumlah stok</span><input name="stok" type="number" min="${dipinjam}" required value="${item?.stok ?? 1}" />
        ${dipinjam ? `<small>${dipinjam} unit sedang dipinjam, jadi stok minimal ${dipinjam}.</small>` : ''}</label>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary">Simpan</button></div>
    </form>`);

  const form = $('form', body);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const btn = $('.btn-primary', form);
    setLoading(btn, true, 'Menyimpan…');
    try {
      await api(item ? `/items/${item.id}` : '/items', { method: item ? 'PUT' : 'POST', body: { ...data, stok: Number(data.stok) } });
      toast(item ? 'Barang diperbarui.' : 'Barang ditambahkan.');
      closeModal();
      onSaved();
    } catch (err) { toast(err.message, 'error'); setLoading(btn, false); }
  };
}

async function barang(el) {
  const admin = isAdmin();
  let { items } = await api('/items');
  const status = (i) => (i.tersedia === 0 ? '<span class="badge bad">Habis</span>'
    : i.tersedia <= Math.ceil(i.stok * 0.3) ? '<span class="badge warn">Menipis</span>' : '<span class="badge ok">Tersedia</span>');

  if (admin) actions(el, '<button class="btn btn-primary" id="add-item"><i class="ri-add-line"></i> Tambah barang</button>');
  el.innerHTML = `
    <div class="toolbar">
      <div class="search"><i class="ri-search-line"></i><input id="q" type="search" placeholder="Cari kode, nama, atau kategori" /></div>
      <select id="kat"></select>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Kode</th><th>Nama barang</th><th>Kategori</th><th>Stok</th><th>Tersedia</th><th>Status</th>${admin ? '<th></th>' : ''}</tr></thead>
      <tbody></tbody>
    </table></div>
    <p class="table-foot"></p>`;

  const render = () => {
    const kw = $('#q', el).value.toLowerCase().trim();
    const kat = $('#kat', el).value;
    const rows = items.filter((i) => (!kw || `${i.kode} ${i.nama} ${i.kategori}`.toLowerCase().includes(kw)) && (!kat || i.kategori === kat));
    $('tbody', el).innerHTML = rows.length ? rows.map((i) => `<tr>
      <td>${tag(i.kode)}</td><td><b>${esc(i.nama)}</b></td><td>${esc(i.kategori)}</td>
      <td class="num">${i.stok}</td><td class="num">${i.tersedia}</td><td>${status(i)}</td>
      ${admin ? `<td><div class="actions">
        <button class="icon-btn" data-edit="${i.id}" aria-label="Ubah"><i class="ri-pencil-line"></i></button>
        <button class="icon-btn danger" data-del="${i.id}" aria-label="Hapus"><i class="ri-delete-bin-line"></i></button></div></td>` : ''}
    </tr>`).join('') : `<tr><td colspan="7">${empty('Barang tidak ditemukan.')}</td></tr>`;
    $('.table-foot', el).textContent = `${rows.length} dari ${items.length} barang`;
  };
  const fillKat = () => {
    const cur = $('#kat', el).value;
    $('#kat', el).innerHTML = '<option value="">Semua kategori</option>' +
      [...new Set(items.map((i) => i.kategori))].sort().map((c) => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('');
  };
  const reload = async () => {
    try { ({ items } = await api('/items')); fillKat(); render(); } catch (err) { toast(err.message, 'error'); }
  };

  $('#q', el).oninput = render;
  $('#kat', el).onchange = render;
  if (admin) {
    $('#add-item').onclick = () => itemForm(null, items, reload);
    $('tbody', el).onclick = async (e) => {
      const ed = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');
      if (ed) itemForm(items.find((i) => String(i.id) === ed.dataset.edit), items, reload);
      if (del) {
        const item = items.find((i) => String(i.id) === del.dataset.del);
        if (!(await confirmDialog('Hapus barang?', `<b>${esc(item.nama)}</b> (${esc(item.kode)}) akan dihapus permanen.`, 'Hapus'))) return;
        try { await api(`/items/${item.id}`, { method: 'DELETE' }); toast('Barang dihapus.'); reload(); } catch (err) { toast(err.message, 'error'); }
      }
    };
  }
  fillKat();
  render();
}

/* =====================================================
   HALAMAN: PEMINJAMAN
===================================================== */
async function peminjaman(el) {
  const { items } = await api('/items');
  el.innerHTML = `
    <section class="panel form-panel">
      <form class="form" id="loan-form">
        <label class="field"><span>Nama peminjam</span><input name="peminjam" required maxlength="100" placeholder="Nama lengkap" /></label>
        <label class="field"><span>Barang</span>
          <select name="item_id" required><option value="">Pilih barang</option>
            ${[...items].sort((a, b) => a.nama.localeCompare(b.nama)).map((i) => `<option value="${i.id}" ${i.tersedia === 0 ? 'disabled' : ''}>${esc(i.kode)} · ${esc(i.nama)} (${i.tersedia} tersedia)</option>`).join('')}
          </select></label>
        <div class="grid-2">
          <label class="field"><span>Jumlah</span><input name="jumlah" type="number" min="1" value="1" required /></label>
          <label class="field"><span>Tanggal pinjam</span><input name="tanggal" type="date" required value="${todayISO()}" /></label>
        </div>
        <button class="btn btn-primary">Simpan peminjaman</button>
      </form>
    </section>`;

  const form = $('#loan-form', el);
  form.item_id.onchange = () => {
    const it = items.find((i) => String(i.id) === form.item_id.value);
    form.jumlah.max = it ? it.tersedia : '';
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const it = items.find((i) => String(i.id) === data.item_id);
    if (it && Number(data.jumlah) > it.tersedia) return toast(`Stok ${it.nama} hanya ${it.tersedia} unit.`, 'error');
    const btn = $('.btn-primary', form);
    setLoading(btn, true, 'Menyimpan…');
    try {
      const { kode } = await api('/transactions', { method: 'POST', body: { ...data, item_id: Number(data.item_id), jumlah: Number(data.jumlah) } });
      toast(`Peminjaman ${kode} disimpan.`);
      await peminjaman(el);
    } catch (err) { toast(err.message, 'error'); setLoading(btn, false); }
  };
}

/* =====================================================
   HALAMAN: PENGEMBALIAN
===================================================== */
async function pengembalian(el) {
  const { transactions } = await api('/transactions?status=dipinjam');
  const list = transactions.sort((a, b) => a.tanggal_pinjam.localeCompare(b.tanggal_pinjam));

  el.innerHTML = list.length ? `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Kode</th><th>Peminjam</th><th>Barang</th><th>Jumlah</th><th>Tanggal pinjam</th><th>Lama</th><th></th></tr></thead>
      <tbody>${list.map((t) => {
        const d = daysSince(t.tanggal_pinjam);
        return `<tr><td>${tag(t.kode)}</td><td><b>${esc(t.peminjam)}</b></td><td>${esc(t.item_nama)}</td>
          <td class="num">${t.jumlah}</td><td>${fmtDate(t.tanggal_pinjam)}</td>
          <td class="${d > 7 ? 'late' : ''}">${d} hari</td>
          <td><div class="actions"><button class="btn btn-success sm" data-ret="${t.id}">Kembalikan</button></div></td></tr>`;
      }).join('')}</tbody>
    </table></div>` : `<section class="panel">${empty('Tidak ada barang yang sedang dipinjam.')}</section>`;

  el.onclick = (e) => {
    const b = e.target.closest('[data-ret]');
    if (!b) return;
    const t = list.find((x) => String(x.id) === b.dataset.ret);
    const today = todayISO();
    const body = openModal('Proses pengembalian', `
      <div class="facts">
        <div><span>Peminjam</span><b>${esc(t.peminjam)}</b></div>
        <div><span>Barang</span><b>${esc(t.item_nama)} (${t.jumlah})</b></div>
      </div>
      <form class="form">
        <label class="field"><span>Tanggal kembali</span><input type="date" name="tanggal" required min="${t.tanggal_pinjam}" value="${today < t.tanggal_pinjam ? t.tanggal_pinjam : today}" /></label>
        <div class="note ok">Stok bertambah ${t.jumlah} unit dan transaksi ditandai selesai.</div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Batal</button><button class="btn btn-success">Konfirmasi</button></div>
      </form>`);
    const form = $('form', body);
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = $('.btn-success', form);
      setLoading(btn, true);
      try {
        await api(`/transactions/${t.id}/return`, { method: 'POST', body: { tanggal: form.tanggal.value } });
        toast(`${t.kode} sudah dikembalikan.`);
        closeModal();
        pengembalian(el);
      } catch (err) { toast(err.message, 'error'); setLoading(btn, false); }
    };
  };
}

/* =====================================================
   HALAMAN: RIWAYAT
===================================================== */
async function riwayat(el) {
  const { transactions: list } = await api('/transactions');
  el.innerHTML = `
    <div class="toolbar">
      <div class="search"><i class="ri-search-line"></i><input id="q" type="search" placeholder="Cari kode, peminjam, atau barang" /></div>
      <select id="st"><option value="">Semua status</option><option value="dipinjam">Dipinjam</option><option value="selesai">Selesai</option></select>
      ${isAdmin() ? '' : '<label class="check"><input type="checkbox" id="mine" /> Catatan saya</label>'}
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Kode</th><th>Peminjam</th><th>Barang</th><th>Jumlah</th><th>Pinjam</th><th>Kembali</th><th>Petugas</th><th>Status</th></tr></thead>
      <tbody></tbody>
    </table></div>
    <p class="table-foot"></p>`;

  const render = () => {
    const kw = $('#q', el).value.toLowerCase().trim();
    const st = $('#st', el).value;
    const mine = $('#mine', el)?.checked;
    const rows = list.filter((t) => (!kw || `${t.kode} ${t.peminjam} ${t.item_nama}`.toLowerCase().includes(kw))
      && (!st || t.status === st) && (!mine || t.dicatat_oleh === state.user.id));
    $('tbody', el).innerHTML = rows.length ? rows.map((t) => `<tr>
      <td>${tag(t.kode)}</td><td><b>${esc(t.peminjam)}</b></td><td>${esc(t.item_nama)}</td><td class="num">${t.jumlah}</td>
      <td>${fmtDate(t.tanggal_pinjam)}</td><td>${fmtDate(t.tanggal_kembali)}</td>
      <td>${esc(t.dicatat_nama || '–')}${t.diterima_nama ? `<small>Diterima: ${esc(t.diterima_nama)}</small>` : ''}</td>
      <td>${t.status === 'selesai' ? '<span class="badge ok">Selesai</span>' : '<span class="badge warn">Dipinjam</span>'}</td>
    </tr>`).join('') : `<tr><td colspan="8">${empty('Tidak ada transaksi.')}</td></tr>`;
    $('.table-foot', el).textContent = `${rows.length} dari ${list.length} transaksi`;
  };
  $('#q', el).oninput = render;
  $('#st', el).onchange = render;
  if ($('#mine', el)) $('#mine', el).onchange = render;
  render();
}

/* =====================================================
   HALAMAN: PENGGUNA (ADMIN)
===================================================== */
function userForm(user, onDone) {
  const body = openModal(user ? 'Ubah pengguna' : 'Tambah akun Staff', `
    <form class="form">
      <label class="field"><span>Nama lengkap</span><input name="full_name" required maxlength="100" value="${esc(user?.full_name ?? '')}" /></label>
      <label class="field"><span>Username</span>${user
        ? `<input value="${esc(user.username)}" readonly /><small>Username tidak dapat diubah.</small>`
        : '<input name="username" required pattern="[a-zA-Z0-9_.]{3,30}" title="3–30 karakter: huruf, angka, titik, garis bawah" />'}</label>
      <label class="field"><span>${user ? 'Password baru' : 'Password'}</span>
        <input name="password" type="password" minlength="6" ${user ? '' : 'required'} autocomplete="new-password" placeholder="${user ? 'Kosongkan jika tidak diganti' : 'Minimal 6 karakter'}" /></label>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary">Simpan</button></div>
    </form>`);

  const form = $('form', body);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const btn = $('.btn-primary', form);
    setLoading(btn, true, 'Menyimpan…');
    try {
      if (user) {
        const res = await api(`/users/${user.id}`, { method: 'PUT', body: data });
        if (user.id === state.user.id) { state.user.full_name = res.user.full_name; $('#user-name').textContent = res.user.full_name; }
      } else {
        await api('/users', { method: 'POST', body: data });
      }
      toast(user ? 'Data pengguna disimpan.' : 'Akun Staff dibuat.');
      closeModal();
      onDone();
    } catch (err) { toast(err.message, 'error'); setLoading(btn, false); }
  };
}

async function pengguna(el) {
  let { users } = await api('/users');
  actions(el, '<button class="btn btn-primary" id="add-user"><i class="ri-user-add-line"></i> Tambah Staff</button>');
  el.innerHTML = `<div class="table-wrap"><table class="table">
    <thead><tr><th>Pengguna</th><th>Role</th><th>Status</th><th>Dibuat</th><th></th></tr></thead><tbody></tbody></table></div>`;

  const render = () => {
    $('tbody', el).innerHTML = users.map((u) => `<tr>
      <td><div class="person"><span class="avatar">${esc(u.full_name[0].toUpperCase())}</span><div><b>${esc(u.full_name)}</b><small>@${esc(u.username)}</small></div></div></td>
      <td>${u.role === 'admin' ? '<span class="badge dark">Admin</span>' : '<span class="badge info">Staff</span>'}</td>
      <td><div class="status-cell">
        ${u.role === 'staff' ? `<label class="switch"><input type="checkbox" data-toggle="${u.id}" ${u.is_active ? 'checked' : ''} aria-label="Aktifkan akun" /><span></span></label>` : ''}
        <span class="badge ${u.is_active ? 'ok' : 'bad'}">${u.is_active ? 'Aktif' : 'Nonaktif'}</span></div></td>
      <td>${fmtDate(u.created_at)}</td>
      <td><div class="actions"><button class="icon-btn" data-edit="${u.id}" aria-label="Ubah"><i class="ri-pencil-line"></i></button></div></td>
    </tr>`).join('');
  };
  const reload = async () => { try { ({ users } = await api('/users')); render(); } catch (err) { toast(err.message, 'error'); } };

  $('#add-user').onclick = () => userForm(null, reload);
  $('tbody', el).onclick = (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) userForm(users.find((u) => String(u.id) === ed.dataset.edit), reload);
  };
  $('tbody', el).onchange = async (e) => {
    const t = e.target.closest('[data-toggle]');
    if (!t) return;
    t.disabled = true;
    try {
      await api(`/users/${t.dataset.toggle}/status`, { method: 'PATCH', body: { is_active: t.checked } });
      toast(t.checked ? 'Akun diaktifkan.' : 'Akun dinonaktifkan.');
      reload();
    } catch (err) { t.checked = !t.checked; t.disabled = false; toast(err.message, 'error'); }
  };
  render();
}

/* =====================================================
   MENU & ROUTER
===================================================== */
const MENU = [
  { id: 'dashboard', label: 'Dashboard', page: dashboard, admin: false },
  { id: 'barang', label: 'Barang', page: barang, admin: false },
  { id: 'peminjaman', label: 'Peminjaman', page: peminjaman, admin: false },
  { id: 'pengembalian', label: 'Pengembalian', page: pengembalian, admin: false },
  { id: 'riwayat', label: 'Riwayat', page: riwayat, admin: false },
  { id: 'pengguna', label: 'Pengguna', page: pengguna, admin: true },
];

// Tombol di kanan judul, hanya dipasang jika halaman itu masih tampil
function actions(el, html) {
  if (el.isConnected) $('#page-actions').innerHTML = html;
}

async function route() {
  if (!state.user) return;
  const id = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const menu = MENU.find((m) => m.id === id && (!m.admin || isAdmin()));
  if (!menu) { location.replace('#/dashboard'); return; }

  closeModal();
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.id === id));
  $('#page-title').textContent = menu.label;
  $('#page-actions').innerHTML = '';
  document.title = `${menu.label} · LabInv`;

  const view = document.createElement('div');
  view.innerHTML = '<div class="sk"></div><div class="sk"></div>';
  $('#page').replaceChildren(view);
  try {
    await menu.page(view);
  } catch (err) {
    if (!view.isConnected) return;
    view.innerHTML = `<section class="panel error-box"><h2>Data belum bisa dimuat</h2><p>${esc(err.message)}</p>
      <button class="btn btn-primary" id="retry">Coba lagi</button></section>`;
    $('#retry', view).onclick = route;
  }
}

/* =====================================================
   LOGIN & LOGOUT
===================================================== */
function show(view) {
  $('#boot').classList.add('hidden');
  $('#login-view').classList.toggle('hidden', view !== 'login');
  $('#app-view').classList.toggle('hidden', view !== 'app');
}

function startApp() {
  $('#nav').innerHTML = MENU.filter((m) => !m.admin || isAdmin())
    .map((m) => `<a href="#/${m.id}" data-id="${m.id}">${m.label}</a>`).join('');
  $('#user-name').textContent = `${state.user.full_name} (${isAdmin() ? 'Admin' : 'Staff'})`;
  show('app');
  if (!location.hash || location.hash === '#') location.hash = '#/dashboard';
  else route();
}

async function login(username, password) {
  const btn = $('#login-btn');
  $('#login-error').classList.add('hidden');
  setLoading(btn, true, 'Memeriksa…');
  $$('.demo-card').forEach((b) => { b.disabled = true; });
  try {
    const data = await api('/auth/login', { method: 'POST', body: { username, password } });
    setToken(data.token);
    state.user = data.user;
    $('#login-form').reset();
    startApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
    $('#login-error').classList.remove('hidden');
  } finally {
    setLoading(btn, false);
    $$('.demo-card').forEach((b) => { b.disabled = false; });
  }
}

function logout(message) {
  if (!state.user && !getToken()) return;
  setToken(null);
  state.user = null;
  closeModal();
  history.replaceState(null, '', location.pathname);
  show('login');
  if (message) toast(message);
}

/* =====================================================
   MULAI
===================================================== */
$('#login-form').onsubmit = (e) => { e.preventDefault(); login($('#login-username').value.trim(), $('#login-password').value); };
$$('.demo-card').forEach((c) => { c.onclick = () => login(c.dataset.user, c.dataset.pass); });
$('#toggle-pass').onclick = () => {
  const input = $('#login-password');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('#toggle-pass').innerHTML = `<i class="${input.type === 'password' ? 'ri-eye-line' : 'ri-eye-off-line'}"></i>`;
};
$('#logout-btn').onclick = () => logout('Anda telah keluar.');
$('#modal').onclick = (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
window.addEventListener('hashchange', route);

(async () => {
  if (getToken()) {
    try {
      state.user = (await api('/auth/me')).user;
      return startApp();
    } catch { setToken(null); }
  }
  show('login');
})();
