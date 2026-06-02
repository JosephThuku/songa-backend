import { logger } from "./logger.js";
import { releaseAllExpiredSeatHolds } from "../services/shared-rides/expired-seat-holds.service.js";

const SWEEP_INTERVAL_MS = 5 * 60_000;

/** In-process sweep (production should also run `npm run shared-rides:release-expired-holds` on a schedule). */
export function startExpiredSeatHoldSweep(): () => void {
  const tick = () => {
    releaseAllExpiredSeatHolds()
      .then(({ released }) => {
        if (released > 0) {
          logger.info({ released }, "shared-rides: released expired seat holds");
        }
      })
      .catch((err) => {
        logger.warn({ err }, "shared-rides: expired seat hold sweep failed");
      });
  };

  tick();
  const handle = setInterval(tick, SWEEP_INTERVAL_MS);
  handle.unref?.();

  return () => clearInterval(handle);
}
