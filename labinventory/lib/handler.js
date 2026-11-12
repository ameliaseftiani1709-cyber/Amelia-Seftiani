'use strict';
// REST API LabInventory. Satu handler (req, res) yang dipakai Vercel maupun server lokal.
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./security');
const { HttpError } = require('./errors');

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TRX_RE = /^TRX-\d{1,10}$/;
const MAX_BODY = 100 * 1024;

const bad = m => new HttpError(400, m);

function text(v, label, max) {
  const s = String(v ?? '').trim();
  if (!s) throw bad(`${label} wajib diisi.`);
  if (s.length > max) throw bad(`${label} maksimal ${max} karakter.`);
  return s;
}
function int(v, label, min, max) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} harus berupa angka bulat ${min}–${max}.`);
  return n;
}
function dateStr(v, label) {
  const s = String(v ?? '').trim();
  const ok = DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
  if (!ok) throw bad(`${label} tidak valid (format YYYY-MM-DD).`);
  return s;
}
function password(v) {
  const s = String(v ?? '');
  if (s.length < 6) throw bad('Password minimal 6 karakter.');
  if (s.length > 100) throw bad('Password maksimal 100 karakter.');
  return s;
}

function createHandler(db, { secret }) {
  const DUMMY_HASH = hashPassword('dummy-password-for-timing-equalization');
  const failures = new Map(); // pembatas percobaan login (best-effort per instance)

  const send = (res, status, data) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(JSON.stringify(data));
  };

  async function readBody(req) {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { throw bad('Body harus JSON.'); } }
      return req.body;
    }
    const chunks = []; let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw new HttpError(413, 'Permintaan terlalu besar.');
      chunks.push(c);
    }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { throw bad('Body harus JSON.'); }
  }

  async function authenticate(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const payload = m && verifyToken(m[1], secret);
    if (!payload) throw new HttpError(401, 'Silakan login terlebih dahulu.');
    const user = await db.findUserById(payload.sub);
    if (!user || !user.active) throw new HttpError(401, 'Akun tidak aktif atau tidak ditemukan.');
    return user;
  }
  const requireAdmin = u => { if (u.role !== 'ADMIN') throw new HttpError(403, 'Hanya Admin yang dapat melakukan tindakan ini.'); };

  const pubUser = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active, createdAt: u.createdAt });
  const pubTx = (t, names) => ({
    id: t.id, borrower: t.borrower, itemId: t.itemId, itemCode: t.itemCode, itemName: t.itemName, qty: t.qty,
    borrowDate: t.borrowDate, returnDate: t.returnDate, status: t.status,
    createdBy: t.createdBy, createdByName: names.get(t.createdBy) || '-',
    returnedBy: t.returnedBy, returnedByName: names.get(t.returnedBy) || null,
    createdAt: t.createdAt, returnedAt: t.returnedAt,
  });
  const nameMap = async () => new Map((await db.listUsers()).map(u => [u.id, u.name]));
  const txList = async list => { const names = await nameMap(); return list.map(t => pubTx(t, names)); };

  async function itemsWithStock() {
    const [items, out] = await Promise.all([db.listItems(), db.activeQtyByItem()]);
    return items.map(i => {
      const borrowed = out.get(i.id) || 0;
      return { id: i.id, code: i.code, name: i.name, category: i.category, stock: i.stock, borrowed, available: i.stock - borrowed };
    });
  }

  function validateItem(b) {
    return {
      code: text(b.code, 'Kode', 20).toUpperCase(),
      name: text(b.name, 'Nama barang', 100),
      category: text(b.category, 'Kategori', 50),
      stock: int(b.stock, 'Stok', 0, 100000),
    };
  }

  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = (url.pathname.replace(/^\/api/, '').replace(/\/+$/, '')) || '/';
      const method = req.method;
      let m;

      if (method === 'GET' && path === '/health') return send(res, 200, { ok: true, db: db.kind });

      /* ---------- Auth ---------- */
      if (method === 'POST' && path === '/auth/login') {
        const b = await readBody(req);
        const username = String(b.username ?? '').trim().toLowerCase().slice(0, 50);
        const pw = String(b.password ?? '').slice(0, 200);
        if (!username || !pw) throw bad('Username dan password wajib diisi.');

        const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
        const key = `${ip}|${username}`, rec = failures.get(key);
        if (rec && rec.count >= 10 && Date.now() - rec.first < 10 * 60 * 1000) throw new HttpError(429, 'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.');

        const user = await db.findUserByUsername(username);
        const okPw = verifyPassword(pw, user ? user.passwordHash : DUMMY_HASH);
        if (!user || !okPw) {
          const r = rec && Date.now() - rec.first < 10 * 60 * 1000 ? rec : { count: 0, first: Date.now() };
          r.count++; failures.set(key, r);
          throw new HttpError(401, 'Username atau password salah.');
        }
        if (!user.active) throw new HttpError(403, 'Akun Anda dinonaktifkan. Hubungi Admin.');
        failures.delete(key);
        return send(res, 200, { token: signToken({ sub: user.id, role: user.role }, secret), user: pubUser(user) });
      }

      /* ---------- Wajib login di bawah ini ---------- */
      const user = await authenticate(req);
      const admin = user.role === 'ADMIN';

      if (method === 'GET' && path === '/auth/me') return send(res, 200, { user: pubUser(user) });

      if (method === 'GET' && path === '/dashboard') {
        const [items, total, active, recent] = await Promise.all([
          itemsWithStock(),
          db.countTransactions(),
          db.countTransactions({ status: 'Dipinjam' }),
          db.listTransactions({ userId: admin ? undefined : user.id, limit: 20 }),
        ]);
        const totalUnits = items.reduce((s, i) => s + i.stock, 0);
        const borrowed = items.reduce((s, i) => s + i.borrowed, 0);
        return send(res, 200, {
          stats: { itemTypes: items.length, totalUnits, borrowed, available: totalUnits - borrowed, totalTransactions: total, activeTransactions: active },
          transactions: await txList(recent),
        });
      }

      /* ---------- Barang ---------- */
      if (path === '/items') {
        if (method === 'GET') return send(res, 200, { items: await itemsWithStock() });
        if (method === 'POST') {
          requireAdmin(user);
          const d = validateItem(await readBody(req));
          if (await db.findItemByCode(d.code)) throw new HttpError(409, `Kode ${d.code} sudah digunakan.`);
          const it = await db.createItem(d);
          return send(res, 201, { item: { ...it, borrowed: 0, available: it.stock } });
        }
      }
      if ((m = /^\/items\/([^/]+)$/.exec(path))) {
        const id = decodeURIComponent(m[1]);
        if (method === 'PUT') {
          requireAdmin(user);
          const d = validateItem(await readBody(req));
          const cur = await db.getItem(id);
          if (!cur) throw new HttpError(404, 'Barang tidak ditemukan.');
          const dup = await db.findItemByCode(d.code);
          if (dup && dup.id !== id) throw new HttpError(409, `Kode ${d.code} sudah digunakan.`);
          const out = (await db.activeQtyByItem()).get(id) || 0;
          if (d.stock < out) throw new HttpError(409, `Stok tidak boleh kurang dari jumlah yang sedang dipinjam (${out}).`);
          const it = await db.updateItem(id, d);
          return send(res, 200, { item: { ...it, borrowed: out, available: it.stock - out } });
        }
        if (method === 'DELETE') {
          requireAdmin(user);
          if (!(await db.getItem(id))) throw new HttpError(404, 'Barang tidak ditemukan.');
          const out = (await db.activeQtyByItem()).get(id) || 0;
          if (out > 0) throw new HttpError(409, 'Barang masih dipinjam, tidak dapat dihapus.');
          await db.deleteItem(id);
          return send(res, 200, { ok: true });
        }
      }

      /* ---------- Transaksi ---------- */
      if (path === '/transactions') {
        if (method === 'GET') {
          // ?view=active → semua pinjaman aktif (untuk halaman Pengembalian, Admin & Staff)
          // default → riwayat: Admin semua, Staff hanya yang ia catat / proses
          const active = url.searchParams.get('view') === 'active';
          const list = await db.listTransactions(active ? { status: 'Dipinjam' } : { userId: admin ? undefined : user.id });
          return send(res, 200, { transactions: await txList(list) });
        }
        if (method === 'POST') {
          const b = await readBody(req);
          const t = await db.borrow({
            itemId: text(b.itemId, 'Barang', 64),
            borrower: text(b.borrower, 'Nama peminjam', 100),
            qty: int(b.qty, 'Jumlah', 1, 100000),
            date: dateStr(b.date, 'Tanggal peminjaman'),
            userId: user.id,
          });
          return send(res, 201, { transaction: pubTx(t, await nameMap()) });
        }
      }
      if (method === 'POST' && (m = /^\/transactions\/([^/]+)\/return$/.exec(path))) {
        const id = decodeURIComponent(m[1]);
        if (!TRX_RE.test(id)) throw new HttpError(404, 'Transaksi tidak ditemukan.');
        const t = await db.returnTransaction(id, user.id);
        return send(res, 200, { transaction: pubTx(t, await nameMap()) });
      }

      /* ---------- Pengguna (Admin) ---------- */
      if (path === '/users') {
        requireAdmin(user);
        if (method === 'GET') {
          const users = (await db.listUsers()).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
          return send(res, 200, { users: users.map(pubUser) });
        }
        if (method === 'POST') {
          const b = await readBody(req);
          const username = String(b.username ?? '').trim().toLowerCase();
          if (!USERNAME_RE.test(username)) throw bad('Username 3–30 karakter (huruf kecil, angka, titik, strip, underscore).');
          const name = text(b.name, 'Nama lengkap', 100);
          const hash = hashPassword(password(b.password));
          if (await db.findUserByUsername(username)) throw new HttpError(409, 'Username sudah digunakan.');
          return send(res, 201, { user: pubUser(await db.createUser({ username, passwordHash: hash, name })) });
        }
      }
      if ((m = /^\/users\/([^/]+)$/.exec(path)) && method === 'PUT') {
        requireAdmin(user);
        const id = decodeURIComponent(m[1]);
        const b = await readBody(req);
        if (!(await db.findUserById(id))) throw new HttpError(404, 'Pengguna tidak ditemukan.');
        const patch = { name: text(b.name, 'Nama lengkap', 100) };
        if (b.password) patch.passwordHash = hashPassword(password(b.password));
        return send(res, 200, { user: pubUser(await db.updateUser(id, patch)) });
      }
      if ((m = /^\/users\/([^/]+)\/active$/.exec(path)) && method === 'PATCH') {
        requireAdmin(user);
        const id = decodeURIComponent(m[1]);
        const b = await readBody(req);
        if (typeof b.active !== 'boolean') throw bad('Field active harus true/false.');
        const target = await db.findUserById(id);
        if (!target) throw new HttpError(404, 'Pengguna tidak ditemukan.');
        if (target.role === 'ADMIN') throw new HttpError(409, 'Akun Admin tidak dapat dinonaktifkan.');
        return send(res, 200, { user: pubUser(await db.updateUser(id, { active: b.active })) });
      }

      throw new HttpError(404, 'Endpoint tidak ditemukan.');
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      return send(res, 500, { error: 'Terjadi kesalahan pada server.' });
    }
  };
}

module.exports = { createHandler };
