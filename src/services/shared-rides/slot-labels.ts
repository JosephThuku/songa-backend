import type { SharedRideDirection, SgrTrainService } from "../../domain/shared-rides.js";
import { formatHm, minutesFromHm } from "../../lib/nairobi-time.js";

const SERVICE_LABEL: Record<SgrTrainService, string> = {
  inter_county: "Inter-County",
  express: "Afternoon Express",
  night: "Night",
};

export function trainServiceLabel(service: SgrTrainService): string {
  return SERVICE_LABEL[service];
}

/** from_sgr: label by local van pickup time (not Nairobi night-train catalog tag). */
export function vanPickupPeriodLabel(vanDepartureTime: string): string {
  const mins = minutesFromHm(vanDepartureTime);
  if (mins < 12 * 60) return "Morning";
  if (mins < 17 * 60) return "Afternoon";
  if (mins < 22 * 60) return "Evening";
  return "Night";
}

export function suggestionTrainLabel(
  direction: SharedRideDirection,
  trainService: SgrTrainService,
  sgrEventTime: string,
  vanDepartureTime: string,
): string {
  const eventTime = formatHm(sgrEventTime);
  if (direction === "from_sgr") {
    return `${vanPickupPeriodLabel(vanDepartureTime)} · arrives Miritini ${eventTime}`;
  }
  return `${trainServiceLabel(trainService)} · departs Miritini ${eventTime}`;
}

export function slotHeadline(
  direction: SharedRideDirection,
  trainService: SgrTrainService,
  sgrEventTime: string,
): string {
  const time = formatHm(sgrEventTime);
  if (direction === "to_sgr") {
    return `Catch the ${time} train to Nairobi`;
  }
  return `Meet the ${time} arrival from Nairobi`;
}

export function slotDetail(
  zoneName: string,
  direction: SharedRideDirection,
  vanDepartureTime: string,
  pricePerSeat: number,
): string {
  const van = formatHm(vanDepartureTime);
  if (direction === "to_sgr") {
    return `Shared van ~${van} from ${zoneName} · KES ${pricePerSeat}/seat · prepay to confirm`;
  }
  return `Van from SGR ~${van} to ${zoneName} · KES ${pricePerSeat}/seat · prepay to confirm`;
}
