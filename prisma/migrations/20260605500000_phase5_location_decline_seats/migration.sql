-- Phase 5: RideDriverDecline, DriverLocation (single writer), RideSeat junction; drop declinedBy.

CREATE TABLE `RideDriverDecline` (
    `id` VARCHAR(191) NOT NULL,
    `rideId` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NOT NULL,
    `declinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RideDriverDecline_rideId_idx`(`rideId`),
    INDEX `RideDriverDecline_driverId_idx`(`driverId`),
    UNIQUE INDEX `RideDriverDecline_rideId_driverId_key`(`rideId`, `driverId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DriverLocation` (
    `driverId` VARCHAR(191) NOT NULL,
    `lat` DOUBLE NOT NULL,
    `lng` DOUBLE NOT NULL,
    `heading` DOUBLE NULL,
    `speedKmh` DOUBLE NULL,
    `accuracyM` DOUBLE NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DriverLocation_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`driverId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RideSeat` (
    `id` VARCHAR(191) NOT NULL,
    `rideId` VARCHAR(191) NOT NULL,
    `seatNumber` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RideSeat_rideId_idx`(`rideId`),
    UNIQUE INDEX `RideSeat_rideId_seatNumber_key`(`rideId`, `seatNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RideDriverDecline` ADD CONSTRAINT `RideDriverDecline_rideId_fkey` FOREIGN KEY (`rideId`) REFERENCES `Ride`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RideDriverDecline` ADD CONSTRAINT `RideDriverDecline_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DriverLocation` ADD CONSTRAINT `DriverLocation_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RideSeat` ADD CONSTRAINT `RideSeat_rideId_fkey` FOREIGN KEY (`rideId`) REFERENCES `Ride`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Ride` DROP COLUMN `declinedBy`;
