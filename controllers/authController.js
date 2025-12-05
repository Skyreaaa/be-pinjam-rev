// File: backend/controllers/authController.js (Diperbarui)

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET || 'ganti-dengan-secret-key-yang-kuat'; 

const getUserDataWithoutHash = (user) => {
    // Pastikan password tidak ikut terkirim
    const { password, ...userData } = user; 
    return userData;
};

exports.login = async (req, res) => {
    const pool = req.app.get('dbPool');
    const { npm, password } = req.body || {};

    if (!npm || !password) {
        return res.status(400).json({ success: false, message: 'NPM dan password wajib diisi.' });
    }

    const verbose = process.env.AUTH_DEBUG === 'true';
    const baseColumns = 'id, npm, username, password, role, angkatan, fakultas, prodi, profile_photo_url';
    const extraColumns = 'active_loans_count, denda';
    let user;

    try {
        if (verbose) console.log('[LOGIN] Attempt npm=', npm);
        let rows;
        try {
            if (verbose) console.log('[LOGIN] Primary query with extra columns');
            [rows] = await pool.query(
                `SELECT ${baseColumns}, ${extraColumns} FROM users WHERE npm = ? LIMIT 1`,
                [npm]
            );
        } catch (qErr) {
            // Fallback if columns do not exist (ER_BAD_FIELD_ERROR = 1054)
            if (qErr && qErr.code === 'ER_BAD_FIELD_ERROR') {
                if (verbose) console.warn('[LOGIN] Fallback query: columns missing (active_loans_count / denda). Error:', qErr.message);
                [rows] = await pool.query(
                    `SELECT ${baseColumns} FROM users WHERE npm = ? LIMIT 1`,
                    [npm]
                );
            } else {
                throw qErr; // rethrow unexpected query error
            }
        }

        if (!rows || rows.length === 0) {
            if (verbose) console.log('[LOGIN] User not found for npm', npm);
            return res.status(401).json({ success: false, message: 'NPM atau Kata Sandi salah.' });
        }

        user = rows[0];
        if (verbose) console.log('[LOGIN] User row retrieved (id=%s, hasPassword=%s)', user.id, !!user.password);

        // Password hash sanity check
        if (!user.password || user.password.length < 20) { // very short to be a bcrypt hash
            if (verbose) console.warn('[LOGIN] Stored password hash seems invalid/too short for user id=%s', user.id);
        }

        let isMatch = false;
        try {
            isMatch = await bcrypt.compare(password, user.password);
        } catch (cmpErr) {
            console.error('❌ ERROR: bcrypt.compare gagal:', cmpErr);
            return res.status(500).json({ success: false, message: 'Validasi password gagal.' });
        }

        if (!isMatch) {
            if (verbose) console.log('[LOGIN] Password mismatch for npm', npm);
            return res.status(401).json({ success: false, message: 'NPM atau Kata Sandi salah.' });
        }

        let token;
        try {
            token = jwt.sign(
                { id: user.id, npm: user.npm, role: user.role },
                JWT_SECRET,
                { expiresIn: '1d' }
            );
        } catch (signErr) {
            console.error('❌ ERROR: Gagal menandatangani JWT:', signErr);
            return res.status(500).json({ success: false, message: 'Gagal membuat token.' });
        }

        const rawUser = getUserDataWithoutHash(user);
        const normalizedUser = {
            ...rawUser,
            denda: rawUser.denda !== null && rawUser.denda !== undefined ? Number(rawUser.denda) : 0,
            activeLoansCount: rawUser.active_loans_count !== undefined ? rawUser.active_loans_count : 0,
        };

        if (verbose) console.log('[LOGIN] Success for user id=%s role=%s', user.id, user.role);

        return res.status(200).json({
            success: true,
            message: 'Login berhasil!',
            token,
            userData: normalizedUser
        });
    } catch (error) {
        if (error && error.code === 'ER_BAD_DB_ERROR') {
            console.error('❌ ERROR: Database tidak ditemukan saat login:', error.message);
            return res.status(500).json({ success: false, message: 'Database belum diinisialisasi. Restart server untuk auto-create.' });
        }
        if (error && error.code === 'ER_NO_SUCH_TABLE') {
            console.error('❌ ERROR: Tabel users belum ada:', error.message);
            return res.status(500).json({ success: false, message: 'Tabel users belum ada. Restart server untuk impor schema.' });
        }
        console.error('❌ ERROR: Gagal login (outer catch):', error);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server saat login.' });
    }
};