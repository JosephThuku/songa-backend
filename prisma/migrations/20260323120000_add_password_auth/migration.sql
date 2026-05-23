-- Password auth fields on User (register + login flow)
ALTER TABLE `User` ADD COLUMN `passwordHash` VARCHAR(191) NULL;
ALTER TABLE `User` ADD COLUMN `phoneVerified` BOOLEAN NOT NULL DEFAULT false;
