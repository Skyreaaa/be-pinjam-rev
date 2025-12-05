// File: controllers/bookController.js (BARU - FULL CODE CRUD BUKU + LOKASI)

const getDBPool = (req) => req.app.get('dbPool');
const fs = require('fs/promises');
const path = require('path');
const { isConfigured: isCloudinaryConfigured, uploadBufferToCloudinary } = require('../utils/cloudinary');
const BASE_UPLOAD_PATH = path.join(__dirname, '..', 'uploads', 'book-covers');
// BASE_URL dihapus: gunakan host dinamis dari request agar bisa diakses dari perangkat lain di jaringan LAN.
// Helper untuk membentuk origin dinamis.
const getOrigin = (req) => {
    const proto = req.protocol;
    const host = req.get('host');
    return `${proto}://${host}`;
};

// Helper: Hapus Gambar Lama
const deleteOldImage = async (imageFileName) => {
    if (!imageFileName) return;
    // Asumsi imageFileName adalah 'book-cover-12345.jpg'
    const imagePath = path.join(BASE_UPLOAD_PATH, imageFileName);
    try {
        await fs.unlink(imagePath);
        console.log(`✅ Gambar lama berhasil dihapus: ${imagePath}`);
    } catch (err) {
        if (err.code !== 'ENOENT') { // Abaikan error jika file tidak ditemukan
            console.error(`❌ Gagal menghapus gambar lama ${imagePath}:`, err);
        }
    }
};

// =========================================================
//                       CRUD BUKU
// =========================================================

