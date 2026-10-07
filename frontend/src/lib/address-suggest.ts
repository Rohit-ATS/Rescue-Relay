/**
 * Type-ahead address suggestions for the pickup field.
 *
 * Uses Photon, which is built for autocomplete, needs no API key, and is served by
 * Komoot over OpenStreetMap data — so suggestions work on any deployment, the same
 * reason the geocoding chain and the map tiles are keyless.
 *
 * Deliberately NOT Nominatim: its usage policy forbids type-ahead search outright,
 * even though it answers one-off geocoding well (which is what geocode.server.ts uses
 * it for, with a throttle and an identifying agent).
 *
 * Suggestions are a convenience only. The server geocodes whatever text is submitted,
 * so a suggestion is never trusted as the authoritative location.
 */

export type AddressSuggestion = {
  /** What goes into the field when chosen. */
  value: string;
  /** The leading, most specific part — house number and street. */
  primary: string;
  /** The rest — city, state, postcode. */
  secondary: string;
};

const ENDPOINT = "https://photon.komoot.io/api/";
const REQUEST_TIMEOUT_MS = 6000;
/** Central Iowa pilot, used to rank nearby results first rather than to exclude others. */
const BIAS = { lat: 41.5908, lon: -93.6208 };
/** Below this, a query is too vague to spend a request on. */
export const MIN_QUERY_LENGTH = 4;

type PhotonFeature = {
  properties?: {
    housenumber?: string;
    street?: string;
    name?: string;
    city?: string;
    district?: string;
    state?: string;
    postcode?: string;
    country?: string;
    countrycode?: string;
  };
};

function toSuggestion(feature: PhotonFeature): AddressSuggestion | null {
  const p = feature.properties;
  if (!p) return null;

  // Photon names a building separately from its street; prefer the street for an address.
  const streetLine = [p.housenumber, p.street ?? p.name].filter(Boolean).join(" ").trim();
  if (!streetLine) return null;

  const placeLine = [p.city ?? p.district, p.state, p.postcode].filter(Boolean).join(", ");

  return {
    value: [streetLine, placeLine].filter(Boolean).join(", "),
    primary: streetLine,
    secondary: placeLine,
  };
}

/**
 * Suggests addresses for a partial query.
 *
 * Never rejects: a lookup failure yields no suggestions, leaving the donor to type the
 * address out, which already works.
 */
export async function suggestAddresses(
  query: string,
  options: { signal?: AbortSignal; limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  options.signal?.addEventListener("abort", () => controller.abort());

  try {
    const url =
      `${ENDPOINT}?q=${encodeURIComponent(trimmed)}` +
      `&limit=${options.limit ?? 6}&lang=en&lat=${BIAS.lat}&lon=${BIAS.lon}`;
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];

    const body = (await response.json()) as { features?: PhotonFeature[] };
    const features = body?.features;
    if (!Array.isArray(features)) return [];

    const seen = new Set<string>();
    return (
      features
        // The pilot is US-only, and a street in France is never the right suggestion here.
        .filter((f) => !f.properties?.countrycode || f.properties.countrycode === "US")
        .map(toSuggestion)
        .filter((s): s is AddressSuggestion => s !== null)
        // Several buildings can share one street address; one entry is enough.
        .filter((s) => {
          if (seen.has(s.value)) return false;
          seen.add(s.value);
          return true;
        })
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
