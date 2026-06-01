// NEW — shape helpers: toUserDto / toMeDto matching backend-requirements.md §2.3 / §2.4.

import type { DriverProfile, Ride, User, Vehicle } from "@prisma/client";

export interface DriverProfileDto {
  isOnline: boolean;
  acceptanceRate: number;
  vehicleId: string | null;
  onboardingStatus: "pending" | "approved" | "rejected";
  lastLocation?: {
    lat: number;
    lng: number;
    heading?: number;
    speedKmh?: number;
    updatedAt: string;
  } | null;
  vehicle?: VehicleEmbedDto | null;
}

export interface UserDto {
  id: string;
  role: "passenger" | "driver" | "admin";
  name: string | null;
  phone: string;
  email: string | null;
  avatarUrl: string | null;
  rating: number;
  createdAt: string;
  driverProfile?: DriverProfileDto;
}

export function toDriverProfileDto(
  profile: DriverProfile & { vehicle?: Vehicle | null },
): DriverProfileDto {
  const location =
    typeof profile.location === "object" && profile.location !== null
      ? (profile.location as Record<string, unknown>)
      : null;
  const lastLocation =
    location && typeof location.lat === "number" && typeof location.lng === "number"
      ? {
          lat: location.lat,
          lng: location.lng,
          ...(typeof location.heading === "number" ? { heading: location.heading } : {}),
          ...(typeof location.speedKmh === "number" ? { speedKmh: location.speedKmh } : {}),
          updatedAt:
            typeof location.updatedAt === "string"
              ? location.updatedAt
              : profile.locationUpdatedAt?.toISOString() ?? profile.updatedAt.toISOString(),
        }
      : null;

  return {
    isOnline: profile.isOnline,
    acceptanceRate: profile.acceptanceRate,
    vehicleId: profile.vehicleId ?? null,
    onboardingStatus: profile.onboardingStatus,
    lastLocation,
    vehicle: toVehicleEmbedDto(profile.vehicle ?? null),
  };
}

export function toUserDto(
  user: User,
  driverProfile?: (DriverProfile & { vehicle?: Vehicle | null }) | null,
): UserDto {
  const dto: UserDto = {
    id: user.id,
    role: user.role,
    name: user.name ?? null,
    phone: user.phone,
    email: user.email ?? null,
    avatarUrl: user.avatarUrl ?? null,
    rating: user.rating,
    createdAt: user.createdAt.toISOString(),
  };
  if (driverProfile) {
    dto.driverProfile = toDriverProfileDto(driverProfile);
  }
  return dto;
}

export interface PlaceDto {
  placeId?: string;
  label: string;
  lat: number;
  lng: number;
}

export interface VehicleEmbedDto {
  id: string;
  type: string;
  make: string;
  model: string;
  registration: string;
  color: string;
  year: string | null;
  seats: number;
  status: string;
}

export interface DriverEmbedDto {
  id: string;
  name: string | null;
  phone: string | null;
  avatarUrl: string | null;
  rating: number;
}

export interface PassengerEmbedDto {
  id: string;
  name: string | null;
  phone: string | null;
  avatarUrl: string | null;
  rating: number;
}

export interface RideDto {
  id: string;
  tripId: string | null;
  vehicleType: string | null;
  passengerId: string;
  driverId: string | null;
  phase: Ride["phase"];
  bookingMode: Ride["bookingMode"];
  prepaid: boolean;
  bookingId: string | null;
  paymentMethod: string | null;
  price: number;
  currency: string;
  etaMinutes: number | null;
  distanceKm: number | null;
  driverProgress: number;
  passengerBoarded: boolean;
  seats: number[] | null;
  pickup: PlaceDto;
  dropoff: PlaceDto;
  driverLocation: unknown;
  cancelReason: unknown;
  cancelledByRole: Ride["cancelledByRole"] | null;
  passengerDriverRating: number | null;
  createdAt: string;
  updatedAt: string;
  passenger: PassengerEmbedDto;
  driver: DriverEmbedDto | null;
  vehicle: VehicleEmbedDto | null;
}

export interface RideDtoInput extends Ride {
  passenger: User;
  driver?: (User & { driverProfile?: (DriverProfile & { vehicle?: Vehicle | null }) | null }) | null;
}

