// api/index.js — seluruh backend (koneksi TiDB, login, dan REST API)
// Dipakai oleh Vercel (Serverless Function) dan oleh server.js saat dijalankan lokal.
const crypto = require('crypto');
const express = require('express');
const mysql = require('mysql2/promise');

/* =====================================================
   KONEKSI TiDB
===================================================== */
let pool;
function db() {
  if (pool) return pool;
  const missing = ['TIDB_HOST', 'TIDB_USER', 'TIDB_PASSWORD'].filter((k) => !process.env[k]);
  if (missing.length) {
    const err = new Error(`File .env belum lengkap: ${missing.join(', ')} belum diisi.`);
    err.status = 500;
    throw err;
  }
  pool = mysql.createPool({
    host: process.env.TIDB_HOST,
    port: Number(process.env.TIDB_PORT || 4000),
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD,
    database: process.env.TIDB_DATABASE || 'lab_inventory',
    ssl: process.env.TIDB_SSL === 'false' ? undefined : { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionLimit: 5,
    connectTimeout: 10000,
    enableKeepAlive: true,
    decimalNumbers: true,
    dateStrings: ['DATE'],
    timezone: 'Z',
  });
  pool.on('connection', (conn) => (conn.connection || conn).query("SET time_zone = '+00:00'", () => {}));
  return pool;
}

const query = async (sql, params = []) => (await db().query(sql, params))[0];

async function tx(work) {
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/* =====================================================
   PASSWORD & TOKEN (modul bawaan Node.js)
===================================================== */
const SECRET = process.env.JWT_SECRET || 'ganti-secret-ini-di-env';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(pw), salt, a.length);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
const today = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); // WIB
const publicUser = (u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, is_active: !!u.is_active, created_at: u.created_at });

function log(runner, user, aksi, detail) {
  return runner.query('INSERT INTO activity_logs (actor_name, aksi, detail) VALUES (?, ?, ?)', [user.full_name, aksi, String(detail).slice(0, 255)]);
}
const pool_ = { query: (sql, p) => db().query(sql, p) };

const auth = wrap(async (req, res, next) => {
  const p = readToken((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!p) fail(401, 'Sesi berakhir, silakan login kembali.');
  const [u] = await query('SELECT * FROM users WHERE id = ?', [p.sub]);
  if (!u || !u.is_active) fail(401, 'Akun tidak aktif atau tidak ditemukan.');
  req.user = u;
  next();
});
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : next(new HttpError(403, 'Hanya Admin yang dapat melakukan aksi ini.')));

/* =====================================================
   AUTH
===================================================== */
app.get('/api/health', wrap(async (req, res) => {
  await query('SELECT 1');
  res.json({ ok: true, database: 'TiDB terhubung' });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const username = text(req.body?.username, 30).toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) fail(400, 'Username dan password wajib diisi.');
  const [u] = await query('SELECT * FROM users WHERE username = ?', [username]);
  if (!u || !checkPassword(password, u.password_hash)) fail(401, 'Username atau password salah.');
  if (!u.is_active) fail(403, 'Akun Anda dinonaktifkan. Hubungi Admin.');
  res.json({ token: makeToken(u.id), user: publicUser(u) });
}));

app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

