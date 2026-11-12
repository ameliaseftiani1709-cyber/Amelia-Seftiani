'use strict';
// Membuat db/seed.sql dari lib/seed.js (password di-hash).
// Jalankan: node scripts/make-seed.js
const fs = require('fs');
const path = require('path');
const { ITEMS, DEMO_USERS } = require('../lib/seed');
const { hashPassword } = require('../lib/security');

const q = s => `'${String(s).replace(/'/g, "''")}'`;

const sql = [
  '-- Dibuat otomatis oleh scripts/make-seed.js — jalankan SETELAH db/schema.sql',
  '',
  'insert into users (username, password_hash, name, role, active) values',
  DEMO_USERS.map(u => `  (${q(u.username)}, ${q(hashPassword(u.password))}, ${q(u.name)}, ${q(u.role)}, true)`).join(',\n'),
  'on conflict (username) do nothing;',
  '',
  'insert into items (code, name, category, stock) values',
  ITEMS.map(([c, n, k, s]) => `  (${q(c)}, ${q(n)}, ${q(k)}, ${s})`).join(',\n'),
  'on conflict (code) do nothing;',
  '',
].join('\n');

fs.writeFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), sql);
console.log(`db/seed.sql dibuat: ${DEMO_USERS.length} akun, ${ITEMS.length} barang.`);
