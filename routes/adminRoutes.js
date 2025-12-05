// File: routes/adminRoutes.js (FULL CODE FIXED)

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController'); 
const loanController = require('../controllers/loanController'); 
const jwt = require('jsonwebtoken'); 

// --- Middleware Otentikasi Admin ---
const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: 'Akses Ditolak. Token tidak disediakan.' });
    }

    const token = authHeader.split(' ')[1];
    const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_default'; 

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ message: 'Token tidak valid atau kadaluarsa.' });
        }
        
        if (decoded.role !== 'admin') {
            return res.status(403).json({ message: 'Akses Ditolak. Anda bukan Admin.' });
        }
        
        req.user = decoded; 
        next();
    });
};

router.use(authenticateAdmin);

// =========================================================
//                       KELOLA PENGGUNA (Menggunakan adminController)
// =========================================================
router.get('/users', adminController.getAllUsers);
router.post('/users', adminController.createUser);
router.put('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);


// =========================================================
//                       KELOLA DENDA (Menggunakan adminController)
// =========================================================
// Menambah Denda Manual
router.post('/penalty/apply', adminController.applyPenalty);
// Mereset Denda (Lunas)
router.post('/penalty/reset/:id', adminController.resetPenalty); 

// =========================================================
//              VERIFIKASI PEMBAYARAN DENDA (Baru)
// =========================================================
// List pembayaran denda yang menunggu verifikasi
router.get('/fines/pending', async (req,res)=>{
    const pool = req.app.get('dbPool');
    try {
        // Pastikan tabel ada (jika belum dibuat oleh upload proof pertama)
        await pool.query(`CREATE TABLE IF NOT EXISTS fine_payment_notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            loan_ids TEXT NOT NULL,
            amount_total INT NOT NULL DEFAULT 0,
            method VARCHAR(30) NULL,
            proof_url VARCHAR(255) NULL,
            status ENUM('pending_verification','paid','rejected') NOT NULL DEFAULT 'pending_verification',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
        const [rows] = await pool.query(`SELECT n.*, u.username, u.npm FROM fine_payment_notifications n JOIN users u ON n.user_id=u.id WHERE n.status='pending_verification' ORDER BY n.created_at DESC`);
        res.json({ success:true, items: rows });
    } catch (e){
        console.error('[ADMIN][FINES][PENDING] Error:', e); res.status(500).json({ success:false, message:'Gagal mengambil daftar pembayaran denda menunggu verifikasi.' });
    }
});

// Verifikasi / Tolak pembayaran denda
router.post('/fines/verify', async (req,res)=>{
    const pool = req.app.get('dbPool');
    const { notificationId, action } = req.body || {};
    if(!notificationId || !['approve','reject'].includes(action)) return res.status(400).json({ success:false, message:'notificationId & action (approve|reject) diperlukan.' });
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        const [notiRows] = await conn.query('SELECT * FROM fine_payment_notifications WHERE id=? FOR UPDATE',[notificationId]);
        if(!notiRows.length) { await conn.rollback(); return res.status(404).json({ success:false, message:'Notifikasi tidak ditemukan.' }); }
        const noti = notiRows[0];
        if(noti.status !== 'pending_verification'){ await conn.rollback(); return res.status(400).json({ success:false, message:'Status sudah diverifikasi.' }); }
        const loanIds = JSON.parse(noti.loan_ids || '[]');
        if(action==='approve'){
            if(loanIds.length){
                const placeholders = loanIds.map(()=>'?').join(',');
                await conn.query(`UPDATE loans SET finePaid=1, finePaymentStatus='paid', finePaymentAt=NOW() WHERE id IN (${placeholders}) AND user_id=?`, [...loanIds, noti.user_id]);
                // Kurangi denda_unpaid user
                await conn.query(`UPDATE users SET denda_unpaid = GREATEST(denda_unpaid - ?,0) WHERE id=?`, [noti.amount_total, noti.user_id]);
            }
            await conn.query('UPDATE fine_payment_notifications SET status="paid" WHERE id=?',[notificationId]);
        } else if(action==='reject') {
            // Kembalikan status loans ke awaiting_proof agar user bisa upload ulang
            if(loanIds.length){
                const placeholders = loanIds.map(()=>'?').join(',');
                await conn.query(`UPDATE loans SET finePaymentStatus='awaiting_proof', finePaymentProof=NULL WHERE id IN (${placeholders}) AND user_id=?`, [...loanIds, noti.user_id]);
            }
            await conn.query('UPDATE fine_payment_notifications SET status="rejected" WHERE id=?',[notificationId]);
        }
        await conn.commit();
        res.json({ success:true, updated: notificationId, action });
    } catch (e){
        if(conn) await conn.rollback();
        console.error('[ADMIN][FINES][VERIFY] Error:', e); res.status(500).json({ success:false, message:'Gagal memverifikasi pembayaran denda.' });
    } finally { if(conn) conn.release(); }
});


// =========================================================
//                   KELOLA PINJAMAN & PENGEMBALIAN (Menggunakan loanController)
// =========================================================

// Daftar Pinjaman Tertunda
router.get('/loans/pending', loanController.getPendingLoans); 
// Daftar Pengembalian yang Sedang Dipinjam/Terlambat/Siap Dikembalikan
router.get('/returns/review', loanController.getReturnsForReview);
// Riwayat Pengembalian & Persetujuan (Dikembalikan, Ditolak)
router.get('/history', loanController.getHistory);

// Aksi Pinjaman: POST /api/admin/loans/approve (body: {loanId, expectedReturnDate})
router.post('/loans/approve', loanController.approveLoan);
router.post('/loans/scan', loanController.scanLoan); // body: { kodePinjam }
router.post('/loans/start', loanController.startLoan); // body: { loanId }
// Aksi Pinjaman: POST /api/admin/loans/reject (body: {loanId})
router.post('/loans/reject', loanController.rejectLoan);

// Aksi Pengembalian: POST /api/admin/returns/process (body: {loanId, fineAmount})
router.post('/returns/process', loanController.processReturn);
// Aksi Pengembalian: POST /api/admin/returns/reject (body: {loanId})
router.post('/returns/reject', loanController.rejectReturnProof);

module.exports = router;