// File: controllers/loanController.js (FULL KODE - FIXED SQL & LOGIKA LENGKAP)

const getDBPool = (req) => req.app.get('dbPool');
const { format, addDays, isBefore, differenceInCalendarDays, startOfDay } = require('date-fns');
// Batas maksimum hari peminjaman dihapus agar sepenuhnya mengikuti input user
// (tetap bisa dipakai di tempat lain jika ingin logika tambahan)
const MAX_LOAN_DAYS = Infinity;
const PENALTY_PER_DAY = 2000; 

// Helper untuk format Rupiah
const formatRupiah = (amount) => {
    const num = Number(amount);
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(num);
};

// Helper untuk menghitung Denda
const calculatePenalty = (expectedReturnDate, actualReturnDate) => {
    // Hitung denda berbasis selisih hari kalender, bukan jam
    const expected = startOfDay(new Date(expectedReturnDate));
    const actual = startOfDay(new Date(actualReturnDate));
    const daysLate = Math.max(0, differenceInCalendarDays(actual, expected));
    return daysLate * PENALTY_PER_DAY;
};

// =========================================================
//                   RUTE USER (Peminjaman)
// =========================================================

// Helper: Backfill kodePinjam jika masih NULL / kosong pada baris lama
async function backfillMissingKodePinjam(connection) {
    // Pastikan kolom ada
    const [cols] = await connection.query('SHOW COLUMNS FROM loans');
    const names = cols.map(c => c.Field);
    if (!names.includes('kodePinjam')) return; // tidak ada kolom, abaikan

    // Cari baris yang belum punya kodePinjam, tapi hanya untuk status yang sudah disetujui/aktif (bukan pending)
    const [missing] = await connection.query("SELECT id, loanDate FROM loans WHERE (kodePinjam IS NULL OR kodePinjam = '') AND status <> 'Menunggu Persetujuan' LIMIT 250");
    if (missing.length === 0) return; // nothing to do

    for (const row of missing) {
        const baseDate = row.loanDate ? new Date(row.loanDate) : new Date();
        const datePart = format(baseDate, 'yyyyMMdd');
        const rnd = Math.random().toString(36).substring(2,6).toUpperCase();
        const code = `KP-${datePart}-${rnd}`;
        try {
            await connection.query('UPDATE loans SET kodePinjam = ? WHERE id = ? AND (kodePinjam IS NULL OR kodePinjam = ?) LIMIT 1', [code, row.id, '']);
        } catch (e) {
            // Kemungkinan duplikat, coba format alternatif deterministik
            const fallback = `KP-${String(row.id).padStart(6,'0')}`;
            try { await connection.query('UPDATE loans SET kodePinjam = ? WHERE id = ? AND (kodePinjam IS NULL OR kodePinjam = ?) LIMIT 1', [fallback, row.id, '']); } catch {}
        }
    }
}

