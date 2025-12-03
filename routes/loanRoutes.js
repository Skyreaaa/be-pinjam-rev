// File: routes/loanRoutes.js (FULL CODE FIXED)

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); 
const loanController = require('../controllers/loanController'); 

// --- Middleware Otentikasi Pengguna & Admin ---
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_default'; 

const authenticateUser = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) { return res.status(401).json({ message: 'Akses Ditolak. Token tidak disediakan.' }); }

    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) { return res.status(401).json({ message: 'Token tidak valid.' }); }
        
        req.user = decoded; 
        req.user.id = decoded.id; // Pastikan ID ada di req.user
        next();
    });
};

router.use(authenticateUser);

// =========================================================
//                       RUTE USER (Menggunakan loanController.js)
// =========================================================

// Rute: POST /api/loans/request - Meminta Pinjaman
router.post('/request', loanController.requestLoan);

// Rute: GET /api/loans/user-history - Riwayat Pinjaman User (lengkap)
router.get('/user-history', loanController.getUserLoanHistory); 

// Rute: GET /api/loans/user - Semua pinjaman user (untuk tab UI)
router.get('/user', loanController.getUserLoans);

// Rute: POST /api/loans/ready-to-return/:id - Menandai buku siap dikembalikan
const upload = require('../middleware/upload');
router.post('/ready-to-return/:id', upload.single('proofPhoto'), loanController.markAsReadyToReturn); 

// Notifikasi approval (user login kapan saja tetap dapat)
router.get('/notifications', loanController.getApprovalNotifications);
router.post('/notifications/ack', loanController.ackApprovalNotifications);
// Notifikasi pengembalian (approved / rejected)
router.get('/return-notifications', loanController.getReturnNotifications);
router.post('/return-notifications/ack', loanController.ackReturnNotifications);
// Notifikasi penolakan pinjaman
router.get('/rejection-notifications', loanController.getRejectionNotifications);
router.post('/rejection-notifications/ack', loanController.ackRejectionNotifications);
// Riwayat notifikasi (pinjaman & pengembalian)
router.get('/notifications/history', loanController.getNotificationHistory);


module.exports = router;