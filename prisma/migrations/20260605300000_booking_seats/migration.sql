-- Phase 3: BookingSeat junction (dual-write with Booking.seats string during cutover).

CREATE TABLE `BookingSeat` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `seatNumber` INTEGER NOT NULL,
    `sharedDepartureSeatId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BookingSeat_bookingId_idx`(`bookingId`),
    INDEX `BookingSeat_sharedDepartureSeatId_idx`(`sharedDepartureSeatId`),
    UNIQUE INDEX `BookingSeat_bookingId_seatNumber_key`(`bookingId`, `seatNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BookingSeat` ADD CONSTRAINT `BookingSeat_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `BookingSeat` ADD CONSTRAINT `BookingSeat_sharedDepartureSeatId_fkey` FOREIGN KEY (`sharedDepartureSeatId`) REFERENCES `SharedDepartureSeat`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
