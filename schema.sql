-- =====================================================
-- LAB INVENTORY (TiDB) — tabel, data awal, akun demo
-- Jalankan: npm run db:init  (atau tempel di SQL Editor TiDB Cloud)
-- Ingin mulai dari nol? Hapus tanda -- pada baris DROP di bawah.
-- =====================================================
-- DROP DATABASE IF EXISTS lab_inventory;
CREATE DATABASE IF NOT EXISTS lab_inventory;
USE lab_inventory;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(30) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role ENUM('admin','staff') NOT NULL DEFAULT 'staff',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) AUTO_ID_CACHE=1;

CREATE TABLE IF NOT EXISTS items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kode VARCHAR(20) NOT NULL UNIQUE,
  nama VARCHAR(100) NOT NULL,
  kategori VARCHAR(50) NOT NULL,
  stok INT NOT NULL DEFAULT 0,
  tersedia INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) AUTO_ID_CACHE=1;

CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kode VARCHAR(20) NULL UNIQUE,
  peminjam VARCHAR(100) NOT NULL,
  item_id INT NULL,
  item_kode VARCHAR(20) NOT NULL,
  item_nama VARCHAR(100) NOT NULL,
  jumlah INT NOT NULL,
  tanggal_pinjam DATE NOT NULL,
  tanggal_kembali DATE NULL,
  status ENUM('dipinjam','selesai') NOT NULL DEFAULT 'dipinjam',
  dicatat_oleh INT NULL,
  dicatat_nama VARCHAR(100) NULL,
  diterima_nama VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_trx_status (status),
  INDEX idx_trx_created (created_at)
) AUTO_ID_CACHE=1;

CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_name VARCHAR(100) NULL,
  aksi VARCHAR(20) NOT NULL,
  detail VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_logs_created (created_at)
) AUTO_ID_CACHE=1;

-- Akun demo: admin / admin123 (Admin), staff / staff123 (Staff)
INSERT IGNORE INTO users (id, username, password_hash, full_name, role, is_active) VALUES
(1, 'admin', 'scrypt$98abc476e55e6a36d07d5c1bddaee0f3$a85e815a4b2f21e52cb6ffbac26a38e2a3d597a922f8848a1618ba034b61c2af2c0a436d0f3fd94d25b5379c7e509b218a04197322fc1007cd36214cdedd93d8', 'Administrator Lab', 'admin', 1),
(2, 'staff', 'scrypt$c9e7582112752cec9cdc4d973d124811$1583f8111451b8166c216e2d589d4a37e939215ff4b988a28e917039561bb0b5580a1e935f2786cda3c38035a23a230b7930f82853b2d9d9c00ef8bbe7fdd683', 'Rina Lestari', 'staff', 1);

-- Data barang (BR001–BR005 wajib dari soal). Laptop: 2 unit sedang dipinjam.
INSERT IGNORE INTO items (id, kode, nama, kategori, stok, tersedia) VALUES
(1,'BR001','Laptop Lenovo','Laptop',5,3),
(2,'BR002','Mouse Logitech','Aksesoris',10,10),
(3,'BR003','Keyboard Mechanical','Aksesoris',8,8),
(4,'BR004','Proyektor Epson','Presentasi',3,3),
(5,'BR005','Monitor LG','Monitor',6,6),
(6,'BR006','Router MikroTik','Jaringan',3,3),
(7,'BR007','Kabel LAN 5m','Jaringan',20,20),
(8,'BR008','Kabel HDMI 3m','Kabel',10,10);

INSERT IGNORE INTO transactions (id, kode, peminjam, item_id, item_kode, item_nama, jumlah, tanggal_pinjam, tanggal_kembali, status, dicatat_oleh, dicatat_nama, diterima_nama, created_at) VALUES
(1,'TRX-00001','Bayu Saputra',2,'BR002','Mouse Logitech',4,DATE_SUB(CURDATE(), INTERVAL 5 DAY),DATE_SUB(CURDATE(), INTERVAL 3 DAY),'selesai',2,'Rina Lestari','Administrator Lab',DATE_SUB(NOW(), INTERVAL 5 DAY)),
(2,'TRX-00002','Andi Pratama',1,'BR001','Laptop Lenovo',2,DATE_SUB(CURDATE(), INTERVAL 1 DAY),NULL,'dipinjam',2,'Rina Lestari',NULL,DATE_SUB(NOW(), INTERVAL 1 DAY));

INSERT IGNORE INTO activity_logs (id, actor_name, aksi, detail, created_at) VALUES
(1,'Rina Lestari','pinjam','Bayu Saputra meminjam 4 unit Mouse Logitech (TRX-00001)',DATE_SUB(NOW(), INTERVAL 5 DAY)),
(2,'Administrator Lab','kembali','Bayu Saputra mengembalikan 4 unit Mouse Logitech (TRX-00001)',DATE_SUB(NOW(), INTERVAL 3 DAY)),
(3,'Rina Lestari','pinjam','Andi Pratama meminjam 2 unit Laptop Lenovo (TRX-00002)',DATE_SUB(NOW(), INTERVAL 1 DAY));
