// File: controllers/profileController.js
const fs = require('fs/promises');
const path = require('path');
const upload = require('../middleware/upload'); 

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

        const [rows] = await pool.query('SELECT id, npm, username, role, fakultas, prodi, angkatan, profile_photo_url, denda, active_loans_count FROM users WHERE npm = ? LIMIT 1', [npm]);
        const updatedUser = rows[0] || null;
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
    upload.single('profile_photo'), 
    async (req, res) => {
        const pool = req.app.get('dbPool');
        const { npm } = req.userData;
        
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'File foto tidak ditemukan atau melebihi batas 5MB.' });
        }
        
        const newPhotoPath = `/uploads/${req.file.filename}`;
        
        try {
            const [oldRows] = await pool.query('SELECT profile_photo_url FROM users WHERE npm = ?', [npm]);
            const oldPhotoUrl = oldRows[0]?.profile_photo_url;

            const [result] = await pool.query(
                'UPDATE users SET profile_photo_url = ? WHERE npm = ?',
                [newPhotoPath, npm]
            );

            if (result.affectedRows > 0 && oldPhotoUrl) {
                const oldPhotoPath = path.join(__dirname, '..', oldPhotoUrl);
                await deleteFile(oldPhotoPath);
            }

            res.status(200).json({
                success: true,
                message: 'Foto berhasil diunggah dan disimpan!',
                profile_photo_url: newPhotoPath,
            });
            
        } catch (error) {
            console.error('Error during photo upload/update:', error);
            await deleteFile(req.file.path); 
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
            const oldPhotoPath = path.join(__dirname, '..', oldPhotoUrl);
            await deleteFile(oldPhotoPath);
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