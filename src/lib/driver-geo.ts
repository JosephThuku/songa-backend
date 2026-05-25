import { getRedis, IoredisClient, MemoryClient } from "./redis.js";

const GEO_KEY = "drivers:geo";

type GeoRedis = {
  geoadd?: (key: string, lng: number, lat: number, member: string) => Promise<number>;
  zrem?: (key: string, member: string) => Promise<number>;
  georadius?: (key: string, lng: number, lat: number, radiusKm: number) => Promise<string[]>;
};

function geoRedis(): GeoRedis | null {
  const redis = getRedis();
  if (redis instanceof MemoryClient || redis instanceof IoredisClient) {
    return redis;
  }
  return null;
}

export async function indexDriverLocation(driverId: string, lng: number, lat: number): Promise<void> {
  const redis = geoRedis();
  if (redis?.geoadd) await redis.geoadd(GEO_KEY, lng, lat, driverId);
}

export async function removeDriverFromGeoIndex(driverId: string): Promise<void> {
  const redis = geoRedis();
  if (redis?.zrem) await redis.zrem(GEO_KEY, driverId);
}

export async function findDriverIdsNear(lng: number, lat: number, radiusKm: number): Promise<string[]> {
  const redis = geoRedis();
  if (!redis?.georadius) return [];
  return redis.georadius(GEO_KEY, lng, lat, radiusKm);
}