// 1. Meminta Pinjaman (POST /api/loans/request)
exports.requestLoan = async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.user.id; 
    const { bookId, purpose, returnDate } = req.body; // returnDate opsional dari frontend

    if (!bookId) {
        return res.status(400).json({ message: 'ID Buku diperlukan.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Cek 1: Batas Maksimal Pinjaman (misal 3 buku) -- perluas status aktif
        const [activeLoans] = await connection.query('SELECT COUNT(*) as count FROM loans WHERE user_id = ? AND status IN (?, ?, ?, ?)', [userId, 'Menunggu Persetujuan', 'Disetujui', 'Diambil', 'Sedang Dipinjam']);
        if (activeLoans[0].count >= 3) {
            await connection.rollback();
            return res.status(400).json({ message: 'Anda telah mencapai batas maksimal 3 pinjaman aktif/tertunda.' });
        }
        
        // Cek 2: Ketersediaan Stok
        const [book] = await connection.query('SELECT title, availableStock FROM books WHERE id = ?', [bookId]);
        if (book.length === 0 || book[0].availableStock <= 0) {
            await connection.rollback();
            return res.status(400).json({ message: 'Stok buku tidak tersedia.' });
        }
        // Cek 3: Duplikasi Permintaan (dibolehkan jika stok masih > 1 dan user belum meminjam lebih dari 1 eksemplar)
        const [duplicate] = await connection.query('SELECT id FROM loans WHERE user_id = ? AND book_id = ? AND status IN (?, ?, ?, ?)', [userId, bookId, 'Menunggu Persetujuan','Disetujui','Diambil','Sedang Dipinjam']);
        if (duplicate.length > 0) {
            // Jika hanya tersisa 1 (availableStock == 1) larang; kalau lebih dari 1, tolak peminjaman ganda untuk eksemplar kedua sekaligus? Simpel: izinkan hanya 1 eksemplar per user.
            await connection.rollback();
            return res.status(400).json({ message: 'Anda sudah meminjam / mengajukan buku ini. Satu eksemplar per pengguna.' });
        }

        // Tentukan tanggal pinjam & estimasi kembali (gunakan returnDate dari client jika valid <= MAX_LOAN_DAYS)
        const now = new Date();
        const loanDate = format(now, 'yyyy-MM-dd HH:mm:ss');
        let expectedReturnDate = null;
        if (returnDate) {
            // Ikuti penuh tanggal yang dipilih user (tanpa batas maksimum hari)
            const clientReturn = new Date(returnDate);
            // Jika tanggal valid dan di masa depan/hari ini, pakai langsung
            if (!isNaN(clientReturn.getTime())) {
                expectedReturnDate = format(clientReturn, 'yyyy-MM-dd HH:mm:ss');
            }
        }
        if (!expectedReturnDate) {
            // Jika user tidak mengisi atau tanggal tidak valid, fallback 7 hari dari sekarang
            expectedReturnDate = format(addDays(now, 7), 'yyyy-MM-dd HH:mm:ss');
        }

        // Pastikan kolom tambahan ada (runtime safety jika migrasi belum jalan)
        const [cols] = await connection.query("SHOW COLUMNS FROM loans");
        const colNames = cols.map(c => c.Field);
        let hasKode = colNames.includes('kodePinjam');
        let hasPurpose = colNames.includes('purpose');
        if (!hasKode || !hasPurpose) {
            try {
                if (!hasKode) await connection.query("ALTER TABLE loans ADD COLUMN kodePinjam varchar(40) NULL AFTER status");
                if (!hasPurpose) await connection.query("ALTER TABLE loans ADD COLUMN purpose text NULL");
                if (!hasKode) { try { await connection.query('ALTER TABLE loans ADD UNIQUE KEY uniq_kodePinjam (kodePinjam)'); } catch {}
                }
                // Refresh daftar kolom setelah ALTER
                const [cols2] = await connection.query('SHOW COLUMNS FROM loans');
                const fresh = cols2.map(c=>c.Field);
                hasKode = fresh.includes('kodePinjam');
                hasPurpose = fresh.includes('purpose');
            } catch (mErr) {
                console.warn('[LOAN][MIGRATION RUNTIME] Gagal menambah kolom:', mErr.message);
            }
        }

        // Jangan buat kodePinjam pada saat request; hanya setelah Admin menyetujui
        const genKode = () => {
            const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
            const datePart = format(now, 'yyyyMMdd');
            return `KP-${datePart}-${randomPart}`;
        };
        let kodePinjam = null;

        // Susun query insert dinamis sesuai kolom yang ada (gunakan flag hasKode/hasPurpose yang sudah direfresh)
        const baseCols = ['user_id','book_id','loanDate','expectedReturnDate','status'];
        const vals = [userId, bookId, loanDate, expectedReturnDate, 'Menunggu Persetujuan'];
        // Jangan sertakan kodePinjam pada insert awal agar tetap NULL sampai disetujui
        if (hasPurpose) { baseCols.push('purpose'); vals.push(purpose || null); }
        const placeholders = baseCols.map(()=>'?').join(',');
        const insertSQL = `INSERT INTO loans (${baseCols.join(',')}) VALUES (${placeholders})`;
        const [result] = await connection.query(insertSQL, vals);

        // Biarkan kodePinjam NULL pada saat request; akan diisi saat approval
        
        // Kurangi Stok Tersedia
        await connection.query('UPDATE books SET availableStock = availableStock - 1 WHERE id = ?', [bookId]);

        await connection.commit();
        const loanPayload = {
            id: result.insertId,
            bookTitle: book[0].title,
            loanDate,
            expectedReturnDate,
            status: 'Menunggu Persetujuan',
        };
        // kodePinjam tidak disertakan karena belum ada pada tahap ini
        if (purpose) loanPayload.purpose = purpose;

        res.json({ 
            success: true, 
            message: `Permintaan pinjaman buku "${book[0].title}" berhasil. Menunggu persetujuan Admin.`,
            loan: loanPayload
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error requesting loan:', error);
        res.status(500).json({ message: 'Gagal memproses permintaan pinjaman.' });
    } finally {
        if (connection) connection.release();
    }
};

// 2. Mendapatkan Riwayat Pinjaman User (GET /api/loans/user-history)
exports.getUserLoanHistory = async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.user.id; 

    try {
        const query = `
            SELECT 
                l.id, l.loanDate, l.expectedReturnDate, l.actualReturnDate, l.status, l.fineAmount, l.finePaid,
                b.title, b.author, b.kodeBuku, b.image_url
            FROM loans l
            JOIN books b ON l.book_id = b.id
            WHERE l.user_id = ?
            ORDER BY l.loanDate DESC
        `;
        const [loans] = await pool.query(query, [userId]);
        
        // Cek dan update status pinjaman jika terlambat (auto-update status "Sedang Dipinjam" ke "Terlambat")
        const today = new Date();
        const updatedLoans = loans.map(loan => {
            if (loan.status === 'Sedang Dipinjam' && loan.expectedReturnDate && isBefore(new Date(loan.expectedReturnDate), today)) {
                // Tandai sebagai terlambat di response, tidak perlu update DB setiap saat
                return { ...loan, status: 'Terlambat' };
            }
            return loan;
        });

        res.json(updatedLoans);
    } catch (error) {
        console.error('❌ Error fetching user loan history:', error);
        res.status(500).json({ message: 'Gagal mengambil riwayat pinjaman.' });
    }
};

// 2b. Mendapatkan Semua Pinjaman User (GET /api/loans/user) - untuk tampilan tab (pending/active/history)
exports.getUserLoans = async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.user.id;
    try {
        const connection = await pool.getConnection();
        const [cols] = await connection.query('SHOW COLUMNS FROM loans');
        const names = cols.map(c => c.Field);
        const selectParts = [
            'l.id','l.loanDate','l.expectedReturnDate AS returnDate','l.actualReturnDate','l.status','l.fineAmount','l.returnDecision'
        ];
        if (names.includes('kodePinjam')) selectParts.push('l.kodePinjam');
        if (names.includes('purpose')) selectParts.push('l.purpose');
        if (names.includes('finePaid')) selectParts.push('l.finePaid');
        if (names.includes('finePaymentStatus')) selectParts.push('l.finePaymentStatus');
        if (names.includes('finePaymentMethod')) selectParts.push('l.finePaymentMethod');
        if (names.includes('finePaymentProof')) selectParts.push('l.finePaymentProof');
        selectParts.push('b.title as bookTitle','b.kodeBuku','b.author','b.location');
        // Backfill sebelum select (non-blok karena sederhana)
        try { await backfillMissingKodePinjam(connection); } catch (bfErr) { console.warn('[LOAN][BACKFILL] gagal:', bfErr.message); }
        const query = `SELECT ${selectParts.join(', ')} FROM loans l JOIN books b ON l.book_id = b.id WHERE l.user_id = ? ORDER BY l.loanDate DESC`;
        const [rows] = await connection.query(query, [userId]);
        connection.release();
        res.json(rows);
    } catch (error) {
        console.error('❌ Error fetching user loans:', error);
        res.status(500).json({ message: 'Gagal mengambil daftar pinjaman.' });
    }
};

// 3. Menandai Siap Dikembalikan (POST /api/loans/ready-to-return/:id)
exports.markAsReadyToReturn = async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.user.id; 
    const loanId = req.params.id;

    if (!loanId) {
        return res.status(400).json({ message: 'ID Pinjaman diperlukan.' });
    }

    try {
        // Cek kepemilikan dan status pinjaman + kolom opsional
        const [loans] = await pool.query(
            "SELECT status, returnProofUrl FROM loans WHERE id = ? AND user_id = ?",
            [loanId, userId]
        );

        if (loans.length === 0) {
            return res.status(404).json({ message: 'Pinjaman tidak ditemukan atau bukan milik Anda.' });
        }

        const currentStatus = loans[0].status;

        // Izinkan dari 'Sedang Dipinjam' atau 'Terlambat' saja
        if (!['Sedang Dipinjam', 'Terlambat'].includes(currentStatus)) {
            return res.status(400).json({ message: `Pinjaman berstatus '${currentStatus}'. Hanya 'Sedang Dipinjam' atau 'Terlambat' yang bisa ditandai siap dikembalikan.` });
        }

        // Tangani file bukti (jika ada)
        let proofUrl = loans[0].returnProofUrl || null;
        if (req.file) {
            // Simpan path relatif yang bisa diakses klien (/uploads/...)
            proofUrl = `/uploads/${req.file.filename}`;
        }

        // Parse metadata dari body (dikirim sebagai JSON string)
        let metadata = null;
        if (req.body.metadata) {
            try {
                metadata = JSON.parse(req.body.metadata);
            } catch (e) {
                console.warn('Failed to parse metadata:', e);
            }
        }

        // Update status menjadi Siap Dikembalikan + set readyReturnDate + proof + metadata
        const [result] = await pool.query(
            "UPDATE loans SET status = ?, readyReturnDate = ?, returnProofUrl = ?, returnProofMetadata = ? WHERE id = ? AND user_id = ?",
            ['Siap Dikembalikan', new Date(), proofUrl, metadata ? JSON.stringify(metadata) : null, loanId, userId]
        );

        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Buku ditandai Siap Dikembalikan. Menunggu verifikasi Admin.', proofUrl });
        } else {
            res.status(500).json({ message: 'Gagal memperbarui status pinjaman.' });
        }

    } catch (error) {
        console.error('❌ Error marking as ready to return:', error);
        res.status(500).json({ message: 'Gagal memproses permintaan pengembalian.' });
    }
};


