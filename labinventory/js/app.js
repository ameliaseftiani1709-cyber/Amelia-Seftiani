/* =====================================================================
   LabInventory — Laboratory Inventory & Borrowing Management System
   Frontend murni (HTML/CSS/JS). Data sementara disimpan di localStorage.
   Semua akses data lewat objek `store` + fungsi `api` di bawah, sehingga
   mudah diganti ke Supabase/Firebase/REST API saat backend siap.
   ===================================================================== */
(() => {
'use strict';

const DB_KEY = 'lims_db_v1';
const SESSION_KEY = 'lims_session_v1';

/* ---------- Utilitas ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const isoDate = d => d.toISOString().slice(0, 10);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return isoDate(d); };
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return isoDate(d); };
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

/* ---------- Data awal ---------- */
function seed() {
  const items = [
    ['BR001','Laptop Lenovo','Komputer',5],
    ['BR002','Mouse Logitech','Aksesoris',10],
    ['BR003','Keyboard Mechanical','Aksesoris',8],
    ['BR004','Proyektor Epson','Multimedia',3],
    ['BR005','Monitor LG','Komputer',6],
    ['BR006','Laptop ASUS','Komputer',4],
    ['BR007','Laptop HP','Komputer',4],
    ['BR008','Monitor Samsung','Komputer',5],
    ['BR009','Keyboard Logitech','Aksesoris',12],
    ['BR010','Mouse Wireless','Aksesoris',15],
    ['BR011','Router TP-Link','Jaringan',6],
    ['BR012','Switch Cisco 24 Port','Jaringan',3],
    ['BR013','Access Point Ubiquiti','Jaringan',4],
    ['BR014','Kabel LAN 10 m','Jaringan',25],
    ['BR015','Crimping Tool','Peralatan',5],
    ['BR016','LAN Tester','Peralatan',4],
    ['BR017','Layar Proyektor','Multimedia',2],
    ['BR018','Kabel HDMI','Aksesoris',14],
    ['BR019','Speaker Portable','Multimedia',4],
    ['BR020','Webcam Logitech','Multimedia',6],
    ['BR021','Headset','Aksesoris',10],
    ['BR022','Terminal Kabel (Stopkontak)','Peralatan',12],
    ['BR023','Flashdisk 32 GB','Penyimpanan',20],
    ['BR024','Harddisk Eksternal 1 TB','Penyimpanan',6],
    ['BR025','Raspberry Pi 4','Mikrokontroler',5],
    ['BR026','Arduino Uno','Mikrokontroler',10],
  ].map(([code, name, category, stock]) => ({ id: uid(), code, name, category, stock }));
  const byCode = c => items.find(i => i.code === c);

  const users = [
    { id: 'u-admin', username: 'admin', password: 'admin123', name: 'Administrator Lab', role: 'ADMIN', active: true },
    { id: 'u-staff1', username: 'staff', password: 'staff123', name: 'Siti Rahma', role: 'STAFF', active: true },
    { id: 'u-staff2', username: 'budi', password: 'budi123', name: 'Budi Santoso', role: 'STAFF', active: true },
    { id: 'u-staff3', username: 'dewi', password: 'dewi123', name: 'Dewi Lestari', role: 'STAFF', active: false },
  ];

  let n = 0;
  const tx = (borrower, code, qty, ago, by, returnedAgo = null) => {
    const it = byCode(code); n++;
    const t = {
      id: 'TRX-' + String(n).padStart(4, '0'), borrower, itemId: it.id, itemCode: it.code, itemName: it.name,
      qty, borrowDate: daysAgo(ago), status: returnedAgo === null ? 'Dipinjam' : 'Selesai',
      returnDate: returnedAgo === null ? null : daysAgo(returnedAgo), createdBy: by,
      createdAt: new Date(Date.now() - ago * 864e5 - n * 1000).toISOString(),
    };
    if (returnedAgo !== null) { t.returnedBy = by; t.returnedAt = new Date(Date.now() - returnedAgo * 864e5 - n * 500).toISOString(); }
    return t;
  };
  const transactions = [
    tx('Andi Pratama', 'BR001', 1, 9, 'u-staff1', 7),
    tx('Rina Marlina', 'BR004', 1, 8, 'u-staff2', 8),
    tx('Kelas TI-3A', 'BR005', 2, 6, 'u-staff1', 5),
    tx('Fajar Nugroho', 'BR002', 2, 4, 'u-staff2', 2),
    tx('Kelas TI-2B', 'BR001', 2, 3, 'u-staff1'),
    tx('Lina Wulandari', 'BR004', 1, 2, 'u-staff2'),
    tx('Dimas Saputra', 'BR026', 3, 2, 'u-admin'),
    tx('Maya Anggraini', 'BR003', 1, 1, 'u-staff1'),
    tx('Kelas Jaringan 4A', 'BR011', 2, 0, 'u-staff2'),
  ];
  return { items, users, transactions };
}

/* ---------- Penyimpanan (ganti bagian ini untuk backend) ---------- */
const store = {
  load() {
    try { const raw = localStorage.getItem(DB_KEY); if (raw) return JSON.parse(raw); } catch (e) { /* abaikan */ }
    const d = seed(); this.save(d); return d;
  },
  save(d) { localStorage.setItem(DB_KEY, JSON.stringify(d)); },
  reset() { localStorage.removeItem(DB_KEY); },
};
let db = store.load();
const persist = () => store.save(db);

/* ---------- Logika domain ---------- */
const borrowedQty = itemId => db.transactions.filter(t => t.itemId === itemId && t.status === 'Dipinjam').reduce((s, t) => s + t.qty, 0);
const availableQty = item => item.stock - borrowedQty(item.id);
const userById = id => db.users.find(u => u.id === id);
const byNewest = (a, b) => (b.createdAt > a.createdAt ? 1 : -1);
const nextTrxId = () => 'TRX-' + String(db.transactions.reduce((m, t) => Math.max(m, parseInt(t.id.slice(4), 10) || 0), 0) + 1).padStart(4, '0');

const api = {
  login(username, password) {
    const u = db.users.find(x => x.username.toLowerCase() === username.trim().toLowerCase());
    if (!u || u.password !== password) throw new Error('Username atau password salah.');
    if (!u.active) throw new Error('Akun Anda dinonaktifkan. Hubungi Admin.');
    localStorage.setItem(SESSION_KEY, u.id);
    return u;
  },
  logout() { localStorage.removeItem(SESSION_KEY); },
  currentUser() {
    const id = localStorage.getItem(SESSION_KEY);
    const u = id && userById(id);
    return u && u.active ? u : null;
  },
  saveItem(data, id) {
    const code = data.code.trim().toUpperCase(), name = data.name.trim(), category = data.category.trim();
    const stock = parseInt(data.stock, 10);
    if (!code || !name || !category) throw new Error('Kode, nama, dan kategori wajib diisi.');
    if (!Number.isInteger(stock) || stock < 0) throw new Error('Stok harus berupa angka 0 atau lebih.');
    if (db.items.some(i => i.code === code && i.id !== id)) throw new Error(`Kode ${code} sudah digunakan.`);
    if (id) {
      const it = db.items.find(i => i.id === id);
      const out = borrowedQty(id);
      if (stock < out) throw new Error(`Stok tidak boleh kurang dari jumlah yang sedang dipinjam (${out}).`);
      Object.assign(it, { code, name, category, stock });
      db.transactions.forEach(t => { if (t.itemId === id) { t.itemCode = code; t.itemName = name; } });
    } else db.items.push({ id: uid(), code, name, category, stock });
    persist();
  },
  deleteItem(id) {
    if (borrowedQty(id) > 0) throw new Error('Barang masih dipinjam, tidak dapat dihapus.');
    db.items = db.items.filter(i => i.id !== id); persist();
  },
  borrow(data, user) {
    const borrower = data.borrower.trim(), qty = parseInt(data.qty, 10);
    const item = db.items.find(i => i.id === data.itemId);
    if (!borrower) throw new Error('Nama peminjam wajib diisi.');
    if (!item) throw new Error('Pilih barang terlebih dahulu.');
    if (!Number.isInteger(qty) || qty < 1) throw new Error('Jumlah minimal 1.');
    if (!data.date) throw new Error('Tanggal peminjaman wajib diisi.');
    const av = availableQty(item);
    if (qty > av) throw new Error(`Stok tersedia hanya ${av} unit.`);
    const t = { id: nextTrxId(), borrower, itemId: item.id, itemCode: item.code, itemName: item.name, qty,
      borrowDate: data.date, status: 'Dipinjam', returnDate: null, createdBy: user.id, createdAt: new Date().toISOString() };
    db.transactions.push(t); persist(); return t;
  },
  returnItem(trxId, user) {
    const t = db.transactions.find(x => x.id === trxId);
    if (!t || t.status !== 'Dipinjam') throw new Error('Transaksi tidak valid atau sudah selesai.');
    t.status = 'Selesai'; t.returnDate = today(); t.returnedBy = user.id; t.returnedAt = new Date().toISOString();
    persist(); return t;
  },
  saveUser(data, id) {
    const username = data.username.trim().toLowerCase(), name = data.name.trim(), password = data.password;
    if (!name) throw new Error('Nama lengkap wajib diisi.');
    if (id) {
      const u = userById(id); u.name = name;
      if (password) { if (password.length < 6) throw new Error('Password minimal 6 karakter.'); u.password = password; }
    } else {
      if (!/^[a-z0-9._-]{3,}$/.test(username)) throw new Error('Username minimal 3 karakter (huruf kecil, angka, titik, strip).');
      if (db.users.some(u => u.username === username)) throw new Error('Username sudah digunakan.');
      if (!password || password.length < 6) throw new Error('Password minimal 6 karakter.');
      db.users.push({ id: uid(), username, password, name, role: 'STAFF', active: true });
    }
    persist();
  },
  toggleUser(id) {
    const u = userById(id);
    if (u.role === 'ADMIN') throw new Error('Akun Admin tidak dapat dinonaktifkan.');
    u.active = !u.active; persist(); return u;
  },
};

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
  $('form', el).onsubmit = e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try { onSubmit && onSubmit(data); close(); }
    catch (err) { const p = $('.form-error', el); p.textContent = err.message; p.hidden = false; }
  };
  document.body.appendChild(el);
  const first = $('input:not([disabled]),select', el); if (first) first.focus();
  return el;
}

