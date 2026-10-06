/** Shared geographic helpers. Pure, so both the matcher and the driver views agree on distance. */

export type Coords = { latitude: number; longitude: number };

const EARTH_RADIUS_MILES = 3958.7613;

/** Streets are never straight; this scales great-circle distance toward realistic road mileage. */
export const ROAD_DETOUR_FACTOR = 1.25;
/** Average door-to-door speed for an urban volunteer run, including lights and parking. */
export const URBAN_AVERAGE_MPH = 24;
/** Fixed minutes a handoff costs at each end, on top of driving. */
export const HANDOFF_MINUTES = 10;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in miles.
 *
 * Replaces flat `hypot(dLat, dLng) * 52`, which treats a degree of longitude as a
 * degree of latitude. At the Des Moines pilot's latitude a degree of longitude is
 * about 25% shorter, so the flat form overstated east-west distance and skewed matches.
 */
export function distanceMiles(a: Coords, b: Coords): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rough road mileage, used only where a routing service is unavailable. */
export function estimatedRoadMiles(a: Coords, b: Coords): number {
  return distanceMiles(a, b) * ROAD_DETOUR_FACTOR;
}

/** Rough round-trip minutes for a volunteer run, including both handoffs. */
export function estimatedDriveMinutes(a: Coords, b: Coords): number {
  const miles = estimatedRoadMiles(a, b);
  return Math.round((miles / URBAN_AVERAGE_MPH) * 60 + HANDOFF_MINUTES);
}

/** Valid, and not the 0,0 placeholder that an unset coordinate column reads as. */
export function hasPosition(value: Partial<Coords> | null | undefined): value is Coords {
  if (!value) return false;
  const { latitude, longitude } = value;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (Math.abs(latitude as number) > 90 || Math.abs(longitude as number) > 180) return false;
  return !(latitude === 0 && longitude === 0);
}

/**
 * A turn-by-turn link that works with no API key, on any device.
 *
 * The in-app map needs a Maps key and a network round trip; this always works, so
 * a driver can start navigating even when the embedded map cannot load.
 */
export function directionsUrl(origin: Coords, destination: Coords, via?: Coords): string {
  const point = (c: Coords) => `${c.latitude},${c.longitude}`;
  const params = new URLSearchParams({
    api: "1",
    origin: point(origin),
    destination: point(destination),
    travelmode: "driving",
  });
  if (via) params.set("waypoints", point(via));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Apple Maps equivalent, for drivers on iOS who do not have Google Maps installed. */
export function appleDirectionsUrl(origin: Coords, destination: Coords): string {
  return `https://maps.apple.com/?saddr=${origin.latitude},${origin.longitude}&daddr=${destination.latitude},${destination.longitude}&dirflg=d`;
}

export function formatMiles(miles: number): string {
  if (miles < 0.1) return "under 0.1 mi";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}
