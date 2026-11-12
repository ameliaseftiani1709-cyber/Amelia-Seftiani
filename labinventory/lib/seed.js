'use strict';
// Data awal: 5 barang wajib dari soal (BR001–BR005) + tambahan.
const ITEMS = [
  ['BR001', 'Laptop Lenovo', 'Komputer', 5],
  ['BR002', 'Mouse Logitech', 'Aksesoris', 10],
  ['BR003', 'Keyboard Mechanical', 'Aksesoris', 8],
  ['BR004', 'Proyektor Epson', 'Multimedia', 3],
  ['BR005', 'Monitor LG', 'Komputer', 6],
  ['BR006', 'Laptop ASUS', 'Komputer', 4],
  ['BR007', 'Laptop HP', 'Komputer', 4],
  ['BR008', 'Monitor Samsung', 'Komputer', 5],
  ['BR009', 'Keyboard Logitech', 'Aksesoris', 12],
  ['BR010', 'Mouse Wireless', 'Aksesoris', 15],
  ['BR011', 'Router TP-Link', 'Jaringan', 6],
  ['BR012', 'Switch Cisco 24 Port', 'Jaringan', 3],
  ['BR013', 'Access Point Ubiquiti', 'Jaringan', 4],
  ['BR014', 'Kabel LAN 10 m', 'Jaringan', 25],
  ['BR015', 'Crimping Tool', 'Peralatan', 5],
  ['BR016', 'LAN Tester', 'Peralatan', 4],
  ['BR017', 'Layar Proyektor', 'Multimedia', 2],
  ['BR018', 'Kabel HDMI', 'Aksesoris', 14],
  ['BR019', 'Speaker Portable', 'Multimedia', 4],
  ['BR020', 'Webcam Logitech', 'Multimedia', 6],
  ['BR021', 'Headset', 'Aksesoris', 10],
  ['BR022', 'Terminal Kabel (Stopkontak)', 'Peralatan', 12],
  ['BR023', 'Flashdisk 32 GB', 'Penyimpanan', 20],
  ['BR024', 'Harddisk Eksternal 1 TB', 'Penyimpanan', 6],
  ['BR025', 'Raspberry Pi 4', 'Mikrokontroler', 5],
  ['BR026', 'Arduino Uno', 'Mikrokontroler', 10],
];

// Akun demo (untuk diserahkan ke dosen). Ganti password sebelum dipakai sungguhan.
const DEMO_USERS = [
  { username: 'admin', password: 'admin123', name: 'Administrator Lab', role: 'ADMIN' },
  { username: 'staff', password: 'staff123', name: 'Siti Rahma', role: 'STAFF' },
  { username: 'budi', password: 'budi123', name: 'Budi Santoso', role: 'STAFF' },
];

module.exports = { ITEMS, DEMO_USERS };
