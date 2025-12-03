// File: routes/bookRoutes.js (FULL CODE FIXED & LENGKAP)

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); 
const path = require('path');
const multer = require('multer'); 
const fs = require('fs/promises'); 
const bookController = require('../controllers/bookController'); 

const getDBPool = (req) => req.app.get('dbPool');

// --- Middleware Otentikasi Pengguna & Admin ---
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_default'; 

const authenticateUser = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) { return res.status(401).json({ message: 'Akses Ditolak. Token tidak disediakan.' }); }
    
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) { return res.status(401).json({ message: 'Token tidak valid.' }); }
        req.user = decoded; 
        next();
    });
};

const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) { return res.status(401).json({ message: 'Akses Ditolak. Token tidak disediakan.' }); }
    
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) { return res.status(401).json({ message: 'Token tidak valid.' }); }
        if (decoded.role !== 'admin') { return res.status(403).json({ message: 'Akses Ditolak. Anda bukan Admin.' }); }
        req.user = decoded; 
        next();
    });
};

// --- Setup Multer untuk Upload Gambar Cover Buku ---
const BASE_UPLOAD_PATH = path.join(__dirname, '..', 'uploads', 'book-covers');
// Pastikan folder ada
(async () => {
    try {
        await fs.mkdir(BASE_UPLOAD_PATH, { recursive: true });
    } catch (error) {
        console.error("Gagal membuat direktori cover buku:", error);
    }
})();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, BASE_UPLOAD_PATH);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `book-cover-${Date.now()}${ext}`);
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // Batas 5MB
});

// =========================================================
//                  RUTE ADMINISTRATOR (CRUD BUKU)
// =========================================================

// POST /api/books - Tambah Buku Baru
router.post('/', authenticateAdmin, upload.single('coverImage'), bookController.createBook);

// PUT /api/books/:id - Edit Data Buku
router.put('/:id', authenticateAdmin, upload.single('coverImage'), bookController.updateBook);

// DELETE /api/books/:id - Hapus Buku (dengan cek pinjaman aktif)
router.delete('/:id', authenticateAdmin, bookController.deleteBook);


// =========================================================
//                       RUTE UMUM/PENGGUNA
// =========================================================

// GET /api/books - Mendapatkan Daftar Semua Buku (dengan filter search/kategori)
router.get('/', authenticateUser, bookController.getAllBooks); 

// GET /api/books/:id - Mendapatkan Detail Buku
router.get('/:id', authenticateUser, bookController.getBookById);

module.exports = router;