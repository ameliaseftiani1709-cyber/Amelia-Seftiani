'use strict';
// Smoke test frontend: memuat public/js/app.js dengan DOM tiruan, terhubung ke API sungguhan (database memori).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildServer } = require('../server');
const { createHandler } = require('../lib/handler');
const { createMemoryDb } = require('../lib/db-memory');

const APP = path.join(__dirname, '..', 'public', 'js', 'app.js');
let server, base;
test.before(async () => {
  server = buildServer(createHandler(createMemoryDb(), { secret: 'test-secret-test-secret-test-secret-123' }));
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

function makeEnv(page, hash, store = {}) {
  const els = new Map();
  const el = () => ({
    innerHTML: '', value: '', hidden: false, dataset: {}, style: {}, textContent: '', disabled: false,
    classList: { toggle() {}, remove() {} }, addEventListener() {}, appendChild() {}, remove() {},
    querySelector: s => get(s), closest: () => null, selectedOptions: [],
  });
  const get = s => { if (!els.has(s)) els.set(s, el()); return els.get(s); };
  const g = global;
  g.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  g.document = { querySelector: get, querySelectorAll: () => [], createElement: el, addEventListener() {}, removeEventListener() {}, body: el() };
  g.location = { hash, href: '' };
  g.window = { LIMS_PAGE: page, LIMS_API: base, addEventListener() {} };
  g.FormData = class { [Symbol.iterator]() { return Object.entries(g.__form || {})[Symbol.iterator](); } };
  return { get, store, location: g.location };
}
async function boot(page, hash, store) {
  const env = makeEnv(page, hash, store);
  delete require.cache[require.resolve(APP)];
  require(APP);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 50));
    const h = env.get('#app').innerHTML;
    if (env.location.href || /<h[12]>/.test(h)) break;
  }
  return env;
}
const heading = env => (/<h[12]>([^<]+)/.exec(env.get('#app').innerHTML) || [])[1];

let adminToken, staffToken;
test('login lewat halaman login → diarahkan sesuai role', async () => {
  for (const [u, p, target] of [['admin', 'admin123', 'admin.html'], ['staff', 'staff123', 'staff.html']]) {
    const env = await boot('login', '');
    assert.equal(heading(env), 'Masuk ke akun Anda');
    global.__form = { username: u, password: p };
    await env.get('#login-form').onsubmit({ preventDefault() {}, target: {} });
    assert.equal(env.location.href, target);
    assert.ok(env.store.lims_token);
    if (u === 'admin') adminToken = env.store.lims_token; else staffToken = env.store.lims_token;
  }
  global.__form = { username: 'admin', password: 'salah' };
  const env = await boot('login', '');
  await env.get('#login-form').onsubmit({ preventDefault() {}, target: {} });
  assert.match(env.get('#l-err').textContent, /salah/i);
  assert.equal(env.location.href, '');
});

test('halaman admin: semua menu tampil dengan data dari server', async () => {
  const expect = { dashboard: 'Dashboard', barang: 'Data Barang', peminjaman: 'Peminjaman Barang', pengembalian: 'Pengembalian Barang', riwayat: 'Riwayat Transaksi', pengguna: 'Manajemen Pengguna' };
  for (const [route, h] of Object.entries(expect)) {
    const env = await boot('admin', '#/' + route, { lims_token: adminToken });
    assert.equal(heading(env), h, route);
    assert.equal(env.location.href, '');
  }
  const barang = await boot('admin', '#/barang', { lims_token: adminToken });
  assert.match(barang.get('#tbody').innerHTML, /BR001/);
  assert.match(barang.get('#tbody').innerHTML, /data-edit/);        // Admin punya tombol edit/hapus
  assert.match(barang.get('#app').innerHTML, /Tambah Barang/);
  const dash = await boot('admin', '#/dashboard', { lims_token: adminToken });
  assert.match(dash.get('#app').innerHTML, /Total Barang/);
  assert.match(dash.get('#app').innerHTML, /Total Transaksi/);
  const users = await boot('admin', '#/pengguna', { lims_token: adminToken });
  assert.match(users.get('#app').innerHTML, /budi/);
});

test('halaman staff: tanpa aksi Admin', async () => {
  const barang = await boot('staff', '#/barang', { lims_token: staffToken });
  assert.equal(heading(barang), 'Data Barang');
  assert.match(barang.get('#tbody').innerHTML, /BR001/);
  assert.doesNotMatch(barang.get('#tbody').innerHTML, /data-edit|data-del/);
  assert.doesNotMatch(barang.get('#app').innerHTML, /Tambah Barang|#\/pengguna/);
  const pg = await boot('staff', '#/pengguna', { lims_token: staffToken });
  assert.equal(heading(pg), 'Dashboard');                           // rute Admin ditolak
});

test('penjaga halaman: salah role / belum login → dialihkan', async () => {
  assert.equal((await boot('admin', '', { lims_token: staffToken })).location.href, 'staff.html');
  assert.equal((await boot('staff', '', { lims_token: adminToken })).location.href, 'admin.html');
  assert.equal((await boot('admin', '', {})).location.href, 'index.html');
  assert.equal((await boot('staff', '', { lims_token: 'token.palsu.x' })).location.href, 'index.html');
  assert.equal((await boot('login', '', { lims_token: adminToken })).location.href, 'admin.html');
});
