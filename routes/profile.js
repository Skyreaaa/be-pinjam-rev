// File: routes/profile.js (UPDATED - menambahkan endpoint biodata, upload, delete, me, summary)

const express = require('express');
const router = express.Router();
const checkAuth = require('../middleware/checkAuth');
const profileController = require('../controllers/profileController');
const fs = require('fs');
const path = require('path');

router.use(checkAuth); // set req.userData

const getDBPool = (req) => req.app.get('dbPool');

// GET /api/profile/me - data user saat ini
router.get('/me', async (req, res) => {
    const pool = getDBPool(req);
    const { id } = req.userData || {}; // dari token
    if (!id) return res.status(401).json({ success: false, message: 'Token tidak valid.' });
    try {
        const [rows] = await pool.query(`
            SELECT 
                u.id, u.npm, u.username, u.role, u.fakultas, u.prodi, u.angkatan, u.profile_photo_url, u.denda, u.denda_unpaid,
                                (SELECT COUNT(*) FROM loans l 
                                     WHERE l.user_id = u.id 
                                         AND l.status IN ('Disetujui','Diambil','Sedang Dipinjam','Terlambat','Siap Dikembalikan')
                                ) AS active_loans_count
            FROM users u WHERE u.id = ? LIMIT 1
        `, [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });
        return res.json({ success: true, user: rows[0] });
    } catch (e) {
        console.error('Error get /me:', e);
        return res.status(500).json({ success: false, message: 'Gagal mengambil data profil.' });
    }
});

// GET /api/profile/active-fine - menghitung denda aktif (pinjaman terlambat berjalan + denda dari pengembalian belum dibayar)
router.get('/active-fine', async (req, res) => {
    const pool = getDBPool(req);
    const { id } = req.userData || {};
    if (!id) return res.status(401).json({ success:false, message:'Token tidak valid.' });
    try {
        const [userRows] = await pool.query('SELECT denda_unpaid, denda FROM users WHERE id = ? LIMIT 1',[id]);
        if (!userRows.length) return res.status(404).json({ success:false, message:'User tidak ditemukan.' });
        const denda_unpaid = Number(userRows[0].denda_unpaid) || 0;
        const historicalTotal = Number(userRows[0].denda) || 0; // total akumulasi
        // Tambahkan status 'Siap Dikembalikan' karena masih berjalan dan bisa menumpuk denda sampai diverifikasi admin
        const [runningLoans] = await pool.query(
            `SELECT expectedReturnDate FROM loans WHERE user_id = ? AND status IN ('Sedang Dipinjam','Terlambat','Siap Dikembalikan')`,
            [id]
        );
        const now = new Date();
        const PENALTY_PER_DAY = 2000;
        let runningFine = 0;
        for (const row of runningLoans) {
            if (!row.expectedReturnDate) continue;
            const due = new Date(row.expectedReturnDate);
            if (now > due) {
                const diffMs = now - due;
                const daysLate = Math.floor(diffMs / (1000*60*60*24));
                if (daysLate > 0) runningFine += daysLate * PENALTY_PER_DAY;
            }
        }
        const activeFine = runningFine + denda_unpaid;
        return res.json({ success:true, activeFine, runningFine, unpaidReturnedFine: denda_unpaid, historicalTotal });
    } catch (e) {
        console.error('Error get /active-fine:', e);
        return res.status(500).json({ success:false, message:'Gagal menghitung denda aktif.' });
    }
});