// =========================================================
//                   RUTE ADMIN (Kelola Pinjaman & Pengembalian)
// =========================================================

// 4. Mendapatkan Pinjaman Tertunda (GET /api/admin/loans/pending)
exports.getPendingLoans = async (req, res) => {
    const pool = getDBPool(req);
    try {
        const query = `
            SELECT 
                l.id, l.loanDate, l.status,
                b.title, b.kodeBuku, b.author, 
                u.username, u.npm, u.fakultas, u.prodi
            FROM loans l
            JOIN users u ON l.user_id = u.id
            JOIN books b ON l.book_id = b.id
            WHERE l.status = 'Menunggu Persetujuan'
            ORDER BY l.loanDate ASC
        `;
        const [loans] = await pool.query(query);
        res.json(loans);
    } catch (error) {
        console.error('❌ Error fetching pending loans:', error);
        res.status(500).json({ message: 'Gagal mengambil data pinjaman tertunda.' });
    }
};

// 5. Mendapatkan Pengembalian untuk Review (GET /api/admin/returns/review)
exports.getReturnsForReview = async (req, res) => {
    const pool = getDBPool(req);
    try {
        // Check if returnProofMetadata column exists
        let hasMetadataCol = false;
        try {
            const [cols] = await pool.query("SHOW COLUMNS FROM loans LIKE 'returnProofMetadata'");
            hasMetadataCol = cols.length > 0;
        } catch (e) {
            console.warn('Failed to check returnProofMetadata column:', e.message);
        }

        const metadataField = hasMetadataCol ? ', l.returnProofMetadata' : '';
        
        const query = `
            SELECT 
                l.id, l.loanDate, l.expectedReturnDate, l.status, l.fineAmount, l.finePaid, l.returnProofUrl${metadataField}, l.readyReturnDate,
                b.title, b.kodeBuku, b.author, 
                u.username, u.npm, u.fakultas, u.denda as userDenda
            FROM loans l
            JOIN users u ON l.user_id = u.id
            JOIN books b ON l.book_id = b.id
            WHERE l.status IN ('Sedang Dipinjam', 'Terlambat', 'Siap Dikembalikan')
            ORDER BY l.expectedReturnDate ASC
        `;
        const [loans] = await pool.query(query);
        
        // Lakukan perhitungan denda saat ini di server
        const today = new Date();
        const loansWithPenalty = loans.map(loan => {
            let status = loan.status;
            let calculatedPenalty = 0;

            if (status === 'Sedang Dipinjam' || status === 'Terlambat' || status === 'Siap Dikembalikan') {
                calculatedPenalty = calculatePenalty(loan.expectedReturnDate, today);
                
                // Jika terlambat (dan belum ada status "Siap Dikembalikan"), update status di view
                if (status === 'Sedang Dipinjam' && calculatedPenalty > 0) {
                    status = 'Terlambat';
                }
            }

            return { 
                ...loan, 
                status: status,
                calculatedPenalty: calculatedPenalty, 
                calculatedPenaltyRupiah: formatRupiah(calculatedPenalty)
            };
        });

        res.json(loansWithPenalty);
    } catch (error) {
        console.error('❌ Error fetching returns for review:', error);
        res.status(500).json({ message: 'Gagal mengambil data pengembalian.' });
    }
};

