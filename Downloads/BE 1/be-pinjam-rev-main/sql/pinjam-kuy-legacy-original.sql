-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Waktu pembuatan: 06 Okt 2025 pada 15.11
-- Versi server: 10.4.32-MariaDB
-- Versi PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `pinjam-kuy`
--

-- --------------------------------------------------------

--
-- Struktur dari tabel `books`
--

CREATE TABLE `books` (
  `id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `kodeBuku` varchar(50) NOT NULL,
  `author` varchar(255) NOT NULL,
  `publisher` varchar(255) DEFAULT NULL,
  `publicationYear` year(4) DEFAULT NULL,
  `totalStock` int(11) NOT NULL,
  `availableStock` int(11) NOT NULL,
  `category` varchar(100) NOT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `location` varchar(100) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `loans`
--

CREATE TABLE `loans` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `book_id` int(11) NOT NULL,
  `loanDate` datetime DEFAULT NULL,
  `expectedReturnDate` date DEFAULT NULL,
  `actualReturnDate` datetime DEFAULT NULL,
  `status` enum('Menunggu Persetujuan','Sedang Dipinjam','Terlambat','Siap Dikembalikan','Dikembalikan','Ditolak') DEFAULT 'Menunggu Persetujuan',
  `fineAmount` int(11) DEFAULT 0,
  `finePaid` int(11) DEFAULT 0,
  `rejectionDate` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Struktur dari tabel `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `npm` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `username` varchar(255) NOT NULL,
  `angkatan` varchar(255) DEFAULT NULL,
  `fakultas` varchar(255) DEFAULT NULL,
  `prodi` varchar(255) DEFAULT NULL,
  `role` enum('user','admin') DEFAULT 'user',
  `profile_photo_url` varchar(255) DEFAULT NULL,
  `denda` decimal(10,2) DEFAULT 0.00,
  `active_loans_count` int(11) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data untuk tabel `users`
--

INSERT INTO `users` (`id`, `npm`, `password`, `username`, `angkatan`, `fakultas`, `prodi`, `role`, `profile_photo_url`, `denda`, `active_loans_count`) VALUES
(1, '123456', '$2b$10$IKolWxl/DByohJrDrc2qCOKXeMNrHfDN9AYKiSBkryefB/Uz3i7rK', 'Admin Perpustakaan', '2020', 'Fakultas', 'Prodi', 'admin', '/uploads/123456-1759657976365-597496106.svg', 0.00, 0),
(2, '240611015', '$2b$10$jgfF5Sqyrp6/g0wScFvi2euutHOiy0fTyZ48KqSNUb5uoyBdImP9.', 'Maha Putra', '2024', 'Fakultas Teknik', 'Informatika', 'user', '/uploads/240611015-1759654443628-727727313.svg', NULL, 0),
(3, '240611029', '$2b$10$4HNuFLJzcXRiddBlWx3lN.Kz3ljhscQpcxlQbPZqDf1AFfbpRmoKm', 'I Putu Gilang Permana', '2024', 'Teknik', 'Informatika', 'user', '/uploads/profile_photos/240611029.JPG', 0.00, 0),
(4, '240611021', '$2b$10$W1QzmWn9b3YnBdWx8egqNOHCEewpPVCPh3RcDjj3YcBG3u4sl45BC', 'Naufal Hafizh Prasetyo', '2024', 'Teknik', 'Informatika', 'user', '/uploads/profile_photos/240611021.webp', 0.00, 0);

--
-- Indexes for dumped tables
--

--
-- Indeks untuk tabel `books`
--
ALTER TABLE `books`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `kodeBuku` (`kodeBuku`);

--
-- Indeks untuk tabel `loans`
--
ALTER TABLE `loans`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `book_id` (`book_id`);

--
-- Indeks untuk tabel `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `npm` (`npm`);

--
-- AUTO_INCREMENT untuk tabel yang dibuang
--

--
-- AUTO_INCREMENT untuk tabel `books`
--
ALTER TABLE `books`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `loans`
--
ALTER TABLE `loans`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT untuk tabel `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- Ketidakleluasaan untuk tabel pelimpahan (Dumped Tables)
--

--
-- Ketidakleluasaan untuk tabel `loans`
--
ALTER TABLE `loans`
  ADD CONSTRAINT `loans_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `loans_ibfk_2` FOREIGN KEY (`book_id`) REFERENCES `books` (`id`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