// GET /api/profile/active-loans-count - hitung ulang jumlah pinjaman aktif real-time
router.get('/active-loans-count', async (req,res)=>{
    const pool = getDBPool(req);
    const { id } = req.userData || {};
    if (!id) return res.status(401).json({ success:false, message:'Token tidak valid.' });
    try {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS cnt FROM loans 
              WHERE user_id=? AND status IN ('Disetujui','Diambil','Sedang Dipinjam','Terlambat','Siap Dikembalikan')`,
            [id]
        );
        return res.json({ success:true, activeLoans: rows[0].cnt || 0 });
    } catch(e){
        console.error('Error get /active-loans-count:', e);
        return res.status(500).json({ success:false, message:'Gagal mengambil jumlah pinjaman aktif.' });
    }
});

// PUT /api/profile/update-biodata
router.put('/update-biodata', profileController.updateBiodata);

// POST /api/profile/upload-photo
router.post('/upload-photo', ...profileController.uploadPhoto); // uploadPhoto adalah array middleware + handler

// DELETE /api/profile/delete-photo
router.delete('/delete-photo', profileController.deletePhoto);

// GET /api/profile/summary/:userId (ringkasan)
router.get('/summary/:userId', async (req, res) => {
    const pool = getDBPool(req);
    const tokenUserId = req.userData.id;
    const userId = parseInt(req.params.userId, 10);
    if (tokenUserId !== userId) {
        return res.status(403).json({ message: 'Akses Ditolak. Anda hanya dapat melihat data Anda sendiri.' });
    }
    try {
        const [borrowed] = await pool.query(
            "SELECT COUNT(*) as count FROM loans WHERE user_id = ? AND status IN ('Sedang Dipinjam', 'Disetujui', 'Menunggu Persetujuan')",
            [userId]
        );
        const [penalty] = await pool.query(
            "SELECT SUM(fineAmount) as total FROM loans WHERE user_id = ? AND status IN ('Terlambat','Dikembalikan')",
            [userId]
        );
        const [userRows] = await pool.query('SELECT denda_unpaid FROM users WHERE id = ? LIMIT 1',[userId]);
        const denda_unpaid = userRows.length ? Number(userRows[0].denda_unpaid) : 0;
        res.json({
            booksBorrowed: borrowed[0].count || 0,
            totalPenalty: parseInt(penalty[0].total) || 0,
            unpaidPenalty: denda_unpaid
        });
    } catch (error) {
        console.error('❌ Gagal memuat ringkasan data:', error);
        res.status(500).json({ message: 'Gagal mengambil data ringkasan dari database.' });
    }
});

// INITIATE fines (bank/qris/cash). For non-cash with proof required -> awaiting_proof
router.post('/initiate-fines', async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.userData.id;
    const { loanIds, method } = req.body || {};
    if (!Array.isArray(loanIds) || !loanIds.length) return res.status(400).json({ success:false, message:'loanIds diperlukan.' });
    if (!['bank','qris','cash'].includes(method)) return res.status(400).json({ success:false, message:'Metode tidak valid.' });
    try {
        const placeholders = loanIds.map(()=>'?').join(',');
        const [rows] = await pool.query(`SELECT id,fineAmount,finePaymentStatus,finePaid FROM loans WHERE user_id=? AND id IN (${placeholders}) AND status='Dikembalikan' AND fineAmount>0`, [userId, ...loanIds]);
        if (!rows.length) return res.status(404).json({ success:false, message:'Denda tidak ditemukan / status belum Dikembalikan.' });
        const blocking = rows.filter(r=> r.finePaymentStatus==='paid' || r.finePaid===1);
        if (blocking.length) return res.status(400).json({ success:false, message:'Ada denda yang sudah lunas.' });
        // Determine next status
        const nextStatus = method === 'cash' ? 'pending_verification' : 'awaiting_proof';
        await pool.query(`UPDATE loans SET finePaymentStatus=?, finePaymentMethod=? WHERE user_id=? AND id IN (${placeholders})`, [nextStatus, method, userId, ...loanIds]);
        return res.json({ success:true, updatedIds: loanIds, status: nextStatus, method });
    } catch (e){
        console.error('Error initiate-fines:', e);
        return res.status(500).json({ success:false, message:'Gagal inisiasi pembayaran.' });
    }
});

// Upload bukti pembayaran -> set pending_verification
const multer = require('multer');
const fineProofStorage = multer.diskStorage({
    destination: (req,file,cb)=>{
        const dir = path.join(__dirname, '..', 'uploads', 'fine-proofs');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
        cb(null, dir);
    },
    filename: (req,file,cb)=>{
        const unique = Date.now() + '-' + Math.round(Math.random()*1e9);
        const ext = path.extname(file.originalname || '').toLowerCase();
        cb(null, 'fine-'+unique+ext);
    }
});
const uploadFineProof = multer({ storage: fineProofStorage, limits:{ fileSize: 5*1024*1024 }});

router.post('/upload-fine-proof', uploadFineProof.single('proof'), async (req,res)=>{
    if(!req.file){
        console.warn('[UPLOAD FINE PROOF] No file received');
    }
    const pool = getDBPool(req);
    const userId = req.userData.id;
    const { loanIds } = req.body || {};
    if (!req.file) return res.status(400).json({ success:false, message:'File bukti diperlukan.' });
    let ids = [];
    try { ids = JSON.parse(loanIds); } catch { ids = Array.isArray(loanIds)? loanIds: []; }
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ success:false, message:'loanIds tidak valid.' });
    try {
        const placeholders = ids.map(()=>'?').join(',');
        const [rows] = await pool.query(`SELECT id,finePaymentStatus,fineAmount,finePaymentMethod FROM loans WHERE user_id=? AND id IN (${placeholders})`, [userId, ...ids]);
        if (!rows.length) return res.status(404).json({ success:false, message:'Data denda tidak ditemukan.' });
        const invalid = rows.filter(r=> r.finePaymentStatus !== 'awaiting_proof');
        if (invalid.length) return res.status(400).json({ success:false, message:'Ada denda bukan status awaiting_proof.' });
        const relPath = '/uploads/fine-proofs/' + path.basename(req.file.path);
        await pool.query(`UPDATE loans SET finePaymentStatus='pending_verification', finePaymentProof=? WHERE user_id=? AND id IN (${placeholders})`, [relPath, userId, ...ids]);

        // --- NOTIFICATION INSERT (ADMIN AWARE) ---
        try {
            // Pastikan tabel notifikasi ada
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

            const totalAmount = rows.reduce((sum,r)=> sum + (Number(r.fineAmount)||0), 0);
            const method = rows[0]?.finePaymentMethod || null;
            const loanIdsJson = JSON.stringify(ids);
            await pool.query(`INSERT INTO fine_payment_notifications (user_id, loan_ids, amount_total, method, proof_url, status) VALUES (?,?,?,?,?,'pending_verification')`, [userId, loanIdsJson, totalAmount, method, relPath]);
        } catch (notifyErr) {
            console.warn('[FINE][NOTIFY] gagal membuat notifikasi pembayaran denda:', notifyErr.message);
        }

        return res.json({ success:true, proofUrl: relPath, updatedIds: ids, status:'pending_verification' });
    } catch (e){
        console.error('Error upload-fine-proof:', e);
        return res.status(500).json({ success:false, message:'Gagal upload bukti.' });
    }
});

// Sementara: pay-fines lama -> hanya untuk direct finalize (dipakai mungkin untuk cash di loket + admin sudah lihat bukti fisik)
router.post('/pay-fines', async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.userData.id;
    const { loanIds } = req.body || {};
    try {
        let targetLoansQuery = `SELECT id, fineAmount, finePaymentStatus FROM loans WHERE user_id = ? AND status = 'Dikembalikan' AND fineAmount > 0 AND finePaymentStatus IN ('pending_verification')`;
        const params = [userId];
        if (Array.isArray(loanIds) && loanIds.length) {
            const placeholders = loanIds.map(()=>'?').join(',');
            targetLoansQuery += ` AND id IN (${placeholders})`;
            params.push(...loanIds);
        }
        const [loanRows] = await pool.query(targetLoansQuery, params);
        if (!loanRows.length) {
            return res.json({ success:true, paidCount:0, paidTotal:0, remainingUnpaid:null, message:'Tidak ada denda yang siap diverifikasi/lunas.' });
        }
        const totalPay = loanRows.reduce((sum,r)=> sum + (Number(r.fineAmount)||0), 0);
        const loanIdsToUpdate = loanRows.map(r=>r.id);
        const idPlaceholders = loanIdsToUpdate.map(()=>'?').join(',');
        await pool.query(`UPDATE loans SET finePaid = 1, finePaymentStatus='paid', finePaymentAt=NOW() WHERE user_id = ? AND id IN (${idPlaceholders})`, [userId, ...loanIdsToUpdate]);
        await pool.query(`UPDATE users SET denda_unpaid = GREATEST(denda_unpaid - ?, 0) WHERE id = ?`, [totalPay, userId]);
        const [afterUser] = await pool.query('SELECT denda_unpaid FROM users WHERE id = ? LIMIT 1',[userId]);
        const remainingUnpaid = afterUser.length ? Number(afterUser[0].denda_unpaid) : 0;
        return res.json({ success:true, paidCount:loanRows.length, paidTotal:totalPay, remainingUnpaid });
    } catch (e){
        console.error('Error pay-fines:', e);
        return res.status(500).json({ success:false, message:'Gagal memverifikasi / melunasi denda.' });
    }
});

// DEBUG ONLY: Tambah denda dummy cepat untuk pengujian UI (JANGAN aktifkan di produksi)

module.exports = router;