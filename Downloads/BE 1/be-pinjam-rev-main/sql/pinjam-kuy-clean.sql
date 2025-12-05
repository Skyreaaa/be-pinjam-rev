-- Clean schema for Pinjam Kuy (includes migrated columns)
-- Safe to run multiple times (uses IF NOT EXISTS and adds columns conditionally if desired later)

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  npm VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  angkatan VARCHAR(255) NULL,
  fakultas VARCHAR(255) NULL,
  prodi VARCHAR(255) NULL,
  role ENUM('user','admin') DEFAULT 'user',
  profile_photo_url VARCHAR(255) NULL,
  denda DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  denda_unpaid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  active_loans_count INT NOT NULL DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS books (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  kodeBuku VARCHAR(50) NOT NULL UNIQUE,
  author VARCHAR(255) NOT NULL,
  publisher VARCHAR(255) NULL,
  publicationYear YEAR(4) NULL,
  totalStock INT NOT NULL DEFAULT 0,
  availableStock INT NOT NULL DEFAULT 0,
  category VARCHAR(100) NOT NULL,
  image_url VARCHAR(255) NULL,
  location VARCHAR(100) NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  book_id INT NOT NULL,
  loanDate DATETIME NULL,
  expectedReturnDate DATE NULL,
  actualReturnDate DATETIME NULL,
  approvedAt DATETIME NULL,
  status ENUM('Menunggu Persetujuan','Disetujui','Diambil','Sedang Dipinjam','Terlambat','Siap Dikembalikan','Dikembalikan','Ditolak') DEFAULT 'Menunggu Persetujuan',
  kodePinjam VARCHAR(40) NULL,
  purpose TEXT NULL,
  fineAmount INT NOT NULL DEFAULT 0,
  finePaid TINYINT(1) NOT NULL DEFAULT 0,
  finePaymentStatus ENUM('unpaid','awaiting_proof','pending_verification','paid') NOT NULL DEFAULT 'unpaid',
  finePaymentMethod VARCHAR(30) NULL,
  finePaymentProof VARCHAR(255) NULL,
  finePaymentAt DATETIME NULL,
  returnProofUrl VARCHAR(255) NULL,
  readyReturnDate DATETIME NULL,
  userNotified TINYINT(1) NOT NULL DEFAULT 0,
  returnNotified TINYINT(1) NOT NULL DEFAULT 0,
  returnDecision ENUM('approved','rejected') NULL,
  rejectionDate DATETIME NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_loans_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_loans_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_kodePinjam (kodePinjam)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Minimal seed admin (password hash sama dengan sebelumnya)
INSERT INTO users (npm,password,username,role) 
SELECT '123456', '$2b$10$IKolWxl/DByohJrDrc2qCOKXeMNrHfDN9AYKiSBkryefB/Uz3i7rK', 'Admin Perpustakaan', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE npm='123456');

-- Sample books (hanya jika belum ada)
INSERT INTO books (title,kodeBuku,author,publisher,publicationYear,totalStock,availableStock,category,image_url,location)
SELECT 'Madilog','BK-0001','Tan Malaka','Pustaka',1943,5,5,'Filsafat',NULL,'Rak A'
WHERE NOT EXISTS (SELECT 1 FROM books WHERE kodeBuku='BK-0001');
INSERT INTO books (title,kodeBuku,author,publisher,publicationYear,totalStock,availableStock,category,image_url,location)
SELECT 'Algoritma Dasar','BK-0002','Anonim','Teknos',2020,3,3,'Teknik',NULL,'Rak B'
WHERE NOT EXISTS (SELECT 1 FROM books WHERE kodeBuku='BK-0002');

-- Helpful index additions (id driven already OK)
CREATE INDEX IF NOT EXISTS idx_loans_user ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_book ON loans(book_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
