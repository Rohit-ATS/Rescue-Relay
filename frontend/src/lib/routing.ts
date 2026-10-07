/**
 * Road routing for the dispatch map.
 *
 * A straight line between pickup and drop-off misstates both the distance and the
 * drive, and reads as a guess. OSRM's public endpoint returns real road geometry with
 * no API key, which keeps the map working on any deployment with no credentials — the
 * same principle the geocoding chain follows.
 */
import { estimatedDriveMinutes, estimatedRoadMiles, type Coords } from "@/lib/geo";

/** [lat, lng] pairs, the order Leaflet expects. */
export type RoutePath = Array<[number, number]>;

export type DrivingRoute = {
  path: RoutePath;
  distanceMiles: number;
  durationMinutes: number;
  /** False when the service was unreachable and this is the straight-line fallback. */
  followsRoads: boolean;
};

const OSRM_ENDPOINT = "https://router.project-osrm.org/route/v1/driving";
const REQUEST_TIMEOUT_MS = 8000;
const METRES_PER_MILE = 1609.344;

/** The straight line, used when routing is unavailable so the map still shows the pair. */
function fallbackRoute(origin: Coords, destination: Coords): DrivingRoute {
  return {
    path: [
      [origin.latitude, origin.longitude],
      [destination.latitude, destination.longitude],
    ],
    distanceMiles: estimatedRoadMiles(origin, destination),
    durationMinutes: estimatedDriveMinutes(origin, destination),
    followsRoads: false,
  };
}

/**
 * Resolves the driving route between two points.
 *
 * Never rejects: a routing outage degrades to the straight line and the local estimate
 * rather than leaving a driver with no route at all.
 */
export async function fetchDrivingRoute(
  origin: Coords,
  destination: Coords,
  fetchImpl: typeof fetch = fetch,
): Promise<DrivingRoute> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // OSRM takes lon,lat — the reverse of how the rest of this codebase carries points.
    const path = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
    const response = await fetchImpl(`${OSRM_ENDPOINT}/${path}?overview=full&geometries=geojson`, {
      signal: controller.signal,
    });
    if (!response.ok) return fallbackRoute(origin, destination);

    const body = (await response.json()) as {
      code?: string;
      routes?: Array<{
        distance?: number;
        duration?: number;
        geometry?: { coordinates?: Array<[number, number]> };
      }>;
    };
    const route = body.routes?.[0];
    const coordinates = route?.geometry?.coordinates;
    if (body.code !== "Ok" || !route || !coordinates?.length)
      return fallbackRoute(origin, destination);

    const points = coordinates
      .filter((pair) => Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
      .map(([lon, lat]) => [lat, lon] as [number, number]);
    if (points.length < 2) return fallbackRoute(origin, destination);

    return {
      path: points,
      distanceMiles: (route.distance ?? 0) / METRES_PER_MILE,
      durationMinutes: Math.round((route.duration ?? 0) / 60),
      followsRoads: true,
    };
  } catch {
    // Aborted, offline, or malformed: the straight line is still better than nothing.
    return fallbackRoute(origin, destination);
  } finally {
    clearTimeout(timer);
  }
}
