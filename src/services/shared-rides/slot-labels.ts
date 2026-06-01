import type { SharedRideDirection, SgrTrainService } from "../../domain/shared-rides.js";
import { formatHm } from "../../lib/nairobi-time.js";

const SERVICE_LABEL: Record<SgrTrainService, string> = {
  inter_county: "Inter-County",
  express: "Afternoon Express",
  night: "Night",
};

export function trainServiceLabel(service: SgrTrainService): string {
  return SERVICE_LABEL[service];
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
