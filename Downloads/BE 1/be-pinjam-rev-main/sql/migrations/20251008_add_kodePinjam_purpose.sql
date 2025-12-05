-- Migration: add kodePinjam & purpose columns to loans table (idempotent guards)
ALTER TABLE `loans`
  ADD COLUMN `kodePinjam` varchar(40) NULL AFTER `status`,
  ADD COLUMN `purpose` text NULL AFTER `kodePinjam`;

-- If expectedReturnDate currently DATE, keep; if want DATETIME uncomment below:
-- ALTER TABLE `loans` MODIFY `expectedReturnDate` datetime NULL;

-- Add index for kodePinjam lookups
ALTER TABLE `loans`
  ADD UNIQUE KEY `uniq_kodePinjam` (`kodePinjam`);