function toPlaceDto(value: unknown): PlaceDto {
  const object = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    ...(typeof object.placeId === "string" ? { placeId: object.placeId } : {}),
    label: typeof object.label === "string" ? object.label : "",
    lat: typeof object.lat === "number" ? object.lat : 0,
    lng: typeof object.lng === "number" ? object.lng : 0,
  };
}

function seatsToArray(value: string | null): number[] | null {
  if (!value) return null;
  const seats = value
    .split(",")
    .map((seat) => Number.parseInt(seat, 10))
    .filter((seat) => Number.isInteger(seat));
  return seats.length > 0 ? seats : null;
}

export function toVehicleEmbedDto(vehicle: Vehicle | null | undefined): VehicleEmbedDto | null {
  if (!vehicle) return null;
  return {
    id: vehicle.id,
    type: vehicle.type,
    make: vehicle.make,
    model: vehicle.model,
    registration: vehicle.registration,
    color: vehicle.color,
    year: vehicle.year ?? null,
    seats: vehicle.seats,
    status: vehicle.status,
  };
}

export function toDriverEmbedDto(
  driver: User | null | undefined,
  includePhone: boolean,
): DriverEmbedDto | null {
  if (!driver) return null;
  return {
    id: driver.id,
    name: driver.name ?? null,
    phone: includePhone ? driver.phone : null,
    avatarUrl: driver.avatarUrl ?? null,
    rating: driver.rating,
  };
}

export function toPassengerEmbedDto(passenger: User, includePhone: boolean): PassengerEmbedDto {
  return {
    id: passenger.id,
    name: passenger.name ?? null,
    phone: includePhone ? passenger.phone : null,
    avatarUrl: passenger.avatarUrl ?? null,
    rating: passenger.rating,
  };
}

function resolveDriverLocationForDto(ride: RideDtoInput): unknown {
  const onRide =
    typeof ride.driverLocation === "object" && ride.driverLocation !== null
      ? (ride.driverLocation as Record<string, unknown>)
      : null;
  if (onRide && typeof onRide.lat === "number" && typeof onRide.lng === "number") {
    return ride.driverLocation;
  }

  if (!ride.driverId) return ride.driverLocation ?? null;

  const profileLoc = ride.driver?.driverProfile?.location;
  if (
    typeof profileLoc === "object" &&
    profileLoc !== null &&
    typeof (profileLoc as Record<string, unknown>).lat === "number" &&
    typeof (profileLoc as Record<string, unknown>).lng === "number"
  ) {
    return profileLoc;
  }

  return ride.driverLocation ?? null;
}

export function toRideDto(
  ride: RideDtoInput,
  viewer?: { id: string; role: "passenger" | "driver" | "admin" },
): RideDto {
  const driverProfile = ride.driver?.driverProfile ?? null;
  const vehicle = driverProfile?.vehicle ?? null;
  const showPassengerPhone =
    Boolean(viewer) &&
    viewer?.role === "driver" &&
    viewer.id === ride.driverId &&
    ride.phase !== "finding_driver" &&
    ride.phase !== "cancelled";

  return {
    id: ride.id,
    tripId: ride.tripId ?? null,
    vehicleType: ride.vehicleType ?? null,
    passengerId: ride.passengerId,
    driverId: ride.driverId ?? null,
    phase: ride.phase,
    bookingMode: ride.bookingMode,
    prepaid: ride.prepaid,
    bookingId: ride.bookingId ?? null,
    paymentMethod: ride.paymentMethod ?? null,
    price: ride.price,
    currency: ride.currency,
    etaMinutes: ride.etaMinutes ?? null,
    distanceKm: ride.distanceKm ?? null,
    driverProgress: ride.driverProgress,
    passengerBoarded: ride.passengerBoarded,
    seats: seatsToArray(ride.seats),
    pickup: toPlaceDto(ride.pickup),
    dropoff: toPlaceDto(ride.dropoff),
    driverLocation: resolveDriverLocationForDto(ride),
    cancelReason: ride.cancelReason ?? null,
    cancelledByRole: ride.cancelledByRole ?? null,
    passengerDriverRating: ride.passengerDriverRating ?? null,
    createdAt: ride.createdAt.toISOString(),
    updatedAt: ride.updatedAt.toISOString(),
    passenger: toPassengerEmbedDto(ride.passenger, showPassengerPhone),
    driver: toDriverEmbedDto(ride.driver ?? null, false),
    vehicle: toVehicleEmbedDto(vehicle),
  };
}
