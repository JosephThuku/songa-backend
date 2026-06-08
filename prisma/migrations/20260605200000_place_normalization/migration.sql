-- Phase 2: normalized Place table + Ride/Booking FK columns (JSON snapshots retained).

CREATE TABLE `Place` (
    `id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `lat` DOUBLE NOT NULL,
    `lng` DOUBLE NOT NULL,
    `externalPlaceId` VARCHAR(191) NULL,
    `corridorLocationId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Place_corridorLocationId_idx`(`corridorLocationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Place` ADD CONSTRAINT `Place_corridorLocationId_fkey` FOREIGN KEY (`corridorLocationId`) REFERENCES `CorridorLocation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Ride` ADD COLUMN `pickupPlaceId` VARCHAR(191) NULL,
    ADD COLUMN `dropoffPlaceId` VARCHAR(191) NULL;

CREATE INDEX `Ride_pickupPlaceId_idx` ON `Ride`(`pickupPlaceId`);
CREATE INDEX `Ride_dropoffPlaceId_idx` ON `Ride`(`dropoffPlaceId`);

ALTER TABLE `Ride` ADD CONSTRAINT `Ride_pickupPlaceId_fkey` FOREIGN KEY (`pickupPlaceId`) REFERENCES `Place`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Ride` ADD CONSTRAINT `Ride_dropoffPlaceId_fkey` FOREIGN KEY (`dropoffPlaceId`) REFERENCES `Place`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Booking` ADD COLUMN `pickupPlaceId` VARCHAR(191) NULL,
    ADD COLUMN `dropoffPlaceId` VARCHAR(191) NULL;

CREATE INDEX `Booking_pickupPlaceId_idx` ON `Booking`(`pickupPlaceId`);
CREATE INDEX `Booking_dropoffPlaceId_idx` ON `Booking`(`dropoffPlaceId`);

ALTER TABLE `Booking` ADD CONSTRAINT `Booking_pickupPlaceId_fkey` FOREIGN KEY (`pickupPlaceId`) REFERENCES `Place`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_dropoffPlaceId_fkey` FOREIGN KEY (`dropoffPlaceId`) REFERENCES `Place`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
