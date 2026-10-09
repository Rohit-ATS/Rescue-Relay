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
  /** The OSM `image` tag, when a mapper supplied one. Most entries have none. */
  photoUrl: string | null;
};

/**
 * Mirrors, tried in order. The main instance answers 429 or 504 often enough that a
 * single endpoint meant the map silently showed no public food banks at all; the
 * mirrors run the same software over the same data.
 */
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
/** Overpass is a shared free service; a slow answer is dropped rather than queued. */
const REQUEST_TIMEOUT_MS = 20000;
/**
 * Statewide reach from the pilot centre: 200 km out of Des Moines covers Sioux City,
 * Waterloo, Davenport and Ottumwa, so the map shows Iowa's mapped food banks rather
 * than only the metro's. Larger `around` radii make Overpass time out, which is why
 * this is not simply set to the state's longest diagonal. Metres, as Overpass expects.
 */
export const DEFAULT_RADIUS_M = 200000;
/** Two facilities mapped this close together with the same name are one facility. */
const DUPLICATE_DISTANCE_DEG = 0.002;

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
 *
 * Two tagging conventions are both in use, and matching only the first one hid most
 * of the pantries in the pilot state:
 *   - `social_facility=food_bank`, the current tag, matched by regex so a facility
 *     carrying a combined value such as "outreach, food_bank" is still found;
 *   - `amenity=food_bank`, the older spelling, still on the map in places.
 */
export function buildQuery(latitude: number, longitude: number, radiusM: number): string {
  const around = `(around:${Math.round(radiusM)},${latitude},${longitude})`;
  return (
    `[out:json][timeout:25];` +
    `(` +
    `nwr["social_facility"~"food_bank"]${around};` +
    `nwr["amenity"="food_bank"]${around};` +
    `);` +
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
  // OSM carries a photo only when a mapper added one, and it may be any scheme;
  // the map popup decides whether the URL is one it will load.
  const photoUrl = element.tags?.["image"]?.trim() || null;

  return {
    id: `${element.type}/${element.id}`,
    name,
    latitude: latitude as number,
    longitude: longitude as number,
    photoUrl,
  };
}

/**
 * Drops the second copy of a facility mapped more than once.
 *
 * Matching on id alone is not enough: the union query reaches the same building as
 * both a node and a way, and those carry different ids. Same name, near-identical
 * position, so one pin.
 */
function dedupe(banks: PublicFoodBank[]): PublicFoodBank[] {
  const kept: PublicFoodBank[] = [];
  const seenIds = new Set<string>();
  for (const bank of banks) {
    if (seenIds.has(bank.id)) continue;
    seenIds.add(bank.id);
    const key = bank.name.toLowerCase();
    const duplicate = kept.some(
      (other) =>
        other.name.toLowerCase() === key &&
        Math.abs(other.latitude - bank.latitude) < DUPLICATE_DISTANCE_DEG &&
        Math.abs(other.longitude - bank.longitude) < DUPLICATE_DISTANCE_DEG,
    );
    if (!duplicate) kept.push(bank);
  }
  return kept;
}

async function askOverpass(
  endpoint: string,
  query: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<OverpassElement[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { elements?: OverpassElement[] };
    return Array.isArray(body?.elements) ? body.elements : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
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
  const query = buildQuery(latitude, longitude, options.radiusM ?? DEFAULT_RADIUS_M);

  for (const endpoint of ENDPOINTS) {
    if (options.signal?.aborted) return [];
    const elements = await askOverpass(endpoint, query, fetchImpl, options.signal);
    if (!elements) continue;

    const banks = elements.map(toFoodBank).filter((f): f is PublicFoodBank => f !== null);
    // An empty answer from a working mirror is an answer: there is nothing there.
    return dedupe(banks);
  }
  return [];
}