/* =====================================================
   DASHBOARD — satu request, query berjalan paralel
===================================================== */
app.get('/api/dashboard', auth, wrap(async (req, res) => {
  const [[it], [tr], logs] = await Promise.all([
    query('SELECT COUNT(*) AS jenis, COALESCE(SUM(stok),0) AS total, COALESCE(SUM(tersedia),0) AS tersedia FROM items'),
    query("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'dipinjam'),0) AS aktif FROM transactions"),
    query('SELECT actor_name, aksi, detail, created_at FROM activity_logs ORDER BY created_at DESC, id DESC LIMIT 6'),
  ]);
  res.json({
    stats: {
      jenis: Number(it.jenis), total: Number(it.total), tersedia: Number(it.tersedia),
      dipinjam: Number(it.total) - Number(it.tersedia), transaksi: Number(tr.total), aktif: Number(tr.aktif),
    },
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
  res.json({ items: await query('SELECT * FROM items ORDER BY kode') });
}));

app.post('/api/items', auth, adminOnly, wrap(async (req, res) => {
  const d = readItem(req.body || {});
  await query('INSERT INTO items (kode, nama, kategori, stok, tersedia) VALUES (?, ?, ?, ?, ?)', [d.kode, d.nama, d.kategori, d.stok, d.stok]);
  await log(pool_, req.user, 'barang', `Menambahkan barang ${d.nama} (${d.kode}) sebanyak ${d.stok} unit`);
  res.status(201).json({ ok: true });
}));

app.put('/api/items/:id', auth, adminOnly, wrap(async (req, res) => {
  const id = int(req.params.id);
  const d = readItem(req.body || {});
  await tx(async (conn) => {
    const [[cur]] = await conn.query('SELECT * FROM items WHERE id = ? FOR UPDATE', [id]);
    if (!cur) fail(404, 'Barang tidak ditemukan.');
    const dipinjam = cur.stok - cur.tersedia;
    if (d.stok < dipinjam) fail(400, `Stok tidak boleh kurang dari ${dipinjam} karena sedang dipinjam.`);
    await conn.query('UPDATE items SET kode = ?, nama = ?, kategori = ?, stok = ?, tersedia = ? WHERE id = ?',
      [d.kode, d.nama, d.kategori, d.stok, d.stok - dipinjam, id]);
    await log(conn, req.user, 'barang', `Mengubah data barang ${d.nama} (${d.kode})`);
  });
  res.json({ ok: true });
}));

app.delete('/api/items/:id', auth, adminOnly, wrap(async (req, res) => {
  const id = int(req.params.id);
  await tx(async (conn) => {
    const [[cur]] = await conn.query('SELECT * FROM items WHERE id = ? FOR UPDATE', [id]);
    if (!cur) fail(404, 'Barang tidak ditemukan.');
    if (cur.stok > cur.tersedia) fail(400, 'Barang masih dipinjam, tidak bisa dihapus.');
    await conn.query('DELETE FROM items WHERE id = ?', [id]);
    await conn.query('UPDATE transactions SET item_id = NULL WHERE item_id = ?', [id]);
    await log(conn, req.user, 'hapus', `Menghapus barang ${cur.nama} (${cur.kode})`);
  });
  res.json({ ok: true });
}));

/* =====================================================
   PEMINJAMAN & PENGEMBALIAN
===================================================== */
app.get('/api/transactions', auth, wrap(async (req, res) => {
  const status = ['dipinjam', 'selesai'].includes(req.query.status) ? req.query.status : null;
  const rows = await query(
    `SELECT * FROM transactions ${status ? 'WHERE status = ?' : ''} ORDER BY created_at DESC, id DESC LIMIT 1000`,
    status ? [status] : [],
  );
  res.json({ transactions: rows });
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

  const kode = await tx(async (conn) => {
    const [[item]] = await conn.query('SELECT * FROM items WHERE id = ? FOR UPDATE', [itemId]);
    if (!item) fail(404, 'Barang tidak ditemukan.');
    if (item.tersedia < jumlah) fail(400, `Stok ${item.nama} tidak cukup. Tersedia ${item.tersedia} unit.`);
    await conn.query('UPDATE items SET tersedia = tersedia - ? WHERE id = ?', [jumlah, itemId]);
    const [r] = await conn.query(
      'INSERT INTO transactions (peminjam, item_id, item_kode, item_nama, jumlah, tanggal_pinjam, dicatat_oleh, dicatat_nama) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [peminjam, item.id, item.kode, item.nama, jumlah, tanggal, req.user.id, req.user.full_name],
    );
    const k = `TRX-${String(r.insertId).padStart(5, '0')}`;
    await conn.query('UPDATE transactions SET kode = ? WHERE id = ?', [k, r.insertId]);
    await log(conn, req.user, 'pinjam', `${peminjam} meminjam ${jumlah} unit ${item.nama} (${k})`);
    return k;
  });
  res.status(201).json({ kode });
}));

app.post('/api/transactions/:id/return', auth, wrap(async (req, res) => {
  const id = int(req.params.id);
  const tanggal = isDate(req.body?.tanggal) ? req.body.tanggal : today();
  await tx(async (conn) => {
    const [[t]] = await conn.query('SELECT * FROM transactions WHERE id = ? FOR UPDATE', [id]);
    if (!t) fail(404, 'Transaksi tidak ditemukan.');
    if (t.status === 'selesai') fail(400, 'Transaksi ini sudah selesai.');
    if (tanggal < t.tanggal_pinjam) fail(400, 'Tanggal kembali tidak boleh sebelum tanggal pinjam.');
    if (t.item_id) await conn.query('UPDATE items SET tersedia = LEAST(stok, tersedia + ?) WHERE id = ?', [t.jumlah, t.item_id]);
    await conn.query("UPDATE transactions SET status = 'selesai', tanggal_kembali = ?, diterima_nama = ? WHERE id = ?",
      [tanggal, req.user.full_name, id]);
    await log(conn, req.user, 'kembali', `${t.peminjam} mengembalikan ${t.jumlah} unit ${t.item_nama} (${t.kode})`);
  });
  res.json({ ok: true });
}));

/* =====================================================
   PENGGUNA (ADMIN)
===================================================== */
app.get('/api/users', auth, adminOnly, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM users ORDER BY role = 'admin' DESC, created_at, id");
  res.json({ users: rows.map(publicUser) });
}));