// 1. Mendapatkan Semua Buku (GET /api/books)
exports.getAllBooks = async (req, res) => {
    const pool = getDBPool(req);
    const { search, category, sort } = req.query; 

    // popular: based on total loans count (descending)
    // newest: based on publicationYear (desc) then id desc
    let baseSelect = `SELECT b.id, b.title, b.kodeBuku, b.author, b.publisher, b.publicationYear, b.totalStock, b.availableStock, b.category, b.image_url, b.location, b.description,
        (SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id) AS borrowCount
        FROM books b WHERE 1=1`;
    let params = [];

    if (search) {
        baseSelect += ' AND (b.title LIKE ? OR b.author LIKE ? OR b.kodeBuku LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
    }
    
    if (category) {
        baseSelect += ' AND b.category = ?';
        params.push(category);
    }

    // Sorting
    if (sort === 'popular') {
        baseSelect += ' ORDER BY borrowCount DESC, b.id DESC';
    } else if (sort === 'newest') {
        baseSelect += ' ORDER BY IFNULL(b.publicationYear,0) DESC, b.id DESC';
    } else {
        baseSelect += ' ORDER BY b.id DESC';
    }

    try {
        const [rows] = await pool.query(baseSelect, params);
        // Normalisasi URL gambar: jika sudah absolut (http/https), biarkan; jika relatif (filename), prefix origin
        const origin = getOrigin(req);
        const booksWithFullPath = rows.map(book => {
            const img = book.image_url;
            if (!img) return { ...book, image_url: null };
            if (/^https?:\/\//i.test(img)) return { ...book, image_url: img };
            return { ...book, image_url: `${origin}/uploads/book-covers/${img}` };
        });
        // Cache ringan untuk daftar buku (1 menit)
        res.set('Cache-Control', 'public, max-age=60');
        res.json(booksWithFullPath);
    } catch (error) {
        console.error('❌ Error fetching books:', error);
        res.status(500).json({ message: 'Gagal mengambil data buku.' });
    }
};

// 2. Mendapatkan Detail Buku (GET /api/books/:id)
exports.getBookById = async (req, res) => {
    const pool = getDBPool(req);
    const bookId = req.params.id;
    try {
    const [rows] = await pool.query('SELECT id, title, kodeBuku, author, publisher, publicationYear, totalStock, availableStock, category, image_url, location, description FROM books WHERE id = ?', [bookId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Buku tidak ditemukan.' });
        }
        const book = rows[0];
    // Normalisasi: jika already absolute, biarkan
    const origin = getOrigin(req);
    if (book.image_url) {
        if (!/^https?:\/\//i.test(book.image_url)) {
            book.image_url = `${origin}/uploads/book-covers/${book.image_url}`;
        }
    } else {
        book.image_url = null;
    }
        // Cache ringan untuk detail buku (2 menit)
        res.set('Cache-Control', 'public, max-age=120');
        res.json(book);
    } catch (error) {
        console.error('❌ Error fetching book by ID:', error);
        res.status(500).json({ message: 'Gagal mengambil detail buku.' });
    }
};

// 3. Menambah Buku Baru (POST /api/books)
exports.createBook = async (req, res) => {
    const pool = getDBPool(req);
    const { title, kodeBuku, author, publisher, publicationYear, totalStock, category, location, description } = req.body;
    // Kompatibilitas: jika upload.any() dipakai, ambil file dari req.files juga
    if (!req.file && Array.isArray(req.files)) {
        const candidates = ['coverImage','image','cover','file','cover_buku'];
        const f = req.files.find(x => candidates.includes(x.fieldname));
        if (f) req.file = f;
    }
    
    let storedImageRef = null; // bisa secure_url (Cloudinary) atau filename (local)

    if (req.file) {
        if (isCloudinaryConfigured()) {
            try {
                const result = await uploadBufferToCloudinary(req.file.buffer, { folder: 'book-covers', mimetype: req.file.mimetype });
                storedImageRef = result.secure_url;
            } catch (e) {
                return res.status(500).json({ message: 'Gagal upload cover ke Cloudinary: ' + e.message });
            }
        } else {
            // Fallback: simpan ke disk jika Cloudinary tidak dikonfigurasi
            const ext = path.extname(req.file.originalname || '') || '.jpg';
            const fname = `book-cover-${Date.now()}${ext}`;
            const dst = path.join(BASE_UPLOAD_PATH, fname);
            try {
                await fs.mkdir(BASE_UPLOAD_PATH, { recursive: true });
                await fs.writeFile(dst, req.file.buffer);
                storedImageRef = fname;
            } catch (e) {
                return res.status(500).json({ message: 'Gagal menyimpan cover ke disk: ' + e.message });
            }
        }
    }

    if (!title || !kodeBuku || !author || !totalStock || !category || !location) {
        // Jika validasi gagal, hapus file lokal jika ada
        if (storedImageRef && !/^https?:\/\//i.test(storedImageRef)) await deleteOldImage(storedImageRef); 
        return res.status(400).json({ message: 'Semua field wajib diisi, termasuk Kode Buku dan Lokasi.' });
    }

    try {
        // Cek duplikasi Kode Buku
        const [duplicate] = await pool.query('SELECT id FROM books WHERE kodeBuku = ?', [kodeBuku]);
        if (duplicate.length > 0) {
            if (storedImageRef && !/^https?:\/\//i.test(storedImageRef)) await deleteOldImage(storedImageRef);
            return res.status(400).json({ message: 'Kode Buku sudah digunakan.' });
        }
        
        const [result] = await pool.query(
            'INSERT INTO books (title, kodeBuku, author, publisher, publicationYear, totalStock, availableStock, category, image_url, description, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [title, kodeBuku, author, publisher || null, publicationYear || null, totalStock, totalStock, category, storedImageRef, description || null, location]
        );

        res.status(201).json({ 
            success: true, 
            message: 'Buku berhasil ditambahkan.', 
            bookId: result.insertId 
        });
    } catch (error) {
        // Jika ada error database, hapus file yang sudah terupload
        if (storedImageRef && !/^https?:\/\//i.test(storedImageRef)) await deleteOldImage(storedImageRef);
        console.error('❌ Error creating book:', error);
        res.status(500).json({ message: 'Gagal menambahkan buku.' });
    }
};

// 4. Memperbarui Buku (PUT /api/books/:id)
exports.updateBook = async (req, res) => {
    const pool = getDBPool(req);
    const bookId = req.params.id;
    const { title, kodeBuku, author, publisher, publicationYear, totalStock, category, location, description, currentImageFileName } = req.body;
    // Kompatibilitas: jika upload.any() dipakai, ambil file dari req.files juga
    if (!req.file && Array.isArray(req.files)) {
        const candidates = ['coverImage','image','cover','file','cover_buku'];
        const f = req.files.find(x => candidates.includes(x.fieldname));
        if (f) req.file = f;
    }

    // Upload cover baru jika ada
    let newImageRef = null;
    if (req.file) {
        if (isCloudinaryConfigured()) {
            try {
                const result = await uploadBufferToCloudinary(req.file.buffer, { folder: 'book-covers', mimetype: req.file.mimetype });
                newImageRef = result.secure_url;
            } catch (e) {
                return res.status(500).json({ message: 'Gagal upload cover ke Cloudinary: ' + e.message });
            }
        } else {
            const ext = path.extname(req.file.originalname || '') || '.jpg';
            const fname = `book-cover-${Date.now()}${ext}`;
            const dst = path.join(BASE_UPLOAD_PATH, fname);
            try { await fs.mkdir(BASE_UPLOAD_PATH, { recursive:true }); await fs.writeFile(dst, req.file.buffer); newImageRef = fname; } catch (e){ return res.status(500).json({ message:'Gagal menyimpan cover ke disk: ' + e.message }); }
        }
    }

    if (!title || !kodeBuku || !author || !totalStock || !category || !location) {
         // Jika validasi gagal, hapus file yang sudah terupload
        if (newImageRef && !/^https?:\/\//i.test(newImageRef)) await deleteOldImage(newImageRef); 
        return res.status(400).json({ message: 'Semua field wajib diisi, termasuk Kode Buku dan Lokasi.' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Cek duplikasi Kode Buku (kecuali untuk buku ini sendiri)
        const [duplicate] = await connection.query('SELECT id FROM books WHERE kodeBuku = ? AND id != ?', [kodeBuku, bookId]);
        if (duplicate.length > 0) {
            if (newImageFileName) await deleteOldImage(newImageFileName);
            await connection.rollback();
            return res.status(400).json({ message: 'Kode Buku sudah digunakan oleh buku lain.' });
        }
        
        // 2. Ambil Stok Lama & Available Stock Lama
        const [oldBook] = await connection.query('SELECT totalStock, availableStock, image_url FROM books WHERE id = ?', [bookId]);
        if (oldBook.length === 0) {
            if (newImageFileName) await deleteOldImage(newImageFileName);
            await connection.rollback();
            return res.status(404).json({ message: 'Buku tidak ditemukan.' });
        }
        const { totalStock: oldTotalStock, availableStock: oldAvailableStock, image_url: oldImageFileName } = oldBook[0];
        
        const newTotalStock = parseInt(totalStock);
        const stockDifference = newTotalStock - oldTotalStock;
        const newAvailableStock = oldAvailableStock + stockDifference;

        if (newAvailableStock < 0) {
             if (newImageFileName) await deleteOldImage(newImageFileName);
            await connection.rollback();
            return res.status(400).json({ message: 'Stok tersedia tidak boleh negatif. Pastikan total stok baru minimal sama dengan jumlah buku yang sedang dipinjam.' });
        }
        
        // Tentukan nama file yang akan disimpan
        let finalImageFileName = oldImageFileName;
        if (newImageRef) {
            // Ada upload baru, hapus gambar lama jika file lokal (abaikan jika URL Cloudinary)
            if (oldImageFileName && !/^https?:\/\//i.test(oldImageFileName)) await deleteOldImage(oldImageFileName);
            finalImageFileName = newImageRef;
        } 
        
        // 3. Update data buku
        const [result] = await connection.query(
            'UPDATE books SET title = ?, kodeBuku = ?, author = ?, publisher = ?, publicationYear = ?, totalStock = ?, availableStock = ?, category = ?, image_url = ?, description = ?, location = ? WHERE id = ?',
            [title, kodeBuku, author, publisher || null, publicationYear || null, newTotalStock, newAvailableStock, category, finalImageFileName, description || null, location, bookId]
        );

        await connection.commit();
        res.json({ success: true, message: 'Buku berhasil diperbarui.' });

    } catch (error) {
        if (connection) await connection.rollback();
        // Jika ada error, hapus file baru jika ada
        if (newImageRef && !/^https?:\/\//i.test(newImageRef)) await deleteOldImage(newImageRef);
        console.error('❌ Error updating book:', error);
        res.status(500).json({ message: 'Gagal memperbarui buku.' });
    } finally {
        if (connection) connection.release();
    }
};

// 5. Menghapus Buku (DELETE /api/books/:id)
exports.deleteBook = async (req, res) => {
    const pool = getDBPool(req);
    const bookId = req.params.id;

    try {
        // 1. Cek apakah ada pinjaman aktif (Penting: Logika yang diminta dipertahankan)
        const [activeLoans] = await pool.query('SELECT COUNT(*) as count FROM loans WHERE book_id = ? AND status IN (?, ?, ?)', 
            [bookId, 'Sedang Dipinjam', 'Menunggu Persetujuan', 'Siap Dikembalikan']
        );
        if (activeLoans[0].count > 0) {
            return res.status(400).json({ message: `Tidak dapat menghapus buku. Terdapat ${activeLoans[0].count} pinjaman yang masih aktif (Dipinjam/Tertunda/Siap Dikembalikan).` });
        }

        // 2. Ambil image_url sebelum menghapus data
        const [book] = await pool.query('SELECT image_url FROM books WHERE id = ?', [bookId]);
        
        // 3. Hapus data buku
        const [result] = await pool.query('DELETE FROM books WHERE id = ?', [bookId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Buku tidak ditemukan.' });
        }
        
        // 4. Hapus file cover lokal jika ada (Cloudinary dibiarkan)
        if (book.length > 0 && book[0].image_url && !/^https?:\/\//i.test(book[0].image_url)) {
            await deleteOldImage(book[0].image_url);
        }

        res.json({ success: true, message: 'Buku berhasil dihapus.' });
    } catch (error) {
        console.error('❌ Error deleting book:', error);
        res.status(500).json({ message: 'Gagal menghapus buku.' });
    }
};