const statusBadge = s => `<span class="badge ${s === 'Dipinjam' ? 'warn' : 'ok'}">${esc(s)}</span>`;
const emptyRow = (cols, text) => `<tr><td class="empty" colspan="${cols}">${esc(text)}</td></tr>`;

/* ---------- Navigasi per role ---------- */
const ROUTES = {
  dashboard:  { label: 'Dashboard',   ico: '📊', roles: ['ADMIN', 'STAFF'] },
  barang:     { label: 'Data Barang', ico: '📦', roles: ['ADMIN', 'STAFF'] },
  peminjaman: { label: 'Peminjaman',  ico: '📝', roles: ['ADMIN', 'STAFF'] },
  pengembalian:{ label: 'Pengembalian', ico: '↩️', roles: ['ADMIN', 'STAFF'] },
  riwayat:    { label: 'Riwayat',     ico: '🕘', roles: ['ADMIN', 'STAFF'] },
  pengguna:   { label: 'Pengguna',    ico: '👥', roles: ['ADMIN'] },
};

/* ---------- Views ---------- */
const views = {};

views.dashboard = user => {
  const totalUnits = db.items.reduce((s, i) => s + i.stock, 0);
  const out = db.items.reduce((s, i) => s + borrowedQty(i.id), 0);
  const scope = user.role === 'ADMIN' ? db.transactions : db.transactions.filter(t => t.createdBy === user.id);
  const events = [];
  scope.forEach(t => {
    events.push({ at: t.createdAt, text: `<b>${esc(t.borrower)}</b> meminjam ${t.qty}× ${esc(t.itemName)}`, by: t.createdBy, kind: 'Dipinjam' });
    if (t.status === 'Selesai') events.push({ at: t.returnedAt || t.createdAt, text: `<b>${esc(t.borrower)}</b> mengembalikan ${t.qty}× ${esc(t.itemName)}`, by: t.returnedBy, kind: 'Selesai' });
  });
  events.sort((a, b) => (b.at > a.at ? 1 : -1));
  const feed = events.slice(0, 7).map(e => {
    const u = userById(e.by);
    return `<li><div>${e.text}<div class="when">oleh ${esc(u ? u.name : '-')} · ${fmtDate(e.at.slice(0, 10))}</div></div>${statusBadge(e.kind)}</li>`;
  }).join('');
  return {
    html: `
    <div class="page-head"><div><h2>Dashboard</h2><p>${user.role === 'ADMIN' ? 'Ringkasan seluruh aktivitas laboratorium' : 'Ringkasan aktivitas operasional laboratorium'}</p></div></div>
    <div class="stats">
      <div class="stat"><div class="lb">Total Barang</div><div class="vl">${totalUnits}</div><div class="sb">${db.items.length} jenis barang</div></div>
      <div class="stat ok"><div class="lb">Barang Tersedia</div><div class="vl">${totalUnits - out}</div><div class="sb">unit siap dipinjam</div></div>
      <div class="stat warn"><div class="lb">Barang Dipinjam</div><div class="vl">${out}</div><div class="sb">unit sedang keluar</div></div>
      <div class="stat vio"><div class="lb">Total Transaksi</div><div class="vl">${db.transactions.length}</div><div class="sb">${db.transactions.filter(t => t.status === 'Dipinjam').length} masih aktif</div></div>
    </div>
    <div class="card"><h3>Aktivitas Terbaru${user.role === 'STAFF' ? ' Anda' : ''}</h3>
      <ul class="feed">${feed || '<li class="empty" style="display:block">Belum ada aktivitas.</li>'}</ul></div>`,
  };
};

