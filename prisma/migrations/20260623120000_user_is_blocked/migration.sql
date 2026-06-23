-- Admin moderation: block passengers/drivers without hard delete.
-- Idempotent: safe if the column was already added via `prisma db push`.
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'User'
    AND COLUMN_NAME = 'isBlocked'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE `User` ADD COLUMN `isBlocked` BOOLEAN NOT NULL DEFAULT false',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
