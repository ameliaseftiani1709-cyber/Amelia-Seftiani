'use strict';
// Driver database Supabase (PostgreSQL) lewat REST API (PostgREST), tanpa library tambahan.
// Hanya dipanggil dari server dengan SERVICE ROLE key (tidak pernah dikirim ke browser).
const { HttpError } = require('./errors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = encodeURIComponent;

function createSupabaseDb({ url, serviceKey }) {
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;
  serviceKey = String(serviceKey).trim();
  // Kunci lama (service_role) berbentuk JWT "eyJ..." → kirim juga sebagai Bearer.
  // Kunci baru (sb_secret_...) bukan JWT → cukup lewat header apikey.
  const isJwt = serviceKey.startsWith('eyJ');
  const headers = (extra = {}) => ({
    apikey: serviceKey, ...(isJwt ? { Authorization: `Bearer ${serviceKey}` } : {}), 'Content-Type': 'application/json', ...extra,
  });

  async function dbError(res) {
    let data = null;
    try { data = await res.json(); } catch (e) { /* bukan JSON */ }
    const code = data && data.code, message = (data && data.message) || '';
    console.error('Supabase error', res.status, code, message);
    if (code === 'P0001') return new HttpError(/tidak ditemukan/i.test(message) ? 404 : 409, message); // dari fungsi SQL
    if (code === '23505') return new HttpError(409, 'Data sudah ada (duplikat).');
    if (code === '23514' || code === '23502' || code === '22P02') return new HttpError(400, 'Data tidak valid.');
    // Sertakan alasan dari Supabase (bukan data rahasia) agar mudah didiagnosis saat deploy.
    const detail = String(message || res.statusText || '').slice(0, 200);
    return new HttpError(502, `Terjadi kesalahan pada database [${code || res.status}] ${detail}`.trim());
  }

  async function sb(method, path, { body, prefer } = {}) {
    const res = await fetch(`${base}/${path}`, {
      method, headers: headers(prefer ? { Prefer: prefer } : {}), body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw await dbError(res);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const one = r => (Array.isArray(r) ? r[0] : r) || null;
  const guardId = id => { if (!UUID_RE.test(String(id))) throw new HttpError(400, 'ID tidak valid.'); return id; };

  const mapUser = r => r && ({ id: r.id, username: r.username, passwordHash: r.password_hash, name: r.name, role: r.role, active: r.active, createdAt: r.created_at });
  const mapItem = r => r && ({ id: r.id, code: r.code, name: r.name, category: r.category, stock: r.stock, createdAt: r.created_at });
  const mapTx = r => r && ({
    id: r.id, itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, borrower: r.borrower, qty: r.qty,
    borrowDate: r.borrow_date, returnDate: r.return_date, status: r.status, createdBy: r.created_by,
    returnedBy: r.returned_by, createdAt: r.created_at, returnedAt: r.returned_at,
  });

  return {
    kind: 'supabase',

    async findUserByUsername(username) { return mapUser(one(await sb('GET', `users?username=eq.${enc(username)}&select=*&limit=1`))); },
    async findUserById(id) { return mapUser(one(await sb('GET', `users?id=eq.${enc(guardId(id))}&select=*&limit=1`))); },
    async listUsers() { return (await sb('GET', 'users?select=*&order=created_at.asc')).map(mapUser); },
    async createUser({ username, passwordHash, name }) {
      return mapUser(one(await sb('POST', 'users', { body: { username, password_hash: passwordHash, name, role: 'STAFF', active: true }, prefer: 'return=representation' })));
    },
    async updateUser(id, patch) {
      const body = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.passwordHash !== undefined) body.password_hash = patch.passwordHash;
      if (patch.active !== undefined) body.active = patch.active;
      return mapUser(one(await sb('PATCH', `users?id=eq.${enc(guardId(id))}`, { body, prefer: 'return=representation' })));
    },

    async listItems() { return (await sb('GET', 'items?select=*&order=code.asc&limit=5000')).map(mapItem); },
    async getItem(id) { return mapItem(one(await sb('GET', `items?id=eq.${enc(guardId(id))}&select=*&limit=1`))); },
    async findItemByCode(code) { return mapItem(one(await sb('GET', `items?code=eq.${enc(code)}&select=*&limit=1`))); },
    async createItem(d) { return mapItem(one(await sb('POST', 'items', { body: d, prefer: 'return=representation' }))); },
    async updateItem(id, d) {
      guardId(id);
      const it = mapItem(one(await sb('PATCH', `items?id=eq.${enc(id)}`, { body: d, prefer: 'return=representation' })));
      if (it) await sb('PATCH', `transactions?item_id=eq.${enc(id)}`, { body: { item_code: it.code, item_name: it.name } });
      return it;
    },
    async deleteItem(id) {
      const r = await sb('DELETE', `items?id=eq.${enc(guardId(id))}`, { prefer: 'return=representation' });
      return Array.isArray(r) && r.length > 0;
    },
    async activeQtyByItem() {
      const rows = await sb('GET', 'transactions?select=item_id,qty&status=eq.Dipinjam&limit=10000');
      const map = new Map();
      rows.forEach(r => map.set(r.item_id, (map.get(r.item_id) || 0) + r.qty));
      return map;
    },

    async listTransactions({ userId, status, limit } = {}) {
      let q = 'transactions?select=*&order=created_at.desc,id.desc';
      if (status) q += `&status=eq.${enc(status)}`;
      if (userId) { guardId(userId); q += `&or=(created_by.eq.${userId},returned_by.eq.${userId})`; }
      q += `&limit=${limit || 1000}`;
      return (await sb('GET', q)).map(mapTx);
    },
    async countTransactions({ status } = {}) {
      const q = `transactions?select=id${status ? `&status=eq.${enc(status)}` : ''}&limit=1`;
      const res = await fetch(`${base}/${q}`, { headers: headers({ Prefer: 'count=exact' }) });
      if (!res.ok) throw await dbError(res);
      const n = parseInt((res.headers.get('content-range') || '').split('/')[1], 10);
      return Number.isFinite(n) ? n : 0;
    },

    async borrow({ itemId, borrower, qty, date, userId }) {
      guardId(itemId); guardId(userId);
      return mapTx(one(await sb('POST', 'rpc/borrow_item', { body: { p_item: itemId, p_borrower: borrower, p_qty: qty, p_date: date, p_user: userId } })));
    },
    async returnTransaction(id, userId) {
      guardId(userId);
      return mapTx(one(await sb('POST', 'rpc/return_item', { body: { p_trx: id, p_user: userId } })));
    },
  };
}

module.exports = { createSupabaseDb };