// 6. Menyetujui Pinjaman (POST /api/admin/loans/approve)
// Baru: set status 'Disetujui', generate kodePinjam (jika belum ada), set approvedAt, dan trigger notifikasi user
exports.approveLoan = async (req, res) => {
    const pool = getDBPool(req);
    const { loanId } = req.body;
    if (!loanId) return res.status(400).json({ message: 'ID Pinjaman diperlukan.' });
    try {
        const now = new Date();
        // Ambil expectedReturnDate & kodePinjam saat ini
        const [rows] = await pool.query('SELECT expectedReturnDate, kodePinjam FROM loans WHERE id = ?', [loanId]);
        if (!rows.length) return res.status(404).json({ message: 'Pinjaman tidak ditemukan.' });
        const currentExpected = rows[0].expectedReturnDate;
        const expected = currentExpected || addDays(now, 7);
        // Generate kodePinjam jika kosong
        let kode = rows[0].kodePinjam;
        if (!kode || kode === '') {
            const datePart = format(now, 'yyyyMMdd');
            const rnd = Math.random().toString(36).substring(2,6).toUpperCase();
            kode = `KP-${datePart}-${rnd}`;
            try { await pool.query('UPDATE loans SET kodePinjam=? WHERE id=?',[kode, loanId]); } catch {}
        }
        // Set status Disetujui, set approvedAt, jangan set loanDate di tahap ini
        const [result] = await pool.query(
            "UPDATE loans SET status = 'Disetujui', expectedReturnDate = ?, approvedAt = ?, userNotified = 0 WHERE id = ? AND status = 'Menunggu Persetujuan'",
            [expected, now, loanId]
        );
        if (result.affectedRows === 0) {
            const [exist] = await pool.query('SELECT status FROM loans WHERE id = ?',[loanId]);
            if (exist.length) return res.status(400).json({ message: `Pinjaman sudah diproses (Status: ${exist[0].status}).` });
            return res.status(404).json({ message: 'Pinjaman tidak ditemukan.' });
        }
        res.json({ success:true, message:'Pinjaman disetujui. QR siap ditunjukkan oleh pengguna.', expectedReturnDate: expected, kodePinjam: kode });
    } catch (e){
        console.error('❌ Error approving loan:', e);
        res.status(500).json({ message:'Gagal menyetujui pinjaman.' });
    }
};

