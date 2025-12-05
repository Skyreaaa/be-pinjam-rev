// File: middleware/upload.js
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Pastikan folder 'uploads' sudah ada di root proyek Anda
        cb(null, 'uploads'); 
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // ASUMSI: req.userData.npm sudah di-set oleh middleware otentikasi
        // Menggunakan NPM dari token JWT untuk nama file
        const npm = req.userData && req.userData.npm ? req.userData.npm : 'default-user';
        cb(null, npm + '-' + uniqueSuffix + path.extname(file.originalname)); 
    }
});

const fileFilter = (req, file, cb) => {
    // Hanya izinkan tipe file gambar
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Tipe file tidak didukung, hanya gambar.'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 1024 * 1024 * 5 // Max 5MB
    }
});

module.exports = upload;