import { OnboardingStatus, Prisma, UserRole } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import type {
  AdminBookingQuery,
  AdminDriverQuery,
  AdminPatchUserInput,
  AdminRideQuery,
  AdminUpdateDriverStatusInput,
  AdminUserQuery,
  AdminWalletQuery,
} from "../schemas/admin.schema.js";
import { userPublicSelect } from "./admin-prisma.js";

const DEFAULT_LIMIT = 25;

function pageArgs(input: { page?: number; limit?: number }) {
  const page = input.page ?? 1;
  const limit = input.limit ?? DEFAULT_LIMIT;
  return { skip: (page - 1) * limit, take: limit, page, limit };
}

function pageMeta(total: number, page: number, limit: number) {
  return { total, page, limit, hasMore: page * limit < total };
}

const driverInclude = {
  driverProfile: { include: { vehicle: true } },
  driverLocation: true,
} satisfies Prisma.UserInclude;

const bookingInclude = {
  passenger: { select: userPublicSelect },
  payments: { orderBy: { createdAt: "desc" as const }, take: 3 },
  sharedDeparture: {
    include: {
      pickupLocation: true,
      dropoffLocation: true,
    },
  },
  seatRows: { orderBy: { seatNumber: "asc" as const } },
} satisfies Prisma.BookingInclude;

const rideInclude = {
  passenger: { select: userPublicSelect },
  driver: { select: userPublicSelect },
  booking: { select: { id: true, status: true, product: true, total: true, currency: true } },
  seatRows: { orderBy: { seatNumber: "asc" as const } },
} satisfies Prisma.RideInclude;

function userSearchWhere(query: AdminUserQuery): Prisma.UserWhereInput {
  return {
    ...(query.role ? { role: query.role } : {}),
    ...(query.isBlocked !== undefined ? { isBlocked: query.isBlocked } : {}),
    ...(query.q
      ? {
          OR: [
            { phone: { contains: query.q } },
            { name: { contains: query.q } },
            { email: { contains: query.q } },
          ],
        }
      : {}),
  } as Prisma.UserWhereInput;
}

export async function adminListUsers(query: AdminUserQuery) {
  const { skip, take, page, limit } = pageArgs(query);
  const where = userSearchWhere(query);
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: userPublicSelect,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ]);
  return { users: items, meta: pageMeta(total, page, limit) };
}

export async function adminGetUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      ...userPublicSelect,
      driverProfile: { include: { vehicle: true } },
      driverLocation: true,
      _count: {
        select: {
          passengerRides: true,
          driverRides: true,
          bookings: true,
          walletTransactions: true,
        },
      },
    },
  });
  if (!user) throw new AppError("USER_NOT_FOUND", 404, "User not found.");
  return { user };
}