// 6b. Scan kodePinjam oleh Admin (POST /api/admin/loans/scan {kodePinjam})
// TRANSISI: Disetujui -> Diambil (set loanDate = now)
exports.scanLoan = async (req, res) => {
    const pool = getDBPool(req);
    const { kodePinjam } = req.body;
    if (!kodePinjam) return res.status(400).json({ message:'kodePinjam diperlukan.' });
    try {
        const [rows] = await pool.query("SELECT id, status FROM loans WHERE kodePinjam = ? LIMIT 1", [kodePinjam]);
        if (!rows.length) return res.status(404).json({ message:'Kode tidak ditemukan.' });
        const loan = rows[0];
        if (loan.status !== 'Disetujui') return res.status(400).json({ message:`Status sekarang '${loan.status}'. Hanya 'Disetujui' yang bisa discan untuk pengambilan.` });
        const now = new Date();
        await pool.query("UPDATE loans SET status = 'Diambil', loanDate = ? WHERE id = ?", [now, loan.id]);
        res.json({ success:true, message:'Scan berhasil. Buku ditandai Diambil.', loanId: loan.id });
    } catch (e){
        console.error('❌ Error scan loan:', e); res.status(500).json({ message:'Gagal memproses scan.' });
    }
};

// 6c. Mulai masa pinjam (POST /api/admin/loans/start {loanId})
// TRANSISI: Diambil -> Sedang Dipinjam
// Aturan baru: Tanggal jatuh tempo (expectedReturnDate) digeser relatif dari saat mulai (scan),
//              mempertahankan durasi rencana awal user. Dengan demikian denda baru dihitung
//              setelah admin melakukan scan & start.
exports.startLoan = async (req, res) => {
    const pool = getDBPool(req);
    const { loanId } = req.body;
    if (!loanId) return res.status(400).json({ message:'loanId diperlukan.' });
    try {
        const [rows] = await pool.query('SELECT status, loanDate, expectedReturnDate FROM loans WHERE id = ? LIMIT 1',[loanId]);
        if (!rows.length) return res.status(404).json({ message:'Pinjaman tidak ditemukan.' });
        const loan = rows[0];
        if (loan.status !== 'Diambil') return res.status(400).json({ message:`Status sekarang '${loan.status}'. Harus 'Diambil' untuk mulai dipinjam.` });
        // Hitung durasi rencana awal (hari) dari request: expectedReturnDate - loanDate (saat request)
        const baseLoanDate = loan.loanDate ? new Date(loan.loanDate) : new Date();
        const baseExpected = loan.expectedReturnDate ? new Date(loan.expectedReturnDate) : addDays(baseLoanDate, 7);
        let plannedDays = Math.max(1, differenceInCalendarDays(startOfDay(baseExpected), startOfDay(baseLoanDate)));
        // Set expectedReturnDate baru berdasarkan waktu mulai sekarang
        const now = new Date();
        const newExpected = addDays(now, plannedDays);
        await pool.query("UPDATE loans SET status='Sedang Dipinjam', expectedReturnDate = ? WHERE id = ?", [newExpected, loanId]);
        res.json({ success:true, message:'Peminjaman dimulai.', expectedReturnDate: newExpected });
    } catch (e){
        console.error('❌ Error start loan:', e); res.status(500).json({ message:'Gagal memulai pinjaman.' });
    }
};

