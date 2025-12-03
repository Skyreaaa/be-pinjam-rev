// File: middleware/checkAuth.js
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'ganti-dengan-secret-key-yang-kuat'; 

module.exports = (req, res, next) => {
    try {
        const token = req.headers.authorization.split(" ")[1];
        if (!token) {
            return res.status(401).json({ success: false, message: 'Autentikasi gagal: Token tidak tersedia.' });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userData = decoded; 
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
             return res.status(401).json({ success: false, message: 'Autentikasi gagal: Token kadaluarsa.' });
        }
        return res.status(401).json({ success: false, message: 'Autentikasi gagal: Token tidak valid.' });
    }
};