// File: backend/models/user.js (Diperbarui)

module.exports = (sequelize, DataTypes) => {
    const User = sequelize.define('User', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        username: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        npm: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true, // NPM harus unik (ID Login)
        },
        password: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        role: {
            type: DataTypes.ENUM('user', 'admin'),
            defaultValue: 'user',
        },
        fakultas: {
            type: DataTypes.STRING,
            defaultValue: '',
        },
        prodi: {
            type: DataTypes.STRING,
            defaultValue: '',
        },
        angkatan: {
            type: DataTypes.STRING,
            defaultValue: '',
        },
        profile_photo_url: {
            type: DataTypes.STRING,
            defaultValue: null, // URL foto
        },
        // --- KOLOM BARU DITAMBAH ---
        active_loans_count: {
            type: DataTypes.INTEGER, // Jumlah buku aktif
            defaultValue: 0,
            allowNull: false,
        },
        denda: {
            type: DataTypes.DECIMAL(10, 2), // Jumlah total denda
            defaultValue: 0.00,
            allowNull: false,
        },
        // Sequelize akan menambahkan 'createdAt' dan 'updatedAt'
    });

    return User;
};