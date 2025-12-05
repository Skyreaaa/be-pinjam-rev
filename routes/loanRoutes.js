// File: routes/loanRoutes.js (FULL CODE FIXED)

const express = require('express');
const router = express.Router();
const loanController = require('../controllers/loanController'); 
const checkAuth = require('../middleware/checkAuth');

// Gunakan middleware checkAuth terpusat agar konsisten dengan JWT_SECRET
router.use(checkAuth);

// Kompatibilitas: beberapa controller mengakses req.user.id
router.use((req, res, next) => {
	if (req.userData) {
		req.user = Object.assign({}, req.userData);
		req.user.id = req.userData.id;
	}
	next();
});

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
const multer = require('multer');
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const uploadReturnProof = [
	uploadMem.any(),
	(req, res, next) => {
		if (!req.file && Array.isArray(req.files)) {
			const candidates = ['proofPhoto','proof','photo','image'];
			const f = req.files.find(x => candidates.includes(x.fieldname));
			if (f) req.file = f;
		}
		next();
	}
];
router.post('/ready-to-return/:id', ...uploadReturnProof, loanController.markAsReadyToReturn); 

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