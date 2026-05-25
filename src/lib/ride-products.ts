export interface RideProduct {
  optionId: string;
  vehicleType: string;
  label: string;
  capacity: number;
  priceMultiplier: number;
}

export const RIDE_PRODUCTS: RideProduct[] = [
  { optionId: "car", vehicleType: "Car", label: "Car", capacity: 4, priceMultiplier: 1 },
  { optionId: "van", vehicleType: "Van", label: "Van", capacity: 7, priceMultiplier: 1.3 },
  { optionId: "minibus", vehicleType: "Minibus", label: "Minibus", capacity: 14, priceMultiplier: 1.5 },
  { optionId: "bus", vehicleType: "Bus", label: "Bus", capacity: 33, priceMultiplier: 1.6 },
];

export function getRideProduct(optionId: string): RideProduct | undefined {
  return RIDE_PRODUCTS.find((p) => p.optionId === optionId);
}
