-- Sample data untuk testing halaman koleksi
-- Pastikan tabel books sudah ada kolom description

-- Tambah kolom description jika belum ada
ALTER TABLE books ADD COLUMN IF NOT EXISTS description TEXT NULL AFTER location;

-- Insert sample books dengan kategori yang beragam
INSERT INTO books (title, kodeBuku, author, publisher, publicationYear, totalStock, availableStock, category, location, description)
VALUES 
('Sapiens: A Brief History of Humankind', 'BK-2024-001', 'Yuval Noah Harari', 'Harper', 2015, 5, 5, 'Sejarah', 'Rak A-1', 'Buku ini menceritakan sejarah manusia dari zaman batu hingga era modern, mengeksplorasi bagaimana Homo sapiens menjadi spesies dominan di planet ini.'),
('Clean Code: A Handbook of Agile Software Craftsmanship', 'BK-2024-002', 'Robert C. Martin', 'Prentice Hall', 2008, 3, 3, 'Komputer', 'Rak B-2', 'Panduan lengkap untuk menulis kode yang bersih, mudah dibaca, dan mudah dimaintain. Wajib dibaca untuk setiap programmer profesional.'),
('Introduction to Algorithms', 'BK-2024-003', 'Thomas H. Cormen', 'MIT Press', 2009, 4, 4, 'Komputer', 'Rak B-1', 'Buku referensi algoritma dan struktur data yang komprehensif. Digunakan di berbagai universitas terkemuka di dunia.'),
('Sapiens Grafis: Kelahiran Umat Manusia', 'BK-2024-004', 'Yuval Noah Harari', 'Kepustakaan Populer Gramedia', 2020, 2, 2, 'Sejarah', 'Rak A-2', 'Versi grafis dari buku bestseller Sapiens, lebih mudah dipahami dengan ilustrasi menarik.'),
('Harry Potter and the Philosopher Stone', 'BK-2024-005', 'J.K. Rowling', 'Bloomsbury', 1997, 8, 7, 'Fiksi', 'Rak C-1', 'Petualangan Harry Potter dimulai saat ia menerima surat penerimaan dari Sekolah Sihir Hogwarts.'),
('The Hobbit', 'BK-2024-006', 'J.R.R. Tolkien', 'Allen & Unwin', 1937, 3, 3, 'Fiksi', 'Rak C-2', 'Perjalanan epik Bilbo Baggins bersama para kurcaci untuk merebut kembali harta karun dari naga Smaug.'),
('Cosmos', 'BK-2024-007', 'Carl Sagan', 'Random House', 1980, 2, 2, 'Sains', 'Rak D-1', 'Eksplorasi menakjubkan tentang alam semesta, dari atom terkecil hingga galaksi terjauh.'),
('A Brief History of Time', 'BK-2024-008', 'Stephen Hawking', 'Bantam', 1988, 3, 3, 'Sains', 'Rak D-2', 'Penjelasan tentang asal usul alam semesta, black holes, dan teori relativitas dalam bahasa yang mudah dipahami.'),
('Atomic Habits', 'BK-2024-009', 'James Clear', 'Avery', 2018, 6, 6, 'Non-Fiksi', 'Rak E-1', 'Panduan praktis untuk membangun kebiasaan baik dan menghilangkan kebiasaan buruk dengan metode yang terbukti efektif.'),
('Thinking, Fast and Slow', 'BK-2024-010', 'Daniel Kahneman', 'Farrar, Straus and Giroux', 2011, 4, 4, 'Non-Fiksi', 'Rak E-2', 'Penjelasan tentang dua sistem berpikir manusia: sistem cepat (intuitif) dan sistem lambat (logis).'),
('Machine Learning Yearning', 'BK-2024-011', 'Andrew Ng', 'deeplearning.ai', 2018, 5, 5, 'Komputer', 'Rak B-3', 'Panduan praktis untuk structuring machine learning projects dari salah satu pionir AI terkemuka.'),
('Jurnal Penelitian Informatika Vol 1', 'JRN-2024-001', 'Tim Redaksi', 'UTama Press', 2024, 10, 10, 'Jurnal', 'Rak F-1', 'Kumpulan artikel penelitian terbaru di bidang informatika dan teknologi informasi.'),
('Sejarah Indonesia Modern', 'BK-2024-012', 'Ricklefs M.C.', 'Gadjah Mada University Press', 2008, 3, 3, 'Sejarah', 'Rak A-3', 'Sejarah lengkap Indonesia dari masa kolonial hingga era reformasi.'),
('The Art of War', 'BK-2024-013', 'Sun Tzu', 'Various', -500, 4, 4, 'Non-Fiksi', 'Rak E-3', 'Teks klasik tentang strategi militer dan bisnis yang masih relevan hingga kini.'),
('1984', 'BK-2024-014', 'George Orwell', 'Secker & Warburg', 1949, 5, 5, 'Fiksi', 'Rak C-3', 'Novel distopia tentang masyarakat totalitarian di bawah pengawasan Big Brother.')
ON DUPLICATE KEY UPDATE kodeBuku=kodeBuku;

-- Verify
SELECT COUNT(*) as 'Total Books', 
       SUM(CASE WHEN category='Fiksi' THEN 1 ELSE 0 END) as 'Fiksi',
       SUM(CASE WHEN category='Non-Fiksi' THEN 1 ELSE 0 END) as 'Non-Fiksi',
       SUM(CASE WHEN category='Komputer' THEN 1 ELSE 0 END) as 'Komputer',
       SUM(CASE WHEN category='Sains' THEN 1 ELSE 0 END) as 'Sains',
       SUM(CASE WHEN category='Sejarah' THEN 1 ELSE 0 END) as 'Sejarah',
       SUM(CASE WHEN category='Jurnal' THEN 1 ELSE 0 END) as 'Jurnal'
FROM books;
