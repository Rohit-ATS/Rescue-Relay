/**
 * Road routing for the dispatch map.
 *
 * A straight line between pickup and drop-off misstates both the distance and the
 * drive, and reads as a guess. OSRM's public endpoint returns real road geometry and
 * turn-by-turn manoeuvres with no API key, which keeps the map working on any
 * deployment with no credentials — the same principle the geocoding chain follows.
 *
 * It is also the fallback behind Google Directions: a browser Maps key without the
 * Directions API enabled leaves the driver with no route at all otherwise.
 */
import { estimatedDriveMinutes, estimatedRoadMiles, type Coords } from "@/lib/geo";

/** [lat, lng] coordinate pairs. */
export type RoutePath = Array<[number, number]>;

/** One manoeuvre, phrased for a driver reading the panel rather than the map. */
export type RouteStep = {
  instruction: string;
  distanceMiles: number;
};

export type DrivingRoute = {
  path: RoutePath;
  distanceMiles: number;
  durationMinutes: number;
  /** False when the service was unreachable and this is the straight-line fallback. */
  followsRoads: boolean;
  /** Empty when the route is the straight-line fallback: there is nothing to follow. */
  steps: RouteStep[];
};

const OSRM_ENDPOINT = "https://router.project-osrm.org/route/v1/driving";
const REQUEST_TIMEOUT_MS = 8000;
const METRES_PER_MILE = 1609.344;

/** The straight line, used when routing is unavailable so the map still shows the pair. */
function fallbackRoute(origin: Coords, destination: Coords, via: Coords[] = []): DrivingRoute {
  const stops = [origin, ...via, destination];
  return {
    path: stops.map((stop) => [stop.latitude, stop.longitude] as [number, number]),
    distanceMiles: stops
      .slice(1)
      .reduce((total, stop, index) => total + estimatedRoadMiles(stops[index] as Coords, stop), 0),
    durationMinutes: stops
      .slice(1)
      .reduce(
        (total, stop, index) => total + estimatedDriveMinutes(stops[index] as Coords, stop),
        0,
      ),
    followsRoads: false,
    steps: [],
  };
}

type OsrmStep = {
  distance?: number;
  name?: string;
  maneuver?: { type?: string; modifier?: string };
};

const MODIFIERS: Record<string, string> = {
  left: "left",
  right: "right",
  "slight left": "slightly left",
  "slight right": "slightly right",
  "sharp left": "sharp left",
  "sharp right": "sharp right",
  straight: "straight ahead",
  uturn: "around",
};

/**
 * Turns an OSRM manoeuvre into a sentence.
 *
 * OSRM reports a type and a modifier, not prose — unlike Google, which ships the
 * instruction text. Phrasing it here keeps both sources reading the same way in the
 * panel, so a driver cannot tell which one drew the route.
 */
export function describeStep(step: OsrmStep): string {
  const type = step.maneuver?.type ?? "";
  const modifier = step.maneuver?.modifier ?? "";
  const turn = MODIFIERS[modifier] ?? modifier;
  const road = step.name?.trim();
  const onto = road ? ` onto ${road}` : "";
  const along = road ? ` on ${road}` : "";

  switch (type) {
    case "depart":
      return `Start the drive${along}`;
    case "arrive":
      return "Arrive at the stop";
    case "turn":
    case "end of road":
      return turn ? `Turn ${turn}${onto}` : `Continue${onto}`;
    case "new name":
    case "continue":
      return `Continue${onto}`;
    case "merge":
      return `Merge${turn ? ` ${turn}` : ""}${onto}`;
    case "on ramp":
      return `Take the ramp${turn ? ` ${turn}` : ""}${onto}`;
    case "off ramp":
      return `Take the exit${turn ? ` ${turn}` : ""}${onto}`;
    case "fork":
      return `Keep ${turn || "ahead"} at the fork${onto}`;
    case "roundabout":
    case "rotary":
      return `Take the roundabout${onto}`;
    case "roundabout turn":
      return `At the roundabout, go ${turn || "ahead"}${onto}`;
    default:
      return road ? `Continue on ${road}` : "Continue";
  }
}

/**
 * Resolves the driving route between two points, optionally through stops on the way.
 *
 * Never rejects: a routing outage degrades to the straight line and the local estimate
 * rather than leaving a driver with no route at all.
 */
export async function fetchDrivingRoute(
  origin: Coords,
  destination: Coords,
  fetchImpl: typeof fetch = fetch,
  options: { waypoints?: Coords[] } = {},
): Promise<DrivingRoute> {
  const via = options.waypoints ?? [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // OSRM takes lon,lat — the reverse of how the rest of this codebase carries points.
    const path = [origin, ...via, destination]
      .map((stop) => `${stop.longitude},${stop.latitude}`)
      .join(";");
    const response = await fetchImpl(
      `${OSRM_ENDPOINT}/${path}?overview=full&geometries=geojson&steps=true`,
      { signal: controller.signal },
    );
    if (!response.ok) return fallbackRoute(origin, destination, via);

    const body = (await response.json()) as {
      code?: string;
      routes?: Array<{
        distance?: number;
        duration?: number;
        geometry?: { coordinates?: Array<[number, number]> };
        legs?: Array<{ steps?: OsrmStep[] }>;
      }>;
    };
    const route = body.routes?.[0];
    const coordinates = route?.geometry?.coordinates;
    if (body.code !== "Ok" || !route || !coordinates?.length)
      return fallbackRoute(origin, destination, via);

    const points = coordinates
      .filter((pair) => Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
      .map(([lon, lat]) => [lat, lon] as [number, number]);
    if (points.length < 2) return fallbackRoute(origin, destination, via);

    // Legs are concatenated: a driver reads one list from their position to the
    // drop-off, with the pickup appearing in it as an ordinary stop.
    const steps = (route.legs ?? []).flatMap((leg) =>
      (leg.steps ?? []).map((step) => ({
        instruction: describeStep(step),
        distanceMiles: (step.distance ?? 0) / METRES_PER_MILE,
      })),
    );

    return {
      path: points,
      distanceMiles: (route.distance ?? 0) / METRES_PER_MILE,
      durationMinutes: Math.round((route.duration ?? 0) / 60),
      followsRoads: true,
      steps,
    };
  } catch {
    // Aborted, offline, or malformed: the straight line is still better than nothing.
    return fallbackRoute(origin, destination, via);
  } finally {
    clearTimeout(timer);
  }
}
