// File: controllers/adminController.js (KODE BERSIH, HANYA KELOLA PENGGUNA & DENDA)

const getDBPool = (req) => req.app.get('dbPool');
const bcrypt = require('bcrypt');
const { format, addDays } = require('date-fns');

// Helper untuk format Rupiah
const formatRupiah = (amount) => {
    const num = Number(amount);
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(num);
};

// =========================================================
//                       KELOLA PENGGUNA (CRUD & Denda)
// =========================================================

// 1. Mendapatkan Semua Pengguna (GET /api/admin/users)
exports.getAllUsers = async (req, res) => {
    const pool = getDBPool(req);
    try {
        // Query untuk menghitung jumlah pinjaman aktif (Sedang Dipinjam, Menunggu Persetujuan, Terlambat, Siap Dikembalikan)
        const query = `
            SELECT 
                u.id, u.username, u.npm, u.role, u.fakultas, u.prodi, u.angkatan,
                u.denda, /* historical / total accumulated */
                COALESCE((
                    SELECT SUM(l.fineAmount - IFNULL(l.finePaid,0))
                    FROM loans l 
                    WHERE l.user_id = u.id 
                      AND l.fineAmount > IFNULL(l.finePaid,0)
                      AND l.finePaymentStatus IN ('unpaid','awaiting_proof','pending_verification')
                ),0) AS active_unpaid_fine,
                (SELECT COUNT(*) FROM loans l2 WHERE l2.user_id = u.id AND l2.status IN ('Sedang Dipinjam', 'Menunggu Persetujuan', 'Terlambat', 'Siap Dikembalikan')) AS active_loans_count
            FROM users u
            ORDER BY u.id DESC
        `;
        const [rows] = await pool.query(query);
        const usersWithFormattedDenda = rows.map(user => ({
            ...user,
            dendaRupiah: formatRupiah(user.denda),
            activeUnpaidFineRupiah: formatRupiah(user.active_unpaid_fine)
        }));

        res.json(usersWithFormattedDenda);
    } catch (error) {
        console.error('❌ Error fetching all users:', error);
        res.status(500).json({ message: 'Gagal mengambil data pengguna.' });
    }
};


// 2. Menambah Pengguna Baru (POST /api/admin/users)
exports.createUser = async (req, res) => {
    const pool = getDBPool(req);
    const { username, npm, password, role = 'user', fakultas, prodi, angkatan } = req.body;
    
    if (!username || !npm || !password) {
        return res.status(400).json({ message: 'Username, NPM, dan Password wajib diisi.' });
    }
    
    try {
        // Cek duplikasi NPM
        const [duplicate] = await pool.query('SELECT id FROM users WHERE npm = ?', [npm]);
        if (duplicate.length > 0) {
            return res.status(400).json({ message: 'NPM sudah terdaftar.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            'INSERT INTO users (username, npm, password, role, fakultas, prodi, angkatan, denda) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [username, npm, hashedPassword, role, fakultas || null, prodi || null, angkatan || null, 0]
        );

        res.status(201).json({ success: true, message: 'Pengguna baru berhasil ditambahkan.', userId: result.insertId });
    } catch (error) {
        console.error('❌ Error creating user:', error);
        res.status(500).json({ message: 'Gagal menambahkan pengguna.' });
    }
};

// 3. Memperbarui Pengguna (PUT /api/admin/users/:id)
exports.updateUser = async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.params.id;
    const { username, npm, password, role, fakultas, prodi, angkatan, denda } = req.body;

    if (!username || !npm || !role) {
        return res.status(400).json({ message: 'Username, NPM, dan Role wajib diisi.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Cek duplikasi NPM (kecuali untuk user ini sendiri)
        const [duplicate] = await connection.query('SELECT id FROM users WHERE npm = ? AND id != ?', [npm, userId]);
        if (duplicate.length > 0) {
            await connection.rollback();
            return res.status(400).json({ message: 'NPM sudah digunakan oleh pengguna lain.' });
        }

        let updateQuery = 'UPDATE users SET username = ?, npm = ?, role = ?, fakultas = ?, prodi = ?, angkatan = ?, denda = ?';
        let params = [username, npm, role, fakultas || null, prodi || null, angkatan || null, denda, userId];
        
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            updateQuery += ', password = ?';
            params.splice(params.length - 1, 0, hashedPassword); // Sisipkan password hash sebelum userId
        }
        
        updateQuery += ' WHERE id = ?';

        const [result] = await connection.query(updateQuery, params);

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
        }

        await connection.commit();
        res.json({ success: true, message: 'Data pengguna berhasil diperbarui.' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error updating user:', error);
        res.status(500).json({ message: 'Gagal memperbarui data pengguna.' });
    } finally {
        if (connection) connection.release();
    }
};

// 4. Menghapus Pengguna (DELETE /api/admin/users/:id)
exports.deleteUser = async (req, res) => {
    const pool = getDBPool(req);
    const userId = req.params.id;

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        
        // Cek apakah user memiliki pinjaman aktif/tertunda
        const [activeLoans] = await connection.query(
            'SELECT COUNT(*) as count FROM loans WHERE user_id = ? AND status IN (?, ?, ?)', 
            [userId, 'Sedang Dipinjam', 'Menunggu Persetujuan', 'Siap Dikembalikan']
        );
        if (activeLoans[0].count > 0) {
            await connection.rollback();
            return res.status(400).json({ message: `Tidak dapat menghapus pengguna. Terdapat ${activeLoans[0].count} pinjaman yang masih aktif (Dipinjam/Tertunda/Siap Dikembalikan).` });
        }

        // Hapus data pengguna
        const [result] = await connection.query('DELETE FROM users WHERE id = ?', [userId]);

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
        }

        await connection.commit();
        res.json({ success: true, message: 'Pengguna berhasil dihapus.' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error deleting user:', error);
        res.status(500).json({ message: 'Gagal menghapus pengguna.' });
    } finally {
        if (connection) connection.release();
    }
};


// 5. Menerapkan Denda Manual (POST /api/admin/penalty/apply)
exports.applyPenalty = async (req, res) => {
    const pool = getDBPool(req);
    const { npm, amount } = req.body; 

    if (!npm || typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ message: 'NPM dan jumlah denda yang valid (> 0) diperlukan.' });
    }

    try {
        const [result] = await pool.query(
            'UPDATE users SET denda = denda + ?, denda_unpaid = denda_unpaid + ? WHERE npm = ?', 
            [amount, amount, npm]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Pengguna dengan NPM tersebut tidak ditemukan.' });
        }

        res.json({ success: true, message: `Denda sebesar ${formatRupiah(amount)} berhasil diterapkan pada NPM ${npm}.` });
    } catch (error) {
        console.error('❌ Error applying penalty:', error);
        res.status(500).json({ message: 'Gagal menerapkan denda di database.' });
    }
};

// 6. Mereset Denda (Lunas) (POST /api/admin/penalty/reset/:id)
exports.resetPenalty = async (req, res) => {
    const pool = getDBPool(req);
    const { id } = req.params; // Menggunakan ID pengguna

    try {
        const [result] = await pool.query(
            'UPDATE users SET denda = 0 WHERE id = ?', 
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
        }
        
        res.json({ success: true, message: 'Denda pengguna berhasil direset (Lunas).' });
    } catch (error) {
        console.error('❌ Error resetting penalty:', error);
        res.status(500).json({ message: 'Gagal mereset denda.' });
    }
};