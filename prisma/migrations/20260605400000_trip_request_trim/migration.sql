-- Phase 4: Drop derivable SharedTripRequest columns (direction, departureDate, corridorLocationId).
-- MySQL: drop the FK before the index — the index is required by the FK constraint.

ALTER TABLE `SharedTripRequest` DROP FOREIGN KEY `SharedTripRequest_corridorLocationId_fkey`;

DROP INDEX `SharedTripRequest_corridorLocationId_direction_status_idx` ON `SharedTripRequest`;

ALTER TABLE `SharedTripRequest` DROP COLUMN `corridorLocationId`,
    DROP COLUMN `direction`,
    DROP COLUMN `departureDate`;
