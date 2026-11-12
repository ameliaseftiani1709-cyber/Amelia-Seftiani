// api/index.js — Backend LabInv untuk Vercel + Supabase
const crypto = require('crypto');
const express = require('express');

/* =====================================================
   KONEKSI SUPABASE (REST API)
===================================================== */
function getSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
  if (!url || !key) {
    const err = new Error('Environment Variables SUPABASE_URL dan SUPABASE_ANON_KEY belum diisi di Vercel.');
    err.status = 500;
    throw err;
  }
  return { url, key };
}

async function sb(path, { method = 'GET', body, prefer } = {}) {
  const { url, key } = getSupabaseConfig();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const msg = data?.message || data?.details || data?.hint || `Supabase error (${res.status})`;
    const err = new Error(msg);
    err.code = data?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

/* =====================================================
   PASSWORD & TOKEN
===================================================== */
const SECRET = process.env.JWT_SECRET || 'ganti-secret-ini-di-env';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}

async function checkPassword(pw, stored) {
  const val = String(stored || '');
  if (!val) return false;

  // 1. Format scrypt (akun baru dari dashboard)
  if (val.startsWith('scrypt$')) {
    const [, salt, hash] = val.split('$');
    if (!salt || !hash) return false;
    const a = Buffer.from(hash, 'hex');
    const b = crypto.scryptSync(String(pw), salt, a.length);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // 2. Format bcrypt ($2a$ / $2b$) dari PostgreSQL pgcrypto
  if (val.startsWith('$2')) {
    const ok = await sb('rpc/verify_password', {
      method: 'POST',
      body: { plain: String(pw), hashed: val },
    });
    return ok === true;
  }

  // 3. Fallback teks biasa
  return String(pw) === val;
}

const sign = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
function makeToken(userId) {
  const body = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 12 * 3600 * 1000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}
function readToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || sig.length !== sign(body).length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(body)))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

/* =====================================================
   HELPER
===================================================== */
const app = express();
app.use(express.json({ limit: '100kb' }));

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const today = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

const isUserActive = (u) => (u.aktif !== undefined ? !!u.aktif : (u.is_active !== undefined ? !!u.is_active : true));
const getFullName = (u) => u.full_name || u.nama || u.username;
const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  full_name: getFullName(u),
  role: u.role,
  is_active: isUserActive(u),
  created_at: u.created_at,
});

async function logActivity(user, aksi, detail) {
  await sb('activity_logs', {
    method: 'POST',
    body: { actor_name: getFullName(user), aksi, detail: String(detail).slice(0, 255) },
  }).catch(() => {});
}

const auth = wrap(async (req, res, next) => {
  const p = readToken((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!p) fail(401, 'Sesi berakhir, silakan login kembali.');
  const rows = await sb(`users?id=eq.${encodeURIComponent(p.sub)}&select=*&limit=1`);
  const u = rows?.[0];
  if (!u || !isUserActive(u)) fail(401, 'Akun tidak aktif atau tidak ditemukan.');
  req.user = u;
  next();
});

const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : next(new HttpError(403, 'Hanya Admin yang dapat melakukan aksi ini.')));

/* =====================================================
   AUTH
===================================================== */
app.get('/api/health', wrap(async (req, res) => {
  await sb('users?select=id&limit=1');
  res.json({ ok: true, database: 'Supabase terhubung' });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const username = text(req.body?.username, 30).toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) fail(400, 'Username dan password wajib diisi.');

  const rows = await sb(`users?username=eq.${encodeURIComponent(username)}&select=*&limit=1`);
  const u = rows?.[0];
  if (!u || !(await checkPassword(password, u.password_hash))) {
    fail(401, 'Username atau password salah.');
  }
  if (!isUserActive(u)) fail(403, 'Akun Anda dinonaktifkan. Hubungi Admin.');

  res.json({ token: makeToken(u.id), user: publicUser(u) });
}));

app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

/* =====================================================
   DASHBOARD
===================================================== */
app.get('/api/dashboard', auth, wrap(async (req, res) => {
  const [items, trxs, logs] = await Promise.all([
    sb('items?select=stok,tersedia'),
    sb('transactions?select=status'),
    sb('activity_logs?select=actor_name,aksi,detail,created_at&order=created_at.desc,id.desc&limit=6'),
  ]);

  const jenis = items.length;
  const total = items.reduce((s, i) => s + Number(i.stok || 0), 0);
  const tersedia = items.reduce((s, i) => s + Number(i.tersedia || 0), 0);
  const aktif = trxs.filter((t) => t.status === 'dipinjam').length;

  res.json({
    stats: { jenis, total, tersedia, dipinjam: total - tersedia, transaksi: trxs.length, aktif },
    logs,
  });
}));

