-- Migration: Add description column to books table
-- Date: 2025-12-07

ALTER TABLE books 
ADD COLUMN IF NOT EXISTS description TEXT NULL 
AFTER location;

-- Add index for faster text search if needed
-- CREATE FULLTEXT INDEX idx_books_description ON books(description);
