-- Phase 4: Drop derivable SharedTripRequest columns (direction, departureDate, corridorLocationId).

DROP INDEX `SharedTripRequest_corridorLocationId_direction_status_idx` ON `SharedTripRequest`;

ALTER TABLE `SharedTripRequest` DROP FOREIGN KEY `SharedTripRequest_corridorLocationId_fkey`;

ALTER TABLE `SharedTripRequest` DROP COLUMN `corridorLocationId`,
    DROP COLUMN `direction`,
    DROP COLUMN `departureDate`;
