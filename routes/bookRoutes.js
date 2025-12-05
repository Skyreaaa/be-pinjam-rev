// File: routes/bookRoutes.js (FULL CODE FIXED & LENGKAP)

const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer'); 
const fs = require('fs/promises'); 
const bookController = require('../controllers/bookController'); 
const checkAuth = require('../middleware/checkAuth');

const getDBPool = (req) => req.app.get('dbPool');

// --- Middleware Otentikasi Pengguna & Admin (gunakan checkAuth terpusat) ---
const requireAdmin = (req, res, next) => {
    if (req.userData && req.userData.role === 'admin') return next();
    return res.status(403).json({ message: 'Akses Ditolak. Anda bukan Admin.' });
};

// --- Setup Multer (gunakan memory storage agar kompatibel dengan Cloudinary) ---
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // Batas 5MB
});

// Terima berbagai nama field untuk cover: coverImage | image | cover
const uploadCover = [
    upload.any(),
    (req, res, next) => {
        if (!req.file && Array.isArray(req.files)) {
            const candidates = ['coverImage','image','cover'];
            const f = req.files.find(x => candidates.includes(x.fieldname));
            if (f) req.file = f;
        }
        next();
    }
];

// =========================================================
//                  RUTE ADMINISTRATOR (CRUD BUKU)
// =========================================================

// POST /api/books - Tambah Buku Baru
router.post('/', checkAuth, requireAdmin, ...uploadCover, bookController.createBook);

// PUT /api/books/:id - Edit Data Buku
router.put('/:id', checkAuth, requireAdmin, ...uploadCover, bookController.updateBook);

// DELETE /api/books/:id - Hapus Buku (dengan cek pinjaman aktif)
router.delete('/:id', checkAuth, requireAdmin, bookController.deleteBook);


// =========================================================
//                       RUTE UMUM/PENGGUNA
// =========================================================

// GET /api/books - Mendapatkan Daftar Semua Buku (dengan filter search/kategori)
router.get('/', checkAuth, bookController.getAllBooks); 

// GET /api/books/:id - Mendapatkan Detail Buku
router.get('/:id', checkAuth, bookController.getBookById);

module.exports = router;