app.post('/api/users', auth, adminOnly, wrap(async (req, res) => {
  const username = text(req.body?.username, 30).toLowerCase();
  const fullName = text(req.body?.full_name, 100);
  const password = String(req.body?.password || '');
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) fail(400, 'Username 3–30 karakter: huruf, angka, titik, atau garis bawah.');
  if (!fullName) fail(400, 'Nama lengkap wajib diisi.');
  if (password.length < 6) fail(400, 'Password minimal 6 karakter.');
  await query("INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'staff')", [username, hashPassword(password), fullName]);
  await log(pool_, req.user, 'pengguna', `Menambahkan akun staff ${fullName} (@${username})`);
  res.status(201).json({ ok: true });
}));

app.put('/api/users/:id', auth, adminOnly, wrap(async (req, res) => {
  const id = int(req.params.id);
  const fullName = text(req.body?.full_name, 100);
  const password = String(req.body?.password || '');
  if (!fullName) fail(400, 'Nama lengkap wajib diisi.');
  if (password && password.length < 6) fail(400, 'Password baru minimal 6 karakter.');
  const [u] = await query('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) fail(404, 'Pengguna tidak ditemukan.');
  if (password) await query('UPDATE users SET full_name = ?, password_hash = ? WHERE id = ?', [fullName, hashPassword(password), id]);
  else await query('UPDATE users SET full_name = ? WHERE id = ?', [fullName, id]);
  await log(pool_, req.user, 'pengguna', `Mengubah data pengguna @${u.username}`);
  res.json({ user: publicUser({ ...u, full_name: fullName }) });
}));

app.patch('/api/users/:id/status', auth, adminOnly, wrap(async (req, res) => {
  const id = int(req.params.id);
  const active = !!req.body?.is_active;
  const [u] = await query('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) fail(404, 'Pengguna tidak ditemukan.');
  if (u.role !== 'staff') fail(400, 'Hanya akun Staff yang dapat diaktifkan atau dinonaktifkan.');
  await query('UPDATE users SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
  await log(pool_, req.user, 'pengguna', `${active ? 'Mengaktifkan' : 'Menonaktifkan'} akun ${u.full_name} (@${u.username})`);
  res.json({ ok: true });
}));

/* =====================================================
   ERROR
===================================================== */
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Kode barang atau username tersebut sudah digunakan.' });
  console.error('[API]', err.code || '', err.message);
  if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_DB_ERROR') {
    return res.status(503).json({ error: 'Tabel belum dibuat. Jalankan "npm run db:init" terlebih dahulu.' });
  }
  if (err.code && /^(E[A-Z]+|PROTOCOL_|HANDSHAKE_|ER_ACCESS_DENIED)/.test(err.code)) {
    return res.status(503).json({ error: 'Tidak dapat terhubung ke TiDB. Periksa isi file .env.' });
  }
  res.status(500).json({ error: err.status ? err.message : 'Terjadi kesalahan pada server.' });
});

module.exports = app;
