'use strict';
// Driver database di memori — untuk pengembangan lokal & pengujian otomatis.
// Data hilang saat server berhenti. Produksi memakai lib/db-supabase.js.
const crypto = require('crypto');
const { ITEMS, DEMO_USERS } = require('./seed');
const { hashPassword } = require('./security');
const { HttpError } = require('./errors');

const wibDate = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

function createMemoryDb() {
  const now = () => new Date().toISOString();
  const users = DEMO_USERS.map(u => ({
    id: crypto.randomUUID(), username: u.username, passwordHash: hashPassword(u.password),
    name: u.name, role: u.role, active: true, createdAt: now(),
  }));
  const items = ITEMS.map(([code, name, category, stock]) => ({ id: crypto.randomUUID(), code, name, category, stock, createdAt: now() }));
  const txs = [];
  let seq = 0;
  const copy = o => (o ? { ...o } : null);
  const activeQty = itemId => txs.filter(t => t.itemId === itemId && t.status === 'Dipinjam').reduce((s, t) => s + t.qty, 0);

  return {
    kind: 'memory',

    async findUserByUsername(username) { return copy(users.find(u => u.username === username)); },
    async findUserById(id) { return copy(users.find(u => u.id === id)); },
    async listUsers() { return users.map(copy); },
    async createUser({ username, passwordHash, name }) {
      const u = { id: crypto.randomUUID(), username, passwordHash, name, role: 'STAFF', active: true, createdAt: now() };
      users.push(u); return copy(u);
    },
    async updateUser(id, patch) {
      const u = users.find(x => x.id === id); if (!u) return null;
      Object.assign(u, patch); return copy(u);
    },

    async listItems() { return items.map(copy).sort((a, b) => a.code.localeCompare(b.code)); },
    async getItem(id) { return copy(items.find(i => i.id === id)); },
    async findItemByCode(code) { return copy(items.find(i => i.code === code)); },
    async createItem(d) {
      const it = { id: crypto.randomUUID(), ...d, createdAt: now() };
      items.push(it); return copy(it);
    },
    async updateItem(id, d) {
      const it = items.find(i => i.id === id); if (!it) return null;
      Object.assign(it, d);
      txs.forEach(t => { if (t.itemId === id) { t.itemCode = it.code; t.itemName = it.name; } });
      return copy(it);
    },
    async deleteItem(id) {
      const i = items.findIndex(x => x.id === id); if (i < 0) return false;
      items.splice(i, 1);
      txs.forEach(t => { if (t.itemId === id) t.itemId = null; });
      return true;
    },
    async activeQtyByItem() {
      const map = new Map();
      txs.filter(t => t.status === 'Dipinjam').forEach(t => map.set(t.itemId, (map.get(t.itemId) || 0) + t.qty));
      return map;
    },

    async listTransactions({ userId, status, limit } = {}) {
      let list = txs.filter(t => (!status || t.status === status) && (!userId || t.createdBy === userId || t.returnedBy === userId));
      list = list.map(copy).sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : b.id.localeCompare(a.id)));
      return limit ? list.slice(0, limit) : list;
    },
    async countTransactions({ status } = {}) { return txs.filter(t => !status || t.status === status).length; },

    async borrow({ itemId, borrower, qty, date, userId }) {
      const it = items.find(i => i.id === itemId);
      if (!it) throw new HttpError(404, 'Barang tidak ditemukan.');
      const avail = it.stock - activeQty(it.id);
      if (qty > avail) throw new HttpError(409, `Stok tersedia hanya ${avail} unit.`);
      const t = {
        id: 'TRX-' + String(++seq).padStart(4, '0'), itemId: it.id, itemCode: it.code, itemName: it.name,
        borrower, qty, borrowDate: date, returnDate: null, status: 'Dipinjam',
        createdBy: userId, returnedBy: null, createdAt: now(), returnedAt: null,
      };
      txs.push(t); return copy(t);
    },
    async returnTransaction(id, userId) {
      const t = txs.find(x => x.id === id);
      if (!t) throw new HttpError(404, 'Transaksi tidak ditemukan.');
      if (t.status !== 'Dipinjam') throw new HttpError(409, 'Transaksi sudah selesai.');
      Object.assign(t, { status: 'Selesai', returnDate: wibDate(), returnedBy: userId, returnedAt: now() });
      return copy(t);
    },
  };
}

module.exports = { createMemoryDb };
