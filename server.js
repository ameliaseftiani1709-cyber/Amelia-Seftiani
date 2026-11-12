// server.js — menjalankan aplikasi di komputer
//   npm run dev      → buka http://localhost:3000
//   npm run db:init  → membuat tabel & data demo di TiDB dari schema.sql
require('dotenv').config();
const path = require('path');

if (process.argv.includes('--init')) {
  const fs = require('fs');
  const mysql = require('mysql2/promise');
  (async () => {
    const conn = await mysql.createConnection({
      host: process.env.TIDB_HOST,
      port: Number(process.env.TIDB_PORT || 4000),
      user: process.env.TIDB_USER,
      password: process.env.TIDB_PASSWORD,
      ssl: process.env.TIDB_SSL === 'false' ? undefined : { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      multipleStatements: true,
      connectTimeout: 15000,
    });
    await conn.query("SET time_zone = '+00:00'");
    await conn.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    await conn.end();
    console.log('✅ Database siap. Akun demo: admin / admin123  |  staff / staff123');
  })().catch((err) => {
    console.error('❌ Gagal:', err.code || '', err.message);
    process.exit(1);
  });
} else {
  const express = require('express');
  const app = require('./api/index.js');
  app.use(express.static(path.join(__dirname, 'public')));
  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, () => console.log(`✅ LabInv berjalan di http://localhost:${PORT}`));
}
