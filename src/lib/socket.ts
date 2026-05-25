import type { Server as HttpServer } from "node:http";
import { RidePhase } from "@prisma/client";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis as IORedis } from "ioredis";
import { Server, type Socket } from "socket.io";
import type { Env } from "../config/env.js";
import { corsOriginSetting } from "../config/env.js";
import { logger } from "./logger.js";
import { hashToken, verifySessionToken } from "./jwt.js";
import { prisma } from "./prisma.js";
import { onRideChanged, onRideOffer } from "./ride-events.js";
import {
  RideCancelledEventSchema,
  RideEndedEventSchema,
  RideOfferEventSchema,
  RideUpdatedEventSchema,
} from "./realtime-events.js";
import { toRideDto, type RideDtoInput } from "./responses.js";

const rideInclude = {
  passenger: true,
  driver: { include: { driverProfile: { include: { vehicle: true } } } },
} as const;

function safeValidate<T>(
  schema: { parse: (value: unknown) => T },
  value: unknown,
  context: { event: string; isProduction: boolean },
): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (context.isProduction) {
      logger.warn({ err, event: context.event }, "realtime payload validation failed");
      return value as T;
    }
    throw err;
  }
}

async function authenticateSocket(socket: Socket): Promise<{ id: string; role: "passenger" | "driver" } | null> {
  const token =
    (typeof socket.handshake.auth?.token === "string" && socket.handshake.auth.token) ||
    (typeof socket.handshake.headers.authorization === "string" &&
    socket.handshake.headers.authorization.startsWith("Bearer ")
      ? socket.handshake.headers.authorization.slice("Bearer ".length).trim()
      : null);
  if (!token) return null;

  try {
    const payload = verifySessionToken(token);
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
    if (payload.role !== "passenger" && payload.role !== "driver") return null;
    return { id: String(payload.sub), role: payload.role };
  } catch {
    return null;
  }
}

export function attachSocketIo(input: { server: HttpServer; env: Env }): Server {
  const isProduction = input.env.NODE_ENV === "production";
  const io = new Server(input.server, {
    path: "/socket.io",
    cors: { origin: corsOriginSetting(input.env), credentials: true },
  });

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const pubClient = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const subClient = pubClient.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
  }

  io.use(async (socket, next) => {
    const user = await authenticateSocket(socket);
    if (!user) {
      next(new Error("UNAUTHORIZED"));
      return;
    }
    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as { id: string; role: "passenger" | "driver" };
    void socket.join(`user:${user.id}`);
    logger.debug({ userId: user.id, role: user.role }, "socket connected");
  });

  onRideChanged((event) => {
    void (async () => {
      const ride = await prisma.ride.findUnique({
        where: { id: event.rideId },
        include: rideInclude,
      });
      if (!ride) return;

      const payloadFor = async (userId: string, role: "passenger" | "driver") => {
        const dto = toRideDto(ride as RideDtoInput, { id: userId, role });
        return safeValidate(
          RideUpdatedEventSchema,
          { type: "ride.updated", ride: dto },
          { event: "ride.updated", isProduction },
        );
      };

      const passengerPayload = await payloadFor(ride.passengerId, "passenger");
      io.to(`user:${ride.passengerId}`).emit("ride.updated", passengerPayload);

      if (ride.driverId) {
        const driverPayload = await payloadFor(ride.driverId, "driver");
        io.to(`user:${ride.driverId}`).emit("ride.updated", driverPayload);
      }

      if (event.phase === RidePhase.trip_ended) {
        const ended = safeValidate(
          RideEndedEventSchema,
          { type: "ride.ended", rideId: event.rideId, phase: event.phase },
          { event: "ride.ended", isProduction },
        );
        io.to(`user:${ride.passengerId}`).emit("ride.ended", ended);
        if (ride.driverId) io.to(`user:${ride.driverId}`).emit("ride.ended", ended);
      }

      if (event.phase === RidePhase.cancelled) {
        const cancelled = safeValidate(
          RideCancelledEventSchema,
          { type: "ride.cancelled", rideId: event.rideId, phase: "cancelled" },
          { event: "ride.cancelled", isProduction },
        );
        io.to(`user:${ride.passengerId}`).emit("ride.cancelled", cancelled);
        if (ride.driverId) io.to(`user:${ride.driverId}`).emit("ride.cancelled", cancelled);
      }
    })().catch((err) => logger.error({ err, rideId: event.rideId }, "socket ride.changed failed"));
  });

  onRideOffer((event) => {
    const offer = safeValidate(
      RideOfferEventSchema,
      { type: "ride.offer", offer: event.offer },
      { event: "ride.offer", isProduction },
    );
    io.to(`user:${event.driverId}`).emit("ride.offer", offer);
  });

  return io;
}