views.barang = user => {
  const admin = user.role === 'ADMIN';
  const cats = [...new Set(db.items.map(i => i.category))].sort();
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
      const rows = db.items.filter(i => (!cat || i.category === cat) && (!q || [i.code, i.name, i.category].some(v => v.toLowerCase().includes(q))))
        .sort((a, b) => a.code.localeCompare(b.code)).map(i => {
          const out = borrowedQty(i.id), av = i.stock - out;
          const st = av === 0 ? '<span class="badge bad">Habis</span>' : av <= 2 ? '<span class="badge warn">Terbatas</span>' : '<span class="badge ok">Tersedia</span>';
          return `<tr><td class="mono">${esc(i.code)}</td><td>${esc(i.name)}</td><td>${esc(i.category)}</td>
            <td class="num">${i.stock}</td><td class="num">${out}</td><td class="num"><b>${av}</b></td><td>${st}</td>
            ${admin ? `<td class="act"><button class="btn sm" data-edit="${i.id}">Edit</button><button class="btn sm danger" data-del="${i.id}">Hapus</button></td>` : ''}</tr>`;
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
    $('#add-item', root).onclick = () => modal('Tambah Barang', form(), { onSubmit: d => { api.saveItem(d); toast('Barang ditambahkan.'); go(); } });
    root.addEventListener('click', e => {
      const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
      if (ed) { const it = db.items.find(i => i.id === ed.dataset.edit); modal('Edit Barang', form(it), { onSubmit: d => { api.saveItem(d, it.id); toast('Barang diperbarui.'); go(); } }); }
      if (del) { const it = db.items.find(i => i.id === del.dataset.del);
        modal('Hapus Barang', `<p>Hapus <b>${esc(it.name)}</b> (${esc(it.code)})? Tindakan ini tidak dapat dibatalkan.</p>`,
          { submitText: 'Hapus', danger: true, onSubmit: () => { api.deleteItem(it.id); toast('Barang dihapus.'); go(); } }); }
    });
  };
  return { html, mount };
};

views.peminjaman = user => {
  const avail = db.items.filter(i => availableQty(i) > 0).sort((a, b) => a.name.localeCompare(b.name));
  const recent = [...db.transactions].sort(byNewest).slice(0, 8);
  const html = `
    <div class="page-head"><div><h2>Peminjaman Barang</h2><p>Catat transaksi peminjaman baru</p></div></div>
    <div class="grid2">
      <div class="card"><h3>Form Peminjaman</h3>
        <form id="borrow-form" novalidate>
          <div class="field"><label>Nama Peminjam</label><input name="borrower" placeholder="Nama peminjam / kelas" required></div>
          <div class="field"><label>Barang</label><select name="itemId" id="item-sel" required>
            <option value="">— Pilih barang —</option>
            ${avail.map(i => `<option value="${i.id}" data-av="${availableQty(i)}">${esc(i.code)} · ${esc(i.name)} (tersedia ${availableQty(i)})</option>`).join('')}</select></div>
          <div class="row2">
            <div class="field"><label>Jumlah</label><input name="qty" id="qty" type="number" min="1" value="1" required><div class="hint" id="qty-hint"></div></div>
            <div class="field"><label>Tanggal Pinjam</label><input name="date" type="date" value="${today()}" required></div>
          </div>
          <p class="form-error" id="b-err" hidden></p>
          <button class="btn primary block">Simpan Transaksi</button>
        </form></div>
      <div class="card"><h3>Transaksi Terbaru</h3><div class="table-wrap"><table>
        <thead><tr><th>ID</th><th>Peminjam</th><th>Barang</th><th class="num">Jml</th><th>Tanggal</th><th>Status</th></tr></thead>
        <tbody>${recent.map(t => `<tr><td class="mono">${esc(t.id)}</td><td>${esc(t.borrower)}</td><td>${esc(t.itemName)}</td><td class="num">${t.qty}</td><td>${fmtDate(t.borrowDate)}</td><td>${statusBadge(t.status)}</td></tr>`).join('') || emptyRow(6, 'Belum ada transaksi.')}</tbody>
      </table></div></div>
    </div>`;
  const mount = root => {
    const sel = $('#item-sel', root), qty = $('#qty', root), hint = $('#qty-hint', root);
    sel.onchange = () => { const o = sel.selectedOptions[0]; const av = o && o.dataset.av; qty.max = av || ''; hint.textContent = av ? `Maksimal ${av} unit` : ''; };
    $('#borrow-form', root).onsubmit = e => {
      e.preventDefault();
      try {
        const t = api.borrow(Object.fromEntries(new FormData(e.target)), user);
        toast(`Transaksi ${t.id} tersimpan.`); go();
      } catch (err) { const p = $('#b-err', root); p.textContent = err.message; p.hidden = false; }
    };
  };
  return { html, mount };
};

views.pengembalian = user => {
  const active = db.transactions.filter(t => t.status === 'Dipinjam').sort(byNewest);
  const html = `
    <div class="page-head"><div><h2>Pengembalian Barang</h2><p>${active.length} barang sedang dipinjam</p></div></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Peminjam</th><th>Barang</th><th class="num">Jumlah</th><th>Tgl Pinjam</th><th>Dicatat Oleh</th><th></th></tr></thead>
      <tbody>${active.map(t => `<tr><td class="mono">${esc(t.id)}</td><td>${esc(t.borrower)}</td><td>${esc(t.itemName)} <span class="mono" style="color:var(--muted)">${esc(t.itemCode)}</span></td>
        <td class="num">${t.qty}</td><td>${fmtDate(t.borrowDate)}</td><td>${esc((userById(t.createdBy) || {}).name || '-')}</td>
        <td class="act"><button class="btn sm primary" data-ret="${t.id}">Kembalikan</button></td></tr>`).join('') || emptyRow(7, 'Tidak ada barang yang sedang dipinjam. 🎉')}</tbody>
    </table></div></div>`;
  const mount = root => root.addEventListener('click', e => {
    const b = e.target.closest('[data-ret]'); if (!b) return;
    const t = db.transactions.find(x => x.id === b.dataset.ret);
    modal('Proses Pengembalian', `<p><b>${esc(t.borrower)}</b> mengembalikan <b>${t.qty}× ${esc(t.itemName)}</b>?</p><p class="hint">Stok akan diperbarui dan status transaksi menjadi Selesai.</p>`,
      { submitText: 'Konfirmasi', onSubmit: () => { api.returnItem(t.id, user); toast(`${t.id} selesai, stok diperbarui.`); go(); } });
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
    const base = (admin ? db.transactions : db.transactions.filter(t => t.createdBy === user.id || t.returnedBy === user.id)).slice().sort(byNewest);
    const draw = () => {
      const q = $('#q', root).value.trim().toLowerCase(), st = $('#st', root).value;
      const rows = base.filter(t => (!st || t.status === st) && (!q || [t.id, t.borrower, t.itemName, t.itemCode].some(v => v.toLowerCase().includes(q))))
        .map(t => `<tr><td class="mono">${esc(t.id)}</td><td>${esc(t.borrower)}</td><td>${esc(t.itemName)}</td><td class="num">${t.qty}</td>
          <td>${fmtDate(t.borrowDate)}</td><td>${fmtDate(t.returnDate)}</td><td>${esc((userById(t.createdBy) || {}).name || '-')}</td><td>${statusBadge(t.status)}</td></tr>`).join('');
      $('#tbody', root).innerHTML = rows || emptyRow(8, 'Tidak ada transaksi.');
    };
    $('#q', root).oninput = draw; $('#st', root).onchange = draw; draw();
  };
  return { html, mount };
};

views.pengguna = () => {
  const staff = db.users.slice().sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  const form = (u = {}) => `
    <div class="field"><label>Nama Lengkap</label><input name="name" value="${esc(u.name || '')}" required></div>
    <div class="field"><label>Username</label><input name="username" value="${esc(u.username || '')}" ${u.id ? 'disabled' : ''} placeholder="mis. andi.staff" required></div>
    <div class="field"><label>Password${u.id ? ' baru' : ''}</label><input name="password" type="password" autocomplete="new-password" ${u.id ? '' : 'required'} placeholder="${u.id ? 'Kosongkan jika tidak diubah' : 'Minimal 6 karakter'}"></div>`;
  const html = `
    <div class="page-head"><div><h2>Manajemen Pengguna</h2><p>Kelola akun Staff laboratorium</p></div><button class="btn primary" id="add-user">+ Tambah Staff</button></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Nama</th><th>Username</th><th>Role</th><th>Transaksi</th><th>Status</th><th></th></tr></thead>
      <tbody>${staff.map(u => `<tr><td>${esc(u.name)}</td><td class="mono">${esc(u.username)}</td>
        <td><span class="badge info">${u.role}</span></td><td>${db.transactions.filter(t => t.createdBy === u.id).length}</td>
        <td>${u.active ? '<span class="badge ok">Aktif</span>' : '<span class="badge bad">Nonaktif</span>'}</td>
        <td class="act"><button class="btn sm" data-edit="${u.id}">Edit</button>
        ${u.role === 'ADMIN' ? '' : `<button class="btn sm" data-tog="${u.id}">${u.active ? 'Nonaktifkan' : 'Aktifkan'}</button>`}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
  const mount = root => {
    $('#add-user', root).onclick = () => modal('Tambah Akun Staff', form(), { onSubmit: d => { api.saveUser(d); toast('Akun Staff dibuat.'); go(); } });
    root.addEventListener('click', e => {
      const ed = e.target.closest('[data-edit]'), tg = e.target.closest('[data-tog]');
      if (ed) { const u = userById(ed.dataset.edit); modal('Edit Pengguna', form(u), { onSubmit: d => { api.saveUser(d, u.id); toast('Data pengguna diperbarui.'); go(); } }); }
      if (tg) { try { const u = api.toggleUser(tg.dataset.tog); toast(`${u.name} ${u.active ? 'diaktifkan' : 'dinonaktifkan'}.`); go(); } catch (err) { toast(err.message, true); } }
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
  $('#login-form').onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    try { const u = api.login(d.username, d.password); location.href = homeFor(u); }
    catch (err) { const p = $('#l-err'); p.textContent = err.message; p.hidden = false; }
  };
  document.querySelectorAll('[data-fill]').forEach(b => b.onclick = () => {
    const [u, p] = b.dataset.fill.split(','); $('#u').value = u; $('#p').value = p;
  });
}

/* ---------- Layout & router ---------- */
function currentRoute(user) {
  const r = (location.hash.replace(/^#\/?/, '') || 'dashboard');
  return ROUTES[r] && ROUTES[r].roles.includes(user.role) ? r : 'dashboard';
}

const PAGE = window.LIMS_PAGE || 'login';           // 'login' | 'admin' | 'staff'
const homeFor = u => (u.role === 'ADMIN' ? 'admin.html' : 'staff.html');
const PAGE_ROLE = { admin: 'ADMIN', staff: 'STAFF' };

function render() {
  const user = api.currentUser();
  if (PAGE === 'login') { if (user) { location.href = homeFor(user); return; } renderLogin(); return; }
  if (!user) { location.href = 'index.html'; return; }                 // belum login
  if (user.role !== PAGE_ROLE[PAGE]) { location.href = homeFor(user); return; } // salah halaman
  const route = currentRoute(user);
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
