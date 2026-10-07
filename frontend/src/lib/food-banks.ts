/**
 * Real food bank locations from OpenStreetMap, via the Overpass API.
 *
 * Overpass needs no key and no account, which is why it is used here rather than
 * Google Places: the Google key this project needs is for *drawing* the map, and
 * paying per request to find the same public facilities would be the wrong trade.
 *
 * These are public facilities, not verified partners. They are never mixed into the
 * partner directory and never become match candidates — they are context on the map,
 * showing where food could go beyond the organizations already signed up.
 */

export type PublicFoodBank = {
  /** OSM type and id, e.g. "node/1234" — stable, and unique across element types. */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

const ENDPOINT = "https://overpass-api.de/api/interpreter";
/** Overpass is a shared free service; a slow answer is dropped rather than queued. */
const REQUEST_TIMEOUT_MS = 20000;
/** Matches the pilot's working radius. Metres, as Overpass expects. */
export const DEFAULT_RADIUS_M = 80000;

type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  /** Ways and relations carry their centroid here, from `out center`. */
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

/**
 * `nwr` covers nodes, ways and relations, because a food bank may be mapped as a
 * point, a building outline or a multipolygon. `out center` collapses the latter two
 * to a single coordinate, which is all a marker needs.
 */
export function buildQuery(latitude: number, longitude: number, radiusM: number): string {
  return (
    `[out:json][timeout:25];` +
    `nwr["social_facility"="food_bank"](around:${Math.round(radiusM)},${latitude},${longitude});` +
    `out center;`
  );
}

function toFoodBank(element: OverpassElement): PublicFoodBank | null {
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (!element.type || element.id === undefined) return null;

  // Unnamed entries are real facilities but useless as a map label, so they are
  // given the generic name rather than dropped.
  const name = element.tags?.["name"]?.trim() || "Food bank";

  return {
    id: `${element.type}/${element.id}`,
    name,
    latitude: latitude as number,
    longitude: longitude as number,
  };
}

/**
 * Finds public food banks around a point.
 *
 * Never rejects: a failure yields an empty list, so the map simply shows the
 * partners it already had rather than erroring in front of a judge.
 */
export async function fetchPublicFoodBanks(
  latitude: number,
  longitude: number,
  options: { radiusM?: number; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<PublicFoodBank[]> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  options.signal?.addEventListener("abort", () => controller.abort());

  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(buildQuery(latitude, longitude, options.radiusM ?? DEFAULT_RADIUS_M))}`,
    });
    if (!response.ok) return [];

    const body = (await response.json()) as { elements?: OverpassElement[] };
    if (!Array.isArray(body?.elements)) return [];

    const seen = new Set<string>();
    return body.elements
      .map(toFoodBank)
      .filter((f): f is PublicFoodBank => f !== null)
      .filter((f) => {
        // A facility mapped as both a node and a building appears twice.
        if (seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