export async function adminListDrivers(query: AdminDriverQuery) {
  const { skip, take, page, limit } = pageArgs(query);
  const where: Prisma.UserWhereInput = {
    role: UserRole.driver,
    ...(query.onboardingStatus
      ? { driverProfile: { onboardingStatus: query.onboardingStatus } }
      : {}),
    ...(query.q
      ? {
          OR: [
            { phone: { contains: query.q } },
            { name: { contains: query.q } },
            { email: { contains: query.q } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { ...userPublicSelect, ...driverInclude },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ]);
  return { drivers: items, meta: pageMeta(total, page, limit) };
}

export async function adminGetDriver(id: string) {
  const driver = await prisma.user.findFirst({
    where: { id, role: UserRole.driver },
    select: {
      ...userPublicSelect,
      ...driverInclude,
      _count: { select: { driverRides: true, walletTransactions: true } },
    },
  });
  if (!driver) throw new AppError("DRIVER_NOT_FOUND", 404, "Driver not found.");
  return { driver };
}

export async function adminUpdateDriverStatus(
  id: string,
  input: AdminUpdateDriverStatusInput,
) {
  const profile = await prisma.driverProfile.findUnique({ where: { userId: id } });
  if (!profile) throw new AppError("DRIVER_NOT_FOUND", 404, "Driver not found.");

  const updated = await prisma.driverProfile.update({
    where: { userId: id },
    data: {
      onboardingStatus: input.onboardingStatus,
      ...(input.onboardingStatus === OnboardingStatus.approved
        ? {}
        : { isOnline: false, onlineSince: null }),
    },
    include: { user: { select: userPublicSelect }, vehicle: true },
  });
  return { driverProfile: updated };
}

export async function adminListBookings(query: AdminBookingQuery) {
  const { skip, take, page, limit } = pageArgs(query);
  const where: Prisma.BookingWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.product ? { product: query.product } : {}),
    ...(query.passengerId ? { passengerId: query.passengerId } : {}),
    ...(query.sharedDepartureId ? { sharedDepartureId: query.sharedDepartureId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: bookingInclude,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.booking.count({ where }),
  ]);
  return { bookings: items, meta: pageMeta(total, page, limit) };
}

export async function adminGetBooking(id: string) {
  const booking = await prisma.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!booking) throw new AppError("BOOKING_NOT_FOUND", 404, "Booking not found.");
  return { booking };
}

export async function adminListRides(query: AdminRideQuery) {
  const { skip, take, page, limit } = pageArgs(query);
  const where: Prisma.RideWhereInput = {
    ...(query.phase ? { phase: query.phase } : {}),
    ...(query.passengerId ? { passengerId: query.passengerId } : {}),
    ...(query.driverId ? { driverId: query.driverId } : {}),
    ...(query.prepaid !== undefined ? { prepaid: query.prepaid } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.ride.findMany({
      where,
      include: rideInclude,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.ride.count({ where }),
  ]);
  return { rides: items, meta: pageMeta(total, page, limit) };
}

export async function adminGetRide(id: string) {
  const ride = await prisma.ride.findUnique({ where: { id }, include: rideInclude });
  if (!ride) throw new AppError("RIDE_NOT_FOUND", 404, "Ride not found.");
  return { ride };
}

export async function adminListWalletTransactions(query: AdminWalletQuery) {
  const { skip, take, page, limit } = pageArgs(query);
  const where: Prisma.WalletTransactionWhereInput = {
    ...(query.driverId ? { driverId: query.driverId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where,
      include: { driver: { select: userPublicSelect }, ride: { select: { id: true, phase: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.walletTransaction.count({ where }),
  ]);
  return { transactions: items, meta: pageMeta(total, page, limit) };
}

export async function adminListCashouts(query: Omit<AdminWalletQuery, "type">) {
  return adminListWalletTransactions({ ...query, type: "debit" });
}

export async function adminListPassengers(query: AdminUserQuery) {
  return adminListUsers({ ...query, role: "passenger" });
}

export async function adminGetPassenger(id: string) {
  const user = await prisma.user.findFirst({
    where: { id, role: UserRole.passenger },
    select: {
      ...userPublicSelect,
      _count: {
        select: {
          bookings: true,
          passengerRides: true,
          sharedTripRequestReservations: true,
        },
      },
      bookings: {
        orderBy: { createdAt: "desc" },
        take: 15,
        select: {
          id: true,
          status: true,
          product: true,
          total: true,
          currency: true,
          sharedDepartureId: true,
          createdAt: true,
        },
      },
    },
  });
  if (!user) throw new AppError("PASSENGER_NOT_FOUND", 404, "Passenger not found.");
  return { passenger: user };
}

async function revokeAllUserSessions(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function takeDriverOffline(userId: string) {
  await prisma.driverProfile.updateMany({
    where: { userId },
    data: { isOnline: false, onlineSince: null },
  });
}

export async function adminPatchUser(
  actorId: string,
  id: string,
  input: AdminPatchUserInput,
) {
  if (actorId === id && input.isBlocked === true) {
    throw new AppError("FORBIDDEN", 403, "You cannot block your own admin account.");
  }

  const existing = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!existing) throw new AppError("USER_NOT_FOUND", 404, "User not found.");
  if (existing.role === UserRole.admin && input.isBlocked === true) {
    throw new AppError("FORBIDDEN", 403, "Admin accounts cannot be blocked via this endpoint.");
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.isBlocked !== undefined ? { isBlocked: input.isBlocked } : {}),
    } as Prisma.UserUpdateInput,
    select: userPublicSelect,
  });

  if (input.isBlocked === true) {
    await revokeAllUserSessions(id);
    if (existing.role === UserRole.driver) {
      await takeDriverOffline(id);
    }
  }

  return { user };
}

export async function adminDeactivateUser(actorId: string, id: string) {
  return adminPatchUser(actorId, id, { isBlocked: true });
}
