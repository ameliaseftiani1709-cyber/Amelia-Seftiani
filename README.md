# LabInv — Laboratory Inventory & Borrowing Management System

HTML, CSS, JavaScript + Node.js (Express) + database TiDB Cloud. Hosting: Vercel.

Akun demo: **admin / admin123** (Admin) dan **staff / staff123** (Staff).

## Struktur
```
lab-inventory-tidb/
├── api/index.js       Backend (koneksi TiDB + semua endpoint)
├── public/            Tampilan: index.html, style.css, app.js
├── schema.sql         Tabel, 8 data barang, akun demo
├── server.js          Menjalankan aplikasi di komputer
├── package.json
├── vercel.json
├── .env.example       Contoh konfigurasi (salin jadi .env)
└── .gitignore
```

## Urutan pengerjaan
1. **TiDB**: buat file `.env` (salin dari `.env.example`), isi dari TiDB Cloud.
2. `npm install`
3. `npm run db:init`   → membuat tabel dan data demo
4. `npm run dev`       → buka http://localhost:3000 (cek http://localhost:3000/api/health)
5. Upload ke GitHub (folder `api` dan `public` harus ikut sebagai folder; jangan upload `.env`).
6. Vercel: import repo, isi Environment Variables (TIDB_HOST, TIDB_PORT, TIDB_USER, TIDB_PASSWORD, TIDB_DATABASE, JWT_SECRET), Deploy.

Teknologi: HTML, CSS, JavaScript, Node.js, Express, mysql2, TiDB Cloud, Vercel.
