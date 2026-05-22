// NEW — shape helpers: toUserDto / toMeDto matching backend-requirements.md §2.3 / §2.4.

import type { DriverProfile, User } from "@prisma/client";

export interface DriverProfileDto {
  isOnline: boolean;
  acceptanceRate: number;
  vehicleId: string | null;
  onboardingStatus: "pending" | "approved" | "rejected";
}

export interface UserDto {
  id: string;
  role: "passenger" | "driver";
  name: string | null;
  phone: string;
  email: string | null;
  avatarUrl: string | null;
  rating: number;
  createdAt: string;
  driverProfile?: DriverProfileDto;
}

export function toDriverProfileDto(profile: DriverProfile): DriverProfileDto {
  return {
    isOnline: profile.isOnline,
    acceptanceRate: profile.acceptanceRate,
    vehicleId: profile.vehicleId ?? null,
    onboardingStatus: profile.onboardingStatus,
  };
}

export function toUserDto(user: User, driverProfile?: DriverProfile | null): UserDto {
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
