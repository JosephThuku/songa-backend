// Socket.io server. Attached to the HTTP server in src/index.ts. Tests build
// the express app via buildApp() in src/app.ts and never import this module,
// so the socket.io dependency is only loaded in the production runtime.
//
// Wire summary:
//   - Auth: Bearer JWT in handshake.auth.token | Authorization header | query.token.
//     Verified with the same signSessionToken/verifySessionToken pair used by REST,
//     and the matching Session row must still be live (mirrors requireAuth).
//   - Rooms: every authenticated socket joins user:{userId}; drivers also join
//     driver:{userId} so the dispatcher can target offers without leaking to
//     passengers in shared rooms.
//   - Bridge: subscribes once to the in-process ride bus (publishRideChanged /
//     publishRideOffer in src/lib/ride-events.ts) and turns each event into the
//     correct emit on the right room. The SSE fallback in src/routes/rides.ts
//     keeps its own listener — both transports stay live in parallel.
//
// On reconnect: clients MUST resync via GET /api/rides/active. The server
// does NOT replay missed events — see backend-requirements §3.8.

import { RidePhase } from "@prisma/client";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { corsOriginSetting, type Env } from "../config/env.js";
import { hashToken, verifySessionToken } from "./jwt.js";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";
import {
  RideEndedEventSchema,
  RideOfferEventSchema,
  RideUpdatedEventSchema,
  safeValidate,
} from "./realtime-events.js";
import {
  onRideChanged,
  onRideOffer,
  type RideChangedEvent,
  type RideOfferEvent as BusRideOfferEvent,
} from "./ride-events.js";
import { toRideDto } from "./responses.js";

interface SocketUser {
  id: string;
  role: "passenger" | "driver";
  sessionId: string;
}

declare module "socket.io" {
  interface Socket {
    data: { user?: SocketUser };
  }
}

export interface AttachSocketIoOptions {
  server: HttpServer;
  env: Env;
}

const rideInclude = {
  passenger: true,
  driver: { include: { driverProfile: { include: { vehicle: true } } } },
} as const;

function extractTokenFromHandshake(socket: Socket): string | null {
  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  if (auth && typeof auth.token === "string" && auth.token.length > 0) {
    return auth.token;
  }
  const header = socket.handshake.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }
  const queryToken = socket.handshake.query?.token;
  if (typeof queryToken === "string" && queryToken.length > 0) return queryToken;
  if (Array.isArray(queryToken) && typeof queryToken[0] === "string" && queryToken[0].length > 0) {
    return queryToken[0];
  }
  return null;
}

async function authenticateSocket(socket: Socket): Promise<SocketUser | null> {
  const token = extractTokenFromHandshake(socket);
  if (!token) return null;

  let payload;
  try {
    payload = verifySessionToken(token);
  } catch {
    return null;
  }

  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  const role = payload.role;
  if (role !== "passenger" && role !== "driver") return null;

  return { id: String(payload.sub), role, sessionId: session.id };
}

export function attachSocketIo({ server, env }: AttachSocketIoOptions): SocketIOServer {
  const io = new SocketIOServer(server, {
    path: "/socket.io",
    cors: {
      origin: corsOriginSetting(env),
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  io.use(async (socket, next) => {
    try {
      const user = await authenticateSocket(socket);
      if (!user) {
        next(new Error("UNAUTHORIZED"));
        return;
      }
      socket.data.user = user;
      next();
    } catch (err) {
      logger.warn({ err }, "socket.io auth handshake failed");
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    socket.join(`user:${user.id}`);
    if (user.role === "driver") socket.join(`driver:${user.id}`);

    logger.info(
      { socketId: socket.id, userId: user.id, role: user.role },
      "socket.io client connected",
    );

    socket.on("disconnect", (reason) => {
      logger.debug(
        { socketId: socket.id, userId: user.id, reason },
        "socket.io client disconnected",
      );
    });
  });

  const isProduction = env.NODE_ENV === "production";

  const unsubscribeRideChanged = onRideChanged((event: RideChangedEvent) => {
    void emitRideUpdated(io, event, isProduction);
  });

  const unsubscribeRideOffer = onRideOffer((event: BusRideOfferEvent) => {
    try {
      const payload = safeValidate(
        RideOfferEventSchema,
        { type: "ride.offer", offer: event.offer },
        { event: "ride.offer", isProduction },
      );
      io.to(`user:${event.driverId}`).emit("ride.offer", payload);
    } catch (err) {
      logger.error({ err, driverId: event.driverId }, "failed to emit ride.offer over socket.io");
    }
  });

  const wrappedClose = io.close.bind(io);
  io.close = (cb?: (err?: Error) => void) => {
    try {
      unsubscribeRideChanged();
      unsubscribeRideOffer();
    } catch (err) {
      logger.warn({ err }, "failed to detach ride-event listeners during socket.io close");
    }
    return wrappedClose(cb);
  };

  return io;
}

async function emitRideUpdated(
  io: SocketIOServer,
  event: RideChangedEvent,
  isProduction: boolean,
): Promise<void> {
  try {
    const ride = await prisma.ride.findUnique({
      where: { id: event.rideId },
      include: rideInclude,
    });
    if (!ride) return;

    const passengerDto = toRideDto(ride, { id: ride.passengerId, role: "passenger" });
    const passengerPayload = safeValidate(
      RideUpdatedEventSchema,
      { type: "ride.updated", ride: passengerDto },
      { event: "ride.updated", isProduction },
    );
    io.to(`user:${ride.passengerId}`).emit("ride.updated", passengerPayload);

    if (ride.driverId) {
      const driverDto = toRideDto(ride, { id: ride.driverId, role: "driver" });
      const driverPayload = safeValidate(
        RideUpdatedEventSchema,
        { type: "ride.updated", ride: driverDto },
        { event: "ride.updated", isProduction },
      );
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
  } catch (err) {
    logger.error(
      { err, rideId: event.rideId, phase: event.phase },
      "failed to emit ride.updated over socket.io",
    );
  }
}
