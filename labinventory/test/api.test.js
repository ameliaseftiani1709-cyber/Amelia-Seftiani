'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildServer } = require('../server');
const { createHandler } = require('../lib/handler');
const { createMemoryDb } = require('../lib/db-memory');

let server, base;
test.before(async () => {
  server = buildServer(createHandler(createMemoryDb(), { secret: 'test-secret-test-secret-test-secret-123' }));
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const login = async (u, p) => (await call('POST', '/api/auth/login', { body: { username: u, password: p } }));

let admin, staff;
const today = new Date().toISOString().slice(0, 10);

test('login: sukses, salah password, field kosong', async () => {
  const a = await login('admin', 'admin123'); assert.equal(a.status, 200); assert.equal(a.data.user.role, 'ADMIN'); admin = a.data.token;
  const s = await login('staff', 'staff123'); assert.equal(s.status, 200); assert.equal(s.data.user.role, 'STAFF'); staff = s.data.token;
  assert.ok(!('passwordHash' in a.data.user));
  assert.equal((await login('admin', 'salah')).status, 401);
  assert.equal((await login('tidakada', 'x')).status, 401);
  assert.equal((await login('', '')).status, 400);
});

test('tanpa token / token palsu → 401', async () => {
  assert.equal((await call('GET', '/api/items')).status, 401);
  assert.equal((await call('GET', '/api/items', { token: 'abc.def.ghi' })).status, 401);
});

test('data awal: 26 barang, BR001–BR005 sesuai soal', async () => {
  const { status, data } = await call('GET', '/api/items', { token: staff });
  assert.equal(status, 200); assert.ok(data.items.length >= 5);
  const by = c => data.items.find(i => i.code === c);
  assert.deepEqual([by('BR001').stock, by('BR002').stock, by('BR003').stock, by('BR004').stock, by('BR005').stock], [5, 10, 8, 3, 6]);
  assert.equal(by('BR001').name, 'Laptop Lenovo');
});

test('Staff tidak boleh kelola barang & pengguna (403), Admin boleh', async () => {
  const item = { code: 'BR900', name: 'Uji', category: 'Tes', stock: 2 };
  assert.equal((await call('POST', '/api/items', { token: staff, body: item })).status, 403);
  assert.equal((await call('GET', '/api/users', { token: staff })).status, 403);
  assert.equal((await call('POST', '/api/users', { token: staff, body: { username: 'x1x', name: 'X', password: '123456' } })).status, 403);
  const r = await call('POST', '/api/items', { token: admin, body: item });
  assert.equal(r.status, 201); assert.equal(r.data.item.available, 2);
  const id = r.data.item.id;
  assert.equal((await call('POST', '/api/items', { token: admin, body: item })).status, 409);           // kode ganda
  assert.equal((await call('PUT', `/api/items/${id}`, { token: staff, body: item })).status, 403);
  const up = await call('PUT', `/api/items/${id}`, { token: admin, body: { ...item, name: 'Uji Edit', stock: 4 } });
  assert.equal(up.status, 200); assert.equal(up.data.item.name, 'Uji Edit');
  assert.equal((await call('DELETE', `/api/items/${id}`, { token: staff })).status, 403);
  assert.equal((await call('DELETE', `/api/items/${id}`, { token: admin })).status, 200);
  assert.equal((await call('POST', '/api/items', { token: admin, body: { ...item, stock: -1 } })).status, 400);
});

test('peminjaman → stok berkurang, pengembalian → stok kembali & status Selesai', async () => {
  const items = (await call('GET', '/api/items', { token: staff })).data.items;
  const laptop = items.find(i => i.code === 'BR001');
  const b = await call('POST', '/api/transactions', { token: staff, body: { borrower: 'Andi', itemId: laptop.id, qty: 2, date: today } });
  assert.equal(b.status, 201); assert.equal(b.data.transaction.status, 'Dipinjam'); assert.match(b.data.transaction.id, /^TRX-\d+$/);
  const trx = b.data.transaction.id;

  let now = (await call('GET', '/api/items', { token: staff })).data.items.find(i => i.code === 'BR001');
  assert.equal(now.available, 3); assert.equal(now.borrowed, 2);

  // validasi
  assert.equal((await call('POST', '/api/transactions', { token: staff, body: { borrower: 'Andi', itemId: laptop.id, qty: 99, date: today } })).status, 409);
  assert.equal((await call('POST', '/api/transactions', { token: staff, body: { borrower: '', itemId: laptop.id, qty: 1, date: today } })).status, 400);
  assert.equal((await call('POST', '/api/transactions', { token: staff, body: { borrower: 'A', itemId: laptop.id, qty: 0, date: today } })).status, 400);
  assert.equal((await call('POST', '/api/transactions', { token: staff, body: { borrower: 'A', itemId: laptop.id, qty: 1, date: '31-12-2026' } })).status, 400);

  // tidak bisa hapus / kurangi stok di bawah jumlah dipinjam
  assert.equal((await call('DELETE', `/api/items/${laptop.id}`, { token: admin })).status, 409);
  assert.equal((await call('PUT', `/api/items/${laptop.id}`, { token: admin, body: { code: 'BR001', name: 'Laptop Lenovo', category: 'Komputer', stock: 1 } })).status, 409);

  // pinjaman aktif terlihat oleh Admin dan Staff lain
  const act = await call('GET', '/api/transactions?view=active', { token: admin });
  assert.ok(act.data.transactions.some(t => t.id === trx));

  const r = await call('POST', `/api/transactions/${trx}/return`, { token: admin });
  assert.equal(r.status, 200); assert.equal(r.data.transaction.status, 'Selesai'); assert.ok(r.data.transaction.returnDate);
  now = (await call('GET', '/api/items', { token: staff })).data.items.find(i => i.code === 'BR001');
  assert.equal(now.available, 5); assert.equal(now.borrowed, 0);
  assert.equal((await call('POST', `/api/transactions/${trx}/return`, { token: staff })).status, 409);   // sudah selesai
  assert.equal((await call('POST', '/api/transactions/TRX-9999/return', { token: staff })).status, 404);
});

test('riwayat: Admin melihat semua, Staff hanya miliknya', async () => {
  const items = (await call('GET', '/api/items', { token: admin })).data.items;
  const mouse = items.find(i => i.code === 'BR002');
  await call('POST', '/api/transactions', { token: admin, body: { borrower: 'Oleh Admin', itemId: mouse.id, qty: 1, date: today } });
  const all = (await call('GET', '/api/transactions', { token: admin })).data.transactions;
  const mine = (await call('GET', '/api/transactions', { token: staff })).data.transactions;
  assert.ok(all.length > mine.length);
  assert.ok(mine.every(t => t.createdByName === 'Siti Rahma' || t.returnedByName === 'Siti Rahma'));
  assert.ok(all.some(t => t.createdByName === 'Administrator Lab'));
});

test('dashboard: statistik konsisten', async () => {
  const { status, data } = await call('GET', '/api/dashboard', { token: admin });
  assert.equal(status, 200);
  const s = data.stats;
  assert.equal(s.totalUnits, s.available + s.borrowed);
  assert.equal(s.borrowed, 1);
  assert.ok(s.totalTransactions >= 2); assert.equal(s.activeTransactions, 1);
});

test('kelola Staff: tambah, login, ubah, nonaktifkan, aktifkan', async () => {
  assert.equal((await call('POST', '/api/users', { token: admin, body: { username: 'AB', name: 'Pendek', password: '123456' } })).status, 400);
  assert.equal((await call('POST', '/api/users', { token: admin, body: { username: 'andi.staff', name: 'Andi', password: '123' } })).status, 400);
  const c = await call('POST', '/api/users', { token: admin, body: { username: 'Andi.Staff', name: 'Andi Staff', password: 'rahasia1' } });
  assert.equal(c.status, 201); assert.equal(c.data.user.role, 'STAFF'); assert.equal(c.data.user.username, 'andi.staff');
  assert.equal((await call('POST', '/api/users', { token: admin, body: { username: 'andi.staff', name: 'Dup', password: 'rahasia1' } })).status, 409);
  const id = c.data.user.id;

  const l = await login('andi.staff', 'rahasia1'); assert.equal(l.status, 200);
  const tok = l.data.token;
  assert.equal((await call('PUT', `/api/users/${id}`, { token: admin, body: { name: 'Andi Baru', password: 'passbaru1' } })).status, 200);
  assert.equal((await login('andi.staff', 'rahasia1')).status, 401);
  assert.equal((await login('andi.staff', 'passbaru1')).status, 200);

  assert.equal((await call('PATCH', `/api/users/${id}/active`, { token: admin, body: { active: false } })).status, 200);
  assert.equal((await login('andi.staff', 'passbaru1')).status, 403);          // tidak bisa login
  assert.equal((await call('GET', '/api/items', { token: tok })).status, 401);  // token lama langsung mati
  assert.equal((await call('PATCH', `/api/users/${id}/active`, { token: admin, body: { active: true } })).status, 200);
  assert.equal((await login('andi.staff', 'passbaru1')).status, 200);

  const list = (await call('GET', '/api/users', { token: admin })).data.users;
  assert.ok(list.length >= 4); assert.ok(list.every(u => !('passwordHash' in u)));
  const adminUser = list.find(u => u.role === 'ADMIN');
  assert.equal((await call('PATCH', `/api/users/${adminUser.id}/active`, { token: admin, body: { active: false } })).status, 409);
});

test('endpoint tidak dikenal → 404, health check', async () => {
  assert.equal((await call('GET', '/api/tidak-ada', { token: admin })).status, 404);
  const h = await call('GET', '/api/health'); assert.equal(h.status, 200); assert.equal(h.data.ok, true);
});

test('dua peminjaman bersamaan tidak membuat stok minus', async () => {
  const items = (await call('GET', '/api/items', { token: admin })).data.items;
  const proj = items.find(i => i.code === 'BR004');   // stok 3
  const results = await Promise.all(Array.from({ length: 6 }, () =>
    call('POST', '/api/transactions', { token: staff, body: { borrower: 'Rebutan', itemId: proj.id, qty: 1, date: today } })));
  assert.equal(results.filter(r => r.status === 201).length, 3);
  assert.equal(results.filter(r => r.status === 409).length, 3);
  const now = (await call('GET', '/api/items', { token: staff })).data.items.find(i => i.code === 'BR004');
  assert.equal(now.available, 0);
});
