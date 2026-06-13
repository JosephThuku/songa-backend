-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `role` ENUM('passenger', 'driver', 'admin') NOT NULL,
    `name` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NULL,
    `phoneVerified` BOOLEAN NOT NULL DEFAULT false,
    `avatarUrl` VARCHAR(191) NULL,
    `rating` DOUBLE NOT NULL DEFAULT 5.0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `User_phone_idx`(`phone`),
    UNIQUE INDEX `User_phone_role_key`(`phone`, `role`),
    UNIQUE INDEX `User_email_role_key`(`email`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DriverProfile` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `isOnline` BOOLEAN NOT NULL DEFAULT false,
    `acceptanceRate` INTEGER NOT NULL DEFAULT 100,
    `onboardingStatus` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'approved',
    `vehicleId` VARCHAR(191) NULL,
    `location` JSON NULL,
    `locationUpdatedAt` DATETIME(3) NULL,
    `onlineSince` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DriverProfile_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Vehicle` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `make` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `registration` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL,
    `year` VARCHAR(191) NULL,
    `seats` INTEGER NOT NULL DEFAULT 4,
    `seatLayout` JSON NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Activated',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Vehicle_registration_key`(`registration`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ride` (
    `id` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NULL,
    `vehicleType` VARCHAR(191) NULL,
    `passengerId` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NULL,
    `phase` ENUM('finding_driver', 'driver_accepted', 'driver_en_route', 'driver_arriving', 'driver_arrived', 'trip_in_progress', 'trip_ended', 'cancelled') NOT NULL DEFAULT 'finding_driver',
    `bookingMode` ENUM('seat_selection', 'pay_on_arrival') NOT NULL,
    `prepaid` BOOLEAN NOT NULL DEFAULT false,
    `bookingId` VARCHAR(191) NULL,
    `paymentMethod` VARCHAR(191) NULL,
    `price` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'KES',
    `etaMinutes` INTEGER NULL,
    `distanceKm` DOUBLE NULL,
    `driverProgress` DOUBLE NOT NULL DEFAULT 0,
    `passengerBoarded` BOOLEAN NOT NULL DEFAULT false,
    `seats` VARCHAR(191) NULL,
    `pickup` JSON NOT NULL,
    `dropoff` JSON NOT NULL,
    `driverLocation` JSON NULL,
    `cancelReason` JSON NULL,
    `cancelledByRole` ENUM('passenger', 'driver', 'system') NULL,
    `passengerDriverRating` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `declinedBy` VARCHAR(4096) NOT NULL DEFAULT '[]',

    INDEX `Ride_passengerId_phase_idx`(`passengerId`, `phase`),
    INDEX `Ride_bookingId_idx`(`bookingId`),
    INDEX `Ride_driverId_phase_idx`(`driverId`, `phase`),
    INDEX `Ride_phase_createdAt_idx`(`phase`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RideEvent` (
    `id` VARCHAR(191) NOT NULL,
    `rideId` VARCHAR(191) NOT NULL,
    `actor` ENUM('passenger', 'driver', 'system') NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `phase` ENUM('finding_driver', 'driver_accepted', 'driver_en_route', 'driver_arriving', 'driver_arrived', 'trip_in_progress', 'trip_ended', 'cancelled') NOT NULL,
    `metadata` JSON NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RideEvent_rideId_at_idx`(`rideId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Booking` (
    `id` VARCHAR(191) NOT NULL,
    `passengerId` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NULL,
    `product` ENUM('on_demand', 'shared_sgr') NOT NULL DEFAULT 'on_demand',
    `sharedDepartureId` VARCHAR(191) NULL,
    `status` ENUM('pending_payment', 'paid', 'failed', 'cancelled') NOT NULL DEFAULT 'pending_payment',
    `seats` VARCHAR(191) NULL,
    `subtotal` INTEGER NOT NULL,
    `platformFee` INTEGER NOT NULL DEFAULT 50,
    `total` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'KES',
    `pickup` JSON NOT NULL,
    `dropoff` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Booking_passengerId_status_idx`(`passengerId`, `status`),
    INDEX `Booking_sharedDepartureId_idx`(`sharedDepartureId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `status` ENUM('pending', 'succeeded', 'failed') NOT NULL DEFAULT 'pending',
    `checkoutUrl` VARCHAR(191) NULL,
    `reference` VARCHAR(191) NOT NULL,
    `mpesaCheckoutRequestId` VARCHAR(191) NULL,
    `transactionRef` VARCHAR(191) NULL,
    `gatewayResponse` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Payment_reference_key`(`reference`),
    UNIQUE INDEX `Payment_mpesaCheckoutRequestId_key`(`mpesaCheckoutRequestId`),
    UNIQUE INDEX `Payment_transactionRef_key`(`transactionRef`),
    INDEX `Payment_bookingId_createdAt_idx`(`bookingId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WalletTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NOT NULL,
    `rideId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'KES',
    `status` VARCHAR(191) NOT NULL DEFAULT 'posted',
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WalletTransaction_driverId_createdAt_idx`(`driverId`, `createdAt`),
    INDEX `WalletTransaction_rideId_idx`(`rideId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `deepLink` VARCHAR(191) NULL,
    `read` BOOLEAN NOT NULL DEFAULT false,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Device` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `pushToken` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Device_pushToken_key`(`pushToken`),
    INDEX `Device_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtpAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `success` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OtpAttempt_phone_createdAt_idx`(`phone`, `createdAt`),
    INDEX `OtpAttempt_ip_createdAt_idx`(`ip`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `userAgent` VARCHAR(191) NULL,
    `ip` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Session_tokenHash_key`(`tokenHash`),
    INDEX `Session_userId_idx`(`userId`),
    INDEX `Session_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SavedPlace` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `kind` ENUM('home', 'work', 'other') NOT NULL DEFAULT 'other',
    `placeId` VARCHAR(191) NULL,
    `lat` DOUBLE NOT NULL,
    `lng` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SavedPlace_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentMethodPreference` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `mpesaPhone` VARCHAR(191) NULL,
    `cardLast4` VARCHAR(191) NULL,
    `cardBrand` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PaymentMethodPreference_userId_idx`(`userId`),
    UNIQUE INDEX `PaymentMethodPreference_userId_type_key`(`userId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CorridorLocation` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `lat` DOUBLE NULL,
    `lng` DOUBLE NULL,
    `radiusM` INTEGER NOT NULL DEFAULT 2500,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CorridorLocation_slug_key`(`slug`),
    UNIQUE INDEX `CorridorLocation_name_key`(`name`),
    INDEX `CorridorLocation_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SgrScheduleSlot` (
    `id` VARCHAR(191) NOT NULL,
    `pickupLocationId` VARCHAR(191) NOT NULL,
    `dropoffLocationId` VARCHAR(191) NOT NULL,
    `direction` ENUM('to_sgr', 'from_sgr') NOT NULL,
    `trainService` ENUM('inter_county', 'express', 'night') NOT NULL,
    `sgrEventTime` VARCHAR(5) NOT NULL,
    `vanDepartureTime` VARCHAR(5) NOT NULL,
    `suggestedPricePerSeat` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SgrScheduleSlot_pickupLocationId_dropoffLocationId_direction_idx`(`pickupLocationId`, `dropoffLocationId`, `direction`, `isActive`),
    UNIQUE INDEX `SgrScheduleSlot_pickupLocationId_dropoffLocationId_trainServ_key`(`pickupLocationId`, `dropoffLocationId`, `trainService`, `direction`, `sgrEventTime`, `vanDepartureTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SharedTripRequest` (
    `id` VARCHAR(191) NOT NULL,
    `sgrScheduleSlotId` VARCHAR(191) NOT NULL,
    `corridorLocationId` VARCHAR(191) NOT NULL,
    `direction` ENUM('to_sgr', 'from_sgr') NOT NULL,
    `requestedDepartureAt` DATETIME(3) NOT NULL,
    `departureDate` VARCHAR(10) NOT NULL,
    `seatsRequested` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('open', 'matched', 'cancelled', 'expired') NOT NULL DEFAULT 'open',
    `matchedDepartureId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SharedTripRequest_sgrScheduleSlotId_requestedDepartureAt_sta_idx`(`sgrScheduleSlotId`, `requestedDepartureAt`, `status`),
    INDEX `SharedTripRequest_corridorLocationId_direction_status_idx`(`corridorLocationId`, `direction`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SharedTripRequestReservation` (
    `id` VARCHAR(191) NOT NULL,
    `tripRequestId` VARCHAR(191) NOT NULL,
    `passengerId` VARCHAR(191) NOT NULL,
    `seatsRequested` INTEGER NOT NULL,
    `status` ENUM('active', 'cancelled') NOT NULL DEFAULT 'active',
    `pickupNote` VARCHAR(200) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SharedTripRequestReservation_passengerId_status_idx`(`passengerId`, `status`),
    UNIQUE INDEX `SharedTripRequestReservation_tripRequestId_passengerId_key`(`tripRequestId`, `passengerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SharedDeparture` (
    `id` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NULL,
    `vehicleId` VARCHAR(191) NULL,
    `pickupLocationId` VARCHAR(191) NOT NULL,
    `dropoffLocationId` VARCHAR(191) NOT NULL,
    `sgrScheduleSlotId` VARCHAR(191) NULL,
    `departureAt` DATETIME(3) NOT NULL,
    `pricePerSeat` INTEGER NOT NULL,
    `capacity` INTEGER NOT NULL DEFAULT 14,
    `status` ENUM('scheduled', 'boarding', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
    `driverLat` DOUBLE NULL,
    `driverLng` DOUBLE NULL,
    `driverLocationUpdatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SharedDeparture_status_departureAt_idx`(`status`, `departureAt`),
    INDEX `SharedDeparture_pickupLocationId_dropoffLocationId_departure_idx`(`pickupLocationId`, `dropoffLocationId`, `departureAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SharedDepartureSeat` (
    `id` VARCHAR(191) NOT NULL,
    `departureId` VARCHAR(191) NOT NULL,
    `seatNumber` INTEGER NOT NULL,
    `seatLabel` VARCHAR(191) NOT NULL DEFAULT '',
    `row` INTEGER NULL,
    `col` INTEGER NULL,
    `status` ENUM('available', 'reserved', 'paid', 'disabled') NOT NULL DEFAULT 'available',
    `reservedById` VARCHAR(191) NULL,
    `reservedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `bookingId` VARCHAR(191) NULL,
    `pickupLabel` VARCHAR(200) NULL,
    `pickupLat` DOUBLE NULL,
    `pickupLng` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SharedDepartureSeat_departureId_status_idx`(`departureId`, `status`),
    INDEX `SharedDepartureSeat_bookingId_idx`(`bookingId`),
    UNIQUE INDEX `SharedDepartureSeat_departureId_seatNumber_key`(`departureId`, `seatNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DriverProfile` ADD CONSTRAINT `DriverProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DriverProfile` ADD CONSTRAINT `DriverProfile_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ride` ADD CONSTRAINT `Ride_passengerId_fkey` FOREIGN KEY (`passengerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ride` ADD CONSTRAINT `Ride_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ride` ADD CONSTRAINT `Ride_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RideEvent` ADD CONSTRAINT `RideEvent_rideId_fkey` FOREIGN KEY (`rideId`) REFERENCES `Ride`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RideEvent` ADD CONSTRAINT `RideEvent_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_passengerId_fkey` FOREIGN KEY (`passengerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_sharedDepartureId_fkey` FOREIGN KEY (`sharedDepartureId`) REFERENCES `SharedDeparture`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WalletTransaction` ADD CONSTRAINT `WalletTransaction_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WalletTransaction` ADD CONSTRAINT `WalletTransaction_rideId_fkey` FOREIGN KEY (`rideId`) REFERENCES `Ride`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Device` ADD CONSTRAINT `Device_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SavedPlace` ADD CONSTRAINT `SavedPlace_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentMethodPreference` ADD CONSTRAINT `PaymentMethodPreference_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SgrScheduleSlot` ADD CONSTRAINT `SgrScheduleSlot_pickupLocationId_fkey` FOREIGN KEY (`pickupLocationId`) REFERENCES `CorridorLocation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SgrScheduleSlot` ADD CONSTRAINT `SgrScheduleSlot_dropoffLocationId_fkey` FOREIGN KEY (`dropoffLocationId`) REFERENCES `CorridorLocation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedTripRequest` ADD CONSTRAINT `SharedTripRequest_sgrScheduleSlotId_fkey` FOREIGN KEY (`sgrScheduleSlotId`) REFERENCES `SgrScheduleSlot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedTripRequest` ADD CONSTRAINT `SharedTripRequest_corridorLocationId_fkey` FOREIGN KEY (`corridorLocationId`) REFERENCES `CorridorLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedTripRequest` ADD CONSTRAINT `SharedTripRequest_matchedDepartureId_fkey` FOREIGN KEY (`matchedDepartureId`) REFERENCES `SharedDeparture`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedTripRequestReservation` ADD CONSTRAINT `SharedTripRequestReservation_tripRequestId_fkey` FOREIGN KEY (`tripRequestId`) REFERENCES `SharedTripRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedTripRequestReservation` ADD CONSTRAINT `SharedTripRequestReservation_passengerId_fkey` FOREIGN KEY (`passengerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedDeparture` ADD CONSTRAINT `SharedDeparture_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedDeparture` ADD CONSTRAINT `SharedDeparture_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedDeparture` ADD CONSTRAINT `SharedDeparture_pickupLocationId_fkey` FOREIGN KEY (`pickupLocationId`) REFERENCES `CorridorLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedDeparture` ADD CONSTRAINT `SharedDeparture_dropoffLocationId_fkey` FOREIGN KEY (`dropoffLocationId`) REFERENCES `CorridorLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedDeparture` ADD CONSTRAINT `SharedDeparture_sgrScheduleSlotId_fkey` FOREIGN KEY (`sgrScheduleSlotId`) REFERENCES `SgrScheduleSlot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedDepartureSeat` ADD CONSTRAINT `SharedDepartureSeat_departureId_fkey` FOREIGN KEY (`departureId`) REFERENCES `SharedDeparture`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedDepartureSeat` ADD CONSTRAINT `SharedDepartureSeat_reservedById_fkey` FOREIGN KEY (`reservedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedDepartureSeat` ADD CONSTRAINT `SharedDepartureSeat_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
