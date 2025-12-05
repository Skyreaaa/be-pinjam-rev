-- Migration: Add metadata columns for return proof
-- Tanggal: 2024-12-01
-- Deskripsi: Menambah kolom untuk menyimpan metadata foto pengembalian (koordinat, waktu, alamat)

ALTER TABLE loans
ADD COLUMN IF NOT EXISTS returnProofMetadata JSON NULL COMMENT 'Metadata foto pengembalian: koordinat, waktu, alamat' AFTER returnProofUrl;

-- Contoh struktur JSON yang akan disimpan:
-- {
--   "timestamp": "2024-12-01T14:30:00.000Z",
--   "coordinates": {
--     "latitude": -6.2088,
--     "longitude": 106.8456,
--     "accuracy": 10
--   },
--   "address": "Jl. Contoh No. 123, Jakarta",
--   "device": "Camera/File Upload"
-- }