/* =====================================================
   BARANG
===================================================== */
function readItem(b) {
  const d = { kode: text(b.kode, 20).toUpperCase(), nama: text(b.nama, 100), kategori: text(b.kategori, 50), stok: int(b.stok) };
  if (!d.kode || !d.nama || !d.kategori) fail(400, 'Kode, nama, dan kategori wajib diisi.');
  if (!/^[A-Z0-9-]+$/.test(d.kode)) fail(400, 'Kode hanya boleh berisi huruf, angka, dan tanda minus.');
  if (Number.isNaN(d.stok) || d.stok < 0) fail(400, 'Stok harus berupa angka 0 atau lebih.');
  return d;
}

app.get('/api/items', auth, wrap(async (req, res) => {
  const items = await sb('items?select=*&order=kode.asc');
  res.json({ items });
}));

app.post('/api/items', auth, adminOnly, wrap(async (req, res) => {
  const d = readItem(req.body || {});
  await sb('items', {
    method: 'POST',
    body: { kode: d.kode, nama: d.nama, kategori: d.kategori, stok: d.stok, tersedia: d.stok },
  });
  await logActivity(req.user, 'barang', `Menambahkan barang ${d.nama} (${d.kode}) sebanyak ${d.stok} unit`);
  res.status(201).json({ ok: true });
}));

app.put('/api/items/:id', auth, adminOnly, wrap(async (req, res) => {
  const id = int(req.params.id);
  const d = readItem(req.body || {});
  const [cur] = await sb(`items?id=eq.${id}&select=*&limit=1`);
  if (!cur) fail(404, 'Barang tidak ditemukan.');

  const dipinjam = Number(cur.stok) - Number(cur.tersedia);
  if (d.stok < dipinjam) fail(400, `Stok tidak boleh kurang dari ${dipinjam} karena sedang dipinjam.`);

  await sb(`items?id=eq.${id}`, {
    method: 'PATCH',
    body: { kode: d.kode, nama: d.nama, kategori: d.kategori, stok: d.stok, tersedia: d.stok - dipinjam },
  });
  await logActivity(req.user, 'barang', `Mengubah data barang ${d.nama} (${d.kode})`);
  res.json({ ok: true });
}));

app.delete('/api/items/:id', auth, adminOnly, wrap(async (req, res) => {
  const id = int(req.params.id);
  const [cur] = await sb(`items?id=eq.${id}&select=*&limit=1`);
  if (!cur) fail(404, 'Barang tidak ditemukan.');
  if (Number(cur.stok) > Number(cur.tersedia)) fail(400, 'Barang masih dipinjam, tidak bisa dihapus.');

  await sb(`transactions?item_id=eq.${id}`, { method: 'PATCH', body: { item_id: null } });
  await sb(`items?id=eq.${id}`, { method: 'DELETE' });
  await logActivity(req.user, 'hapus', `Menghapus barang ${cur.nama} (${cur.kode})`);
  res.json({ ok: true });
}));

/* =====================================================
   PEMINJAMAN & PENGEMBALIAN
===================================================== */
app.get('/api/transactions', auth, wrap(async (req, res) => {
  const status = ['dipinjam', 'selesai'].includes(req.query.status) ? req.query.status : null;
  const filter = status ? `status=eq.${status}&` : '';
  const transactions = await sb(`transactions?${filter}select=*&order=created_at.desc,id.desc&limit=1000`);
  res.json({ transactions });
}));

app.post('/api/transactions', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const itemId = int(b.item_id);
  const jumlah = int(b.jumlah);
  const peminjam = text(b.peminjam, 100);
  const tanggal = isDate(b.tanggal) ? b.tanggal : today();
  if (!peminjam) fail(400, 'Nama peminjam wajib diisi.');
  if (Number.isNaN(itemId)) fail(400, 'Pilih barang yang dipinjam.');
  if (Number.isNaN(jumlah) || jumlah < 1) fail(400, 'Jumlah minimal 1.');

  const [item] = await sb(`items?id=eq.${itemId}&select=*&limit=1`);
  if (!item) fail(404, 'Barang tidak ditemukan.');
  if (Number(item.tersedia) < jumlah) fail(400, `Stok ${item.nama} tidak cukup. Tersedia ${item.tersedia} unit.`);

  await sb(`items?id=eq.${itemId}`, {
    method: 'PATCH',
    body: { tersedia: Number(item.tersedia) - jumlah },
  });

  const [inserted] = await sb('transactions', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      peminjam,
      item_id: item.id,
      item_kode: item.kode,
      item_nama: item.nama,
      jumlah,
      tanggal_pinjam: tanggal,
      dicatat_oleh: req.user.id,
      dicatat_nama: getFullName(req.user),
      status: 'dipinjam',
    },
  });

  const kode = `TRX-${String(inserted.id).padStart(5, '0')}`;
  await sb(`transactions?id=eq.${inserted.id}`, { method: 'PATCH', body: { kode } });
  await logActivity(req.user, 'pinjam', `${peminjam} meminjam ${jumlah} unit ${item.nama} (${kode})`);
  res.status(201).json({ kode });
}));

app.post('/api/transactions/:id/return', auth, wrap(async (req, res) => {
  const id = int(req.params.id);
  const tanggal = isDate(req.body?.tanggal) ? req.body.tanggal : today();

  const [t] = await sb(`transactions?id=eq.${id}&select=*&limit=1`);
  if (!t) fail(404, 'Transaksi tidak ditemukan.');
  if (t.status === 'selesai') fail(400, 'Transaksi ini sudah selesai.');
  if (tanggal < t.tanggal_pinjam) fail(400, 'Tanggal kembali tidak boleh sebelum tanggal pinjam.');

  if (t.item_id) {
    const [item] = await sb(`items?id=eq.${t.item_id}&select=*&limit=1`);
    if (item) {
      await sb(`items?id=eq.${t.item_id}`, {
        method: 'PATCH',
        body: { tersedia: Math.min(Number(item.stok), Number(item.tersedia) + Number(t.jumlah)) },
      });
    }
  }

  await sb(`transactions?id=eq.${id}`, {
    method: 'PATCH',
    body: { status: 'selesai', tanggal_kembali: tanggal, diterima_nama: getFullName(req.user) },
  });
  await logActivity(req.user, 'kembali', `${t.peminjam} mengembalikan ${t.jumlah} unit ${t.item_nama} (${t.kode})`);
  res.json({ ok: true });
}));

/* =====================================================
   PENGGUNA (ADMIN)
===================================================== */
app.get('/api/users', auth, adminOnly, wrap(async (req, res) => {
  const rows = await sb('users?select=*&order=created_at.asc,id.asc');
  rows.sort((a, b) => (b.role === 'admin') - (a.role === 'admin'));
  res.json({ users: rows.map(publicUser) });
}));

app.post('/api/users', auth, adminOnly, wrap(async (req, res) => {
  const username = text(req.body?.username, 30).toLowerCase();
  const fullName = text(req.body?.full_name, 100);
  const password = String(req.body?.password || '');
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) fail(400, 'Username 3–30 karakter: huruf, angka, titik, atau garis bawah.');
  if (!fullName) fail(400, 'Nama lengkap wajib diisi.');
  if (password.length < 6) fail(400, 'Password minimal 6 karakter.');

  await sb('users', {
    method: 'POST',
    body: { username, password_hash: hashPassword(password), nama: fullName, role: 'staff', aktif: true },
  });
  await logActivity(req.user, 'pengguna', `Menambahkan akun staff ${fullName} (@${username})`);
  res.status(201).json({ ok: true });
}));

app.put('/api/users/:id', auth, adminOnly, wrap(async (req, res) => {
  const id = int(req.params.id);
  const fullName = text(req.body?.full_name, 100);
  const password = String(req.body?.password || '');
  if (!fullName) fail(400, 'Nama lengkap wajib diisi.');
  if (password && password.length < 6) fail(400, 'Password baru minimal 6 karakter.');

  const [u] = await sb(`users?id=eq.${id}&select=*&limit=1`);
  if (!u) fail(404, 'Pengguna tidak ditemukan.');

  const body = { nama: fullName };
  if (password) body.password_hash = hashPassword(password);

  await sb(`users?id=eq.${id}`, { method: 'PATCH', body });
  await logActivity(req.user, 'pengguna', `Mengubah data pengguna @${u.username}`);
  res.json({ user: publicUser({ ...u, nama: fullName }) });
}));

app.patch('/api/users/:id/status', auth, adminOnly, wrap(async (req, res) => {
  const id = int(req.params.id);
  const active = !!req.body?.is_active;

  const [u] = await sb(`users?id=eq.${id}&select=*&limit=1`);
  if (!u) fail(404, 'Pengguna tidak ditemukan.');
  if (u.role !== 'staff') fail(400, 'Hanya akun Staff yang dapat diaktifkan atau dinonaktifkan.');

  await sb(`users?id=eq.${id}`, { method: 'PATCH', body: { aktif: active } });
  await logActivity(req.user, 'pengguna', `${active ? 'Mengaktifkan' : 'Menonaktifkan'} akun ${getFullName(u)} (@${u.username})`);
  res.json({ ok: true });
}));

/* =====================================================
   ERROR
===================================================== */
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'Kode barang atau username tersebut sudah digunakan.' });
  console.error('[API]', err.code || '', err.message);
  res.status(500).json({ error: err.status ? err.message : 'Terjadi kesalahan pada server.' });
});

module.exports = app;
