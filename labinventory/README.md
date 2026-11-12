# LabInventory — Laboratory Inventory & Borrowing Management System

Aplikasi web untuk mengelola inventaris dan peminjaman barang laboratorium (Admin & Staff).

## Teknologi
- **Frontend:** HTML, CSS, JavaScript murni (folder `public/`)
- **Backend:** Node.js REST API tanpa dependensi, berjalan sebagai Vercel Serverless Function (`api/`, `lib/`)
- **Database:** Supabase (PostgreSQL) — skema di `db/schema.sql`
- **Autentikasi:** username + password (hash scrypt), token JWT HS256, pembatasan akses per role
- **Hosting:** Vercel (frontend + API dalam satu URL)

## Struktur
```
public/            index.html (login), admin.html, staff.html, css/, js/app.js
api/[...path].js   pintu masuk Vercel untuk semua /api/*
lib/               handler API, driver database (Supabase & memori), keamanan
db/                schema.sql, seed.sql
server.js          server lokal (npm run dev)
test/              tes otomatis (npm test)
```

## Menjalankan lokal (tanpa Supabase)
Butuh Node.js 18+ (disarankan 20).
```
npm run dev        # buka http://localhost:3000
npm test           # 14 tes otomatis
```
Tanpa `SUPABASE_URL`, server memakai database **memori** (data hilang saat restart) — hanya untuk uji lokal.

## Deploy (wajib online) — langkah demi langkah

### 1. Database (Supabase)
1. Buat project di https://supabase.com (gratis).
2. Buka **SQL Editor**, jalankan isi `db/schema.sql`, lalu jalankan isi `db/seed.sql`.
   Hasilnya: 26 barang (BR001–BR005 dari soal + tambahan) dan 3 akun demo.
3. Buka **Project Settings → API**, catat:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** → `SUPABASE_SERVICE_KEY` (**rahasia**, jangan pernah ditaruh di frontend / GitHub)

### 2. GitHub
Upload seluruh isi folder ini ke repository GitHub (file `.env` tidak ikut karena ada di `.gitignore`).

### 3. Vercel
1. https://vercel.com → **Add New → Project** → import repository tadi.
2. **Framework Preset: Other** (biarkan Build Command kosong; `vercel.json` sudah mengatur folder `public`).
3. Tambahkan **Environment Variables**:
   | Nama | Isi |
   |------|-----|
   | `SUPABASE_URL` | Project URL Supabase |
   | `SUPABASE_SERVICE_KEY` | service_role key |
   | `JWT_SECRET` | string acak ≥ 32 karakter: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
4. **Deploy**. Buka `https://<project>.vercel.app/api/health` → harus menjawab `{"ok":true,"db":"supabase"}`.
5. Buka URL utama, login memakai akun demo, lalu coba tambah barang / pinjam / kembalikan.

## Akun demo
| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Staff | `staff` | `staff123` |

Untuk mengganti password demo: ubah `lib/seed.js`, jalankan `npm run seed`, lalu jalankan ulang `db/seed.sql` (atau ubah lewat menu Pengguna di halaman Admin).

## Hak akses
| Fitur | Admin | Staff |
|-------|:----:|:----:|
| Login / logout, dashboard | ✔ | ✔ |
| Lihat daftar & ketersediaan barang | ✔ | ✔ |
| Tambah / ubah / hapus barang | ✔ | ✘ |
| Catat peminjaman & pengembalian | ✔ | ✔ |
| Riwayat transaksi | semua | yang ia catat |
| Lihat, tambah, ubah, aktif/nonaktifkan Staff | ✔ | ✘ |

Pembatasan dicek **di server** pada setiap request, bukan hanya di tampilan.

## Endpoint API
| Method | Path | Akses |
|--------|------|-------|
| POST | `/api/auth/login` | publik |
| GET | `/api/auth/me` | login |
| GET | `/api/dashboard` | login |
| GET | `/api/items` | login |
| POST / PUT / DELETE | `/api/items`, `/api/items/:id` | Admin |
| GET | `/api/transactions` (riwayat), `?view=active` (pinjaman aktif) | login |
| POST | `/api/transactions` (pinjam) | login |
| POST | `/api/transactions/:id/return` (kembalikan) | login |
| GET / POST | `/api/users` | Admin |
| PUT | `/api/users/:id` | Admin |
| PATCH | `/api/users/:id/active` | Admin |

## Catatan teknis
- Stok tersedia = stok total − jumlah yang sedang dipinjam. Saat pengembalian diproses, status menjadi **Selesai** dan stok tersedia otomatis bertambah.
- Peminjaman & pengembalian dijalankan oleh fungsi SQL (`borrow_item`, `return_item`) dengan penguncian baris, sehingga stok tidak bisa minus walau dua petugas meminjam bersamaan.
- Riwayat tetap tersimpan walau barang kemudian dihapus (nama & kode barang disalin ke transaksi). Barang yang masih dipinjam tidak bisa dihapus.
- Tabel Supabase memakai RLS tanpa policy: anon key tidak dapat membaca data; hanya backend (service_role) yang bisa.

## Daftar pengumpulan (dari soal)
1. Nama lengkap: …
2. NIM: …
3. URL aplikasi: `https://<project>.vercel.app`
4. URL repository GitHub: …
5. Admin demo: `admin` / `admin123`
6. Staff demo: `staff` / `staff123`
7. Teknologi: HTML, CSS, JavaScript, Node.js (Vercel Serverless), Supabase PostgreSQL
