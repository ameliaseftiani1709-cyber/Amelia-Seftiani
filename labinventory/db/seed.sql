-- Dibuat otomatis oleh scripts/make-seed.js — jalankan SETELAH db/schema.sql

insert into users (username, password_hash, name, role, active) values
  ('admin', 'scrypt$139b34a2abdb4bf01a9dc2af1728289f$50712efa41f18fdc087a65d6c1fea92164e1268ab6a7a98342a469553f132d036e6b663317bad8ed6e02b71942831a76b91127dc6248304b5e5d4b33a229e06f', 'Administrator Lab', 'ADMIN', true),
  ('staff', 'scrypt$864a5c5e46eaf67d3627564ec27ab7e8$797164e3effae07fec9ee453b27e441aca8dcda31f10fb444a250c048fa6037b30cba2235eadef943f3d7fb3a84d398c02e781eda46a15b23a673f7551838a04', 'Siti Rahma', 'STAFF', true),
  ('budi', 'scrypt$31a05afc53e6f9ecb1bf53df17132ea3$6f0f472d2d69ba277ac69e42d0bbd67a8ee5a4da8a445f3ef7711ad3831afa3236b5232ff199cff94482614638744ee69219aea65a042dddb081aa8df42a6cd8', 'Budi Santoso', 'STAFF', true)
on conflict (username) do nothing;

insert into items (code, name, category, stock) values
  ('BR001', 'Laptop Lenovo', 'Komputer', 5),
  ('BR002', 'Mouse Logitech', 'Aksesoris', 10),
  ('BR003', 'Keyboard Mechanical', 'Aksesoris', 8),
  ('BR004', 'Proyektor Epson', 'Multimedia', 3),
  ('BR005', 'Monitor LG', 'Komputer', 6),
  ('BR006', 'Laptop ASUS', 'Komputer', 4),
  ('BR007', 'Laptop HP', 'Komputer', 4),
  ('BR008', 'Monitor Samsung', 'Komputer', 5),
  ('BR009', 'Keyboard Logitech', 'Aksesoris', 12),
  ('BR010', 'Mouse Wireless', 'Aksesoris', 15),
  ('BR011', 'Router TP-Link', 'Jaringan', 6),
  ('BR012', 'Switch Cisco 24 Port', 'Jaringan', 3),
  ('BR013', 'Access Point Ubiquiti', 'Jaringan', 4),
  ('BR014', 'Kabel LAN 10 m', 'Jaringan', 25),
  ('BR015', 'Crimping Tool', 'Peralatan', 5),
  ('BR016', 'LAN Tester', 'Peralatan', 4),
  ('BR017', 'Layar Proyektor', 'Multimedia', 2),
  ('BR018', 'Kabel HDMI', 'Aksesoris', 14),
  ('BR019', 'Speaker Portable', 'Multimedia', 4),
  ('BR020', 'Webcam Logitech', 'Multimedia', 6),
  ('BR021', 'Headset', 'Aksesoris', 10),
  ('BR022', 'Terminal Kabel (Stopkontak)', 'Peralatan', 12),
  ('BR023', 'Flashdisk 32 GB', 'Penyimpanan', 20),
  ('BR024', 'Harddisk Eksternal 1 TB', 'Penyimpanan', 6),
  ('BR025', 'Raspberry Pi 4', 'Mikrokontroler', 5),
  ('BR026', 'Arduino Uno', 'Mikrokontroler', 10)
on conflict (code) do nothing;
