// File: controllers/profileController.js
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { isConfigured: isCloudinaryConfigured, uploadBufferToCloudinary, deleteByUrl } = require('../utils/cloudinary');
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const deleteFile = async (filePath) => {
    try {
        await fs.unlink(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') { 
            console.error('Error saat menghapus file lama:', filePath, error);
        }
    }
};

// 1. PUT /api/profile/update-biodata (UPDATED + return updated user)
exports.updateBiodata = async (req, res) => {
    const pool = req.app.get('dbPool');
    if (!req.userData) {
        return res.status(401).json({ success: false, message: 'Token tidak valid (userData hilang).' });
    }
    const { npm, id } = req.userData; 
    const { username, fakultas, prodi, angkatan } = req.body || {};

    if (!username || !fakultas || !prodi || !angkatan) {
        return res.status(400).json({ success: false, message: 'Field username, fakultas, prodi, angkatan wajib diisi.' });
    }

    try {
        console.log('[PROFILE][updateBiodata] userId=%s npm=%s body=%o', id, npm, { username, fakultas, prodi, angkatan });
        const [result] = await pool.query(
            'UPDATE users SET username = ?, fakultas = ?, prodi = ?, angkatan = ? WHERE npm = ?',
            [username, fakultas, prodi, angkatan, npm]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });
        }

        let rows;
        try {
            [rows] = await pool.query('SELECT id, npm, username, role, fakultas, prodi, angkatan, profile_photo_url, denda, active_loans_count FROM users WHERE npm = ? LIMIT 1', [npm]);
        } catch (e) {
            if (e && e.code === 'ER_BAD_FIELD_ERROR') {
                // Fallback jika kolom active_loans_count belum ada di DB
                [rows] = await pool.query('SELECT id, npm, username, role, fakultas, prodi, angkatan, profile_photo_url, denda FROM users WHERE npm = ? LIMIT 1', [npm]);
                if (rows && rows[0]) rows[0].active_loans_count = 0;
            } else {
                throw e;
            }
        }
        const updatedUser = (rows && rows[0]) ? rows[0] : null;
        res.status(200).json({
            success: true,
            message: 'Biodata berhasil diperbarui.',
            user: updatedUser
        });
    } catch (error) {
        console.error('Error updating biodata:', error);
        res.status(500).json({ success: false, message: 'Gagal memperbarui biodata.' });
    }
};


// 2. POST /api/profile/upload-photo (FIXED Non-Dummy)
exports.uploadPhoto = [
    memoryUpload.single('profile_photo'), 
    async (req, res) => {
        const pool = req.app.get('dbPool');
        const { npm } = req.userData;
        
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'File foto tidak ditemukan atau melebihi batas 5MB.' });
        }
        let newPhotoPath = null;
        if (isCloudinaryConfigured()) {
            try {
                const result = await uploadBufferToCloudinary(req.file.buffer, { folder: 'profile-photos', mimetype: req.file.mimetype });
                newPhotoPath = result.secure_url;
            } catch (e) {
                return res.status(500).json({ success:false, message: 'Gagal upload foto ke Cloudinary: ' + e.message });
            }
        } else {
            // Fallback: simpan lokal
            try {
                const dir = path.join(__dirname, '..', 'uploads');
                await fs.mkdir(dir, { recursive:true });
                const ext = (req.file.originalname && req.file.originalname.includes('.')) ? req.file.originalname.substring(req.file.originalname.lastIndexOf('.')) : '.jpg';
                const fname = `profile-${Date.now()}-${Math.round(Math.random()*1e9)}${ext}`;
                const abs = path.join(dir, fname);
                await fs.writeFile(abs, req.file.buffer);
                newPhotoPath = `/uploads/${fname}`;
            } catch (e) {
                return res.status(500).json({ success:false, message:'Gagal menyimpan foto ke disk: ' + e.message });
            }
        }
        
        try {
            const [oldRows] = await pool.query('SELECT profile_photo_url FROM users WHERE npm = ?', [npm]);
            const oldPhotoUrl = oldRows[0]?.profile_photo_url;

            const [result] = await pool.query(
                'UPDATE users SET profile_photo_url = ? WHERE npm = ?',
                [newPhotoPath, npm]
            );

            if (result.affectedRows > 0 && oldPhotoUrl) {
                if (/^https?:\/\//i.test(oldPhotoUrl)) {
                    // Optional: hapus dari Cloudinary
                    try { await deleteByUrl(oldPhotoUrl); } catch {}
                } else {
                    const oldPhotoPath = path.join(__dirname, '..', oldPhotoUrl);
                    await deleteFile(oldPhotoPath);
                }
            }

            res.status(200).json({
                success: true,
                message: 'Foto berhasil diunggah dan disimpan!',
                profile_photo_url: newPhotoPath,
            });
            
        } catch (error) {
            console.error('Error during photo upload/update:', error);
            // Jika fallback lokal dipakai dan file ada, tidak ada path disini (karena pakai memory). Diabaikan.
            res.status(500).json({ success: false, message: 'Gagal mengunggah foto.' });
        }
    }
];

// 3. DELETE /api/profile/delete-photo (FIXED Non-Dummy)
exports.deletePhoto = async (req, res) => {
    const pool = req.app.get('dbPool');
    const { npm } = req.userData;

    try {
        const [oldRows] = await pool.query('SELECT profile_photo_url FROM users WHERE npm = ?', [npm]);
        const oldPhotoUrl = oldRows[0]?.profile_photo_url;
        
        const [result] = await pool.query('UPDATE users SET profile_photo_url = NULL WHERE npm = ?', [npm]);

        if (result.affectedRows > 0 && oldPhotoUrl) {
            if (/^https?:\/\//i.test(oldPhotoUrl)) {
                try { await deleteByUrl(oldPhotoUrl); } catch {}
            } else {
                const oldPhotoPath = path.join(__dirname, '..', oldPhotoUrl);
                await deleteFile(oldPhotoPath);
            }
        }

        res.status(200).json({
            success: true,
            message: 'Foto profil berhasil dihapus dari database dan server.',
        });
        
    } catch (error) {
        console.error('Error during photo deletion:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus foto.' });
    }
};