// 7. Menolak Pinjaman (POST /api/admin/loans/reject)
exports.rejectLoan = async (req, res) => {
    const pool = getDBPool(req);
    const { loanId } = req.body;

    if (!loanId) {
        return res.status(400).json({ message: 'ID Pinjaman diperlukan.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Ambil info buku & user sebelum update status
        const [loanInfo] = await connection.query(`
            SELECT l.book_id, b.title 
            FROM loans l JOIN books b ON l.book_id = b.id 
            WHERE l.id = ? AND l.status = 'Menunggu Persetujuan'`, [loanId]);

        if (loanInfo.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Pinjaman tertunda tidak ditemukan atau sudah diproses.' });
        }

        // 1. Update status pinjaman
        const [result] = await connection.query(
            "UPDATE loans SET status = ?, rejectionDate = ?, rejectionNotified = 0 WHERE id = ? AND status = 'Menunggu Persetujuan'",
            ['Ditolak', new Date(), loanId]
        );
        
        // 2. Tambah kembali stok buku
        await connection.query('UPDATE books SET availableStock = availableStock + 1 WHERE id = ?', [loanInfo[0].book_id]);

        await connection.commit();
        res.json({ success: true, message: `Permintaan pinjaman buku "${loanInfo[0].title}" berhasil ditolak.` });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error rejecting loan:', error);
        res.status(500).json({ message: 'Gagal menolak pinjaman.' });
    } finally {
        if (connection) connection.release();
    }
};


// 8. Memproses Pengembalian (POST /api/admin/returns/process)
exports.processReturn = async (req, res) => {
    const pool = getDBPool(req);
    const { loanId, manualFineAmount = 0 } = req.body; // Admin bisa input denda manual (misal: kerusakan buku)

    if (!loanId) {
        return res.status(400).json({ message: 'ID Pinjaman diperlukan.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const actualReturnDate = new Date();

        // 1. Ambil data pinjaman untuk perhitungan denda otomatis
        const [loanData] = await connection.query(
            "SELECT l.expectedReturnDate, l.book_id, l.user_id, u.denda, b.title FROM loans l JOIN users u ON l.user_id = u.id JOIN books b ON l.book_id = b.id WHERE l.id = ? AND l.status IN (?, ?, ?)",
            [loanId, 'Sedang Dipinjam', 'Terlambat', 'Siap Dikembalikan']
        );

        if (loanData.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Pinjaman tidak ditemukan atau sudah dikembalikan.' });
        }

        const { expectedReturnDate, book_id, user_id, denda: userCurrentFine, title: bookTitle } = loanData[0];
        
        // Hitung denda keterlambatan (Otomatis)
        const autoPenalty = calculatePenalty(expectedReturnDate, actualReturnDate);
        
        // Total Denda = Denda Otomatis + Denda Manual
        const totalFine = autoPenalty + Number(manualFineAmount); 

        // 2. Update status pinjaman menjadi 'Dikembalikan', simpan denda & tanggal pengembalian
        await connection.query(
            "UPDATE loans SET status = ?, actualReturnDate = ?, fineAmount = ?, finePaid = ?, returnNotified = 0, returnDecision = 'approved' WHERE id = ?",
            ['Dikembalikan', actualReturnDate, totalFine, 0, loanId] // finePaid 0 karena belum dibayar
        );
        
        // 3. Tambahkan total denda ke akun user
        let totalNewFine = 0;
       if (totalFine > 0) {
           await connection.query('UPDATE users SET denda = denda + ?, denda_unpaid = denda_unpaid + ? WHERE id = ?', [totalFine, totalFine, user_id]);
           totalNewFine = totalFine;
       }

        // 4. Tambah stok buku kembali
        await connection.query('UPDATE books SET availableStock = availableStock + 1 WHERE id = ?', [book_id]);

        await connection.commit();
        
        // Berikan detail denda ke admin
        let penaltyMessage = totalNewFine > 0 ? 
            `. Total Denda (Keterlambatan + Manual): **${formatRupiah(totalNewFine)}**. Denda ditambahkan ke akun user.` :
            '. Tidak ada denda yang diterapkan.';

        res.json({ 
            success: true, 
            message: `Buku "${bookTitle}" berhasil diproses pengembaliannya` + penaltyMessage,
            totalFine: totalNewFine,
            autoPenalty: autoPenalty,
            manualFine: Number(manualFineAmount)
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error processing return:', error);
        res.status(500).json({ message: 'Gagal memproses pengembalian buku.' });
    } finally {
        if (connection) connection.release();
    }
};

// 8b. Menolak Bukti Pengembalian (POST /api/admin/returns/reject)
// Efek: Jika status loan 'Siap Dikembalikan', kembalikan ke status berjalan ('Sedang Dipinjam' atau 'Terlambat' tergantung due date), kosongkan returnProofUrl & readyReturnDate
exports.rejectReturnProof = async (req, res) => {
    const pool = getDBPool(req);
    const { loanId } = req.body;
    if (!loanId) return res.status(400).json({ message: 'ID Pinjaman diperlukan.' });

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.query(
            `SELECT id, expectedReturnDate, status FROM loans WHERE id=? FOR UPDATE`,
            [loanId]
        );
        if (!rows.length) {
            await connection.rollback();
            return res.status(404).json({ message: 'Pinjaman tidak ditemukan.' });
        }
        const loan = rows[0];
        if (loan.status !== 'Siap Dikembalikan') {
            await connection.rollback();
            return res.status(400).json({ message: `Status sekarang '${loan.status}'. Hanya 'Siap Dikembalikan' yang bisa ditolak bukti pengembaliannya.` });
        }

        // Tentukan status berjalan setelah ditolak
        const now = new Date();
        const due = loan.expectedReturnDate ? new Date(loan.expectedReturnDate) : null;
        const nextStatus = (due && now > due) ? 'Terlambat' : 'Sedang Dipinjam';

        await connection.query(
            `UPDATE loans SET status=?, returnProofUrl=NULL, readyReturnDate=NULL, returnNotified = 0, returnDecision = 'rejected' WHERE id=?`,
            [nextStatus, loanId]
        );

        await connection.commit();
        res.json({ success:true, message:'Bukti pengembalian ditolak. Minta pengguna upload ulang.', nextStatus });
    } catch (e){
        if (connection) await connection.rollback();
        console.error('❌ Error rejectReturnProof:', e);
        res.status(500).json({ message: 'Gagal menolak bukti pengembalian.' });
    } finally {
        if (connection) connection.release();
    }
};

// 9. Notifikasi Approval Peminjaman (GET /api/loans/notifications)
exports.getApprovalNotifications = async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.user.id;
    try {
        const [rows] = await pool.query(
            `SELECT id, book_id, approvedAt, status, kodePinjam FROM loans 
             WHERE user_id = ? AND approvedAt IS NOT NULL AND userNotified = 0 AND status IN ('Sedang Dipinjam','Diambil','Disetujui')
             ORDER BY approvedAt DESC LIMIT 20`,
            [userId]
        );
        res.json({ success:true, notifications: rows });
    } catch (e){
        console.error('❌ Error getApprovalNotifications:', e);
        res.status(500).json({ success:false, message:'Gagal mengambil notifikasi.' });
    }
};

// 10. Acknowledge Notifikasi Peminjaman (POST /api/loans/notifications/ack)
exports.ackApprovalNotifications = async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.user.id;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success:false, message:'IDs diperlukan.' });
    }
    try {
        const placeholders = ids.map(()=>'?').join(',');
        await pool.query(`UPDATE loans SET userNotified = 1 WHERE user_id = ? AND id IN (${placeholders})`, [userId, ...ids]);
        res.json({ success:true });
    } catch (e){
        console.error('❌ Error ackApprovalNotifications:', e);
        res.status(500).json({ success:false, message:'Gagal update notifikasi.' });
    }
};

// 11. Notifikasi Pengembalian (GET /api/loans/return-notifications)
exports.getReturnNotifications = async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.user.id;
    try {
        const [rows] = await pool.query(
            `SELECT l.id, l.status, l.returnDecision, l.actualReturnDate, l.fineAmount, b.title AS bookTitle
             FROM loans l
             JOIN books b ON l.book_id = b.id
             WHERE l.user_id = ? AND l.returnNotified = 0 AND l.returnDecision IS NOT NULL
             ORDER BY l.actualReturnDate DESC LIMIT 20`,
            [userId]
        );
        res.json({ success:true, notifications: rows });
    } catch (e){
        console.error('❌ Error getReturnNotifications:', e);
        res.status(500).json({ success:false, message:'Gagal mengambil notifikasi pengembalian.' });
    }
};

// 12. Acknowledge Notifikasi Pengembalian (POST /api/loans/return-notifications/ack)
exports.ackReturnNotifications = async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.user.id;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success:false, message:'IDs diperlukan.' });
    }
    try {
        const placeholders = ids.map(()=>'?').join(',');
        await pool.query(`UPDATE loans SET returnNotified = 1 WHERE user_id = ? AND id IN (${placeholders})`, [userId, ...ids]);
        res.json({ success:true });
    } catch (e){
        console.error('❌ Error ackReturnNotifications:', e);
        res.status(500).json({ success:false, message:'Gagal update notifikasi pengembalian.' });
    }
};

// 13. Riwayat Notifikasi (GET /api/loans/notifications/history)
exports.getNotificationHistory = async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.user.id;
    try {
        // Check if returnProofMetadata column exists
        let hasMetadataCol = false;
        try {
            const [cols] = await pool.query("SHOW COLUMNS FROM loans LIKE 'returnProofMetadata'");
            hasMetadataCol = cols.length > 0;
        } catch (e) {
            console.warn('Failed to check returnProofMetadata column:', e.message);
        }

        const metadataField = hasMetadataCol ? ', l.returnProofMetadata' : '';

        const [rows] = await pool.query(
                        `SELECT 
                l.id,
                b.title AS bookTitle,
                l.status,
                l.approvedAt,
                l.actualReturnDate,
                                l.returnDecision,
                                l.rejectionDate,
                                l.returnProofUrl${metadataField}
             FROM loans l
             JOIN books b ON l.book_id = b.id
             WHERE l.user_id = ?
               AND (
                    (l.approvedAt IS NOT NULL) OR
                                        (l.returnDecision IS NOT NULL) OR
                                        (l.rejectionDate IS NOT NULL)
               )
                         ORDER BY COALESCE(l.actualReturnDate, l.approvedAt, l.rejectionDate, l.createdAt) DESC
             LIMIT 100`,
            [userId]
        );
        res.json({ success:true, items: rows });
    } catch (e){
        console.error('❌ Error getNotificationHistory:', e);
        res.status(500).json({ success:false, message:'Gagal mengambil riwayat notifikasi.' });
    }
};

// 14. Notifikasi Penolakan Pinjaman (GET /api/loans/rejection-notifications)
exports.getRejectionNotifications = async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.user.id;
    try {
        const [rows] = await pool.query(
            `SELECT l.id, l.status, l.rejectionDate, b.title AS bookTitle
             FROM loans l
             JOIN books b ON l.book_id = b.id
             WHERE l.user_id = ? AND l.status = 'Ditolak' AND l.rejectionDate IS NOT NULL AND (l.rejectionNotified = 0 OR l.rejectionNotified IS NULL)
             ORDER BY l.rejectionDate DESC LIMIT 20`,
            [userId]
        );
        res.json({ success:true, notifications: rows });
    } catch (e){
        console.error('❌ Error ackRejectionNotifications:', e);
        res.status(500).json({ success:false, message:'Gagal update notifikasi penolakan.' });
    }
};

// 16. Mendapatkan Riwayat Pengembalian & Persetujuan (GET /api/admin/history)
exports.getHistory = async (req, res) => {
    const pool = getDBPool(req);
    try {
        // Check if returnProofMetadata column exists
        let hasMetadataCol = false;
        try {
            const [cols] = await pool.query("SHOW COLUMNS FROM loans LIKE 'returnProofMetadata'");
            hasMetadataCol = cols.length > 0;
        } catch (e) {
            console.warn('Failed to check returnProofMetadata column:', e.message);
        }

        const metadataField = hasMetadataCol ? ', l.returnProofMetadata' : '';
        
        // Ambil semua riwayat: Dikembalikan (approved), Ditolak (rejected loan/return)
        const query = `
            SELECT 
                l.id, l.loanDate, l.expectedReturnDate, l.actualReturnDate, l.status, 
                l.fineAmount, l.finePaid, l.returnProofUrl${metadataField}, l.readyReturnDate,
                l.approvedAt, l.returnDecision, l.rejectionReason, l.createdAt,
                b.title, b.kodeBuku, b.author, 
                u.username, u.npm, u.fakultas
            FROM loans l
            JOIN users u ON l.user_id = u.id
            JOIN books b ON l.book_id = b.id
            WHERE l.status IN ('Dikembalikan', 'Ditolak')
            ORDER BY 
                CASE 
                    WHEN l.actualReturnDate IS NOT NULL THEN l.actualReturnDate
                    WHEN l.approvedAt IS NOT NULL THEN l.approvedAt
                    ELSE l.createdAt
                END DESC
            LIMIT 500
        `;
        const [rows] = await pool.query(query);
        
        const formattedRows = rows.map(row => ({
            ...row,
            fineAmountRupiah: formatRupiah(row.fineAmount || 0),
            finePaidRupiah: formatRupiah(row.finePaid || 0)
        }));

        res.json(formattedRows);
    } catch (error) {
        console.error('❌ Error fetching history:', error);
        res.status(500).json({ message: 'Gagal mengambil riwayat.' });
    }
};

// 15. Ack Penolakan Pinjaman (POST /api/loans/rejection-notifications/ack)
exports.ackRejectionNotifications = async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.user.id;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success:false, message:'IDs diperlukan.' });
    }
    try {
        const placeholders = ids.map(()=>'?').join(',');
        await pool.query(`UPDATE loans SET rejectionNotified = 1 WHERE user_id = ? AND id IN (${placeholders})`, [userId, ...ids]);
        res.json({ success:true });
    } catch (e){
        console.error('❌ Error ackRejectionNotifications:', e);
        res.status(500).json({ success:false, message:'Gagal update notifikasi penolakan.' });
    }
};