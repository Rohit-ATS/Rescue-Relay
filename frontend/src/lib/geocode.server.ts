// Server-only pickup-address geocoding. Never import at the top level of a route
// or *.functions.ts module: load it inside a server handler with
// `const { geocodePickupAddress } = await import("@/lib/geocode.server");`

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  /** Which provider answered, recorded on the rescue event so coordinators can audit placement. */
  provider: "google_gateway" | "google_direct" | "us_census" | "nominatim";
  /** The provider's normalized address, when it returns one. */
  formattedAddress?: string;
};

/** Thrown when the address itself is unusable, so the donor is asked to correct it. */
export class AddressNotFoundError extends Error {}
/** Thrown when every provider failed for reasons unrelated to the address. */
export class GeocoderUnavailableError extends Error {}

type Provider = {
  name: GeocodeResult["provider"];
  /** Skipped without comment when false, so unconfigured providers are not failures. */
  configured: () => boolean;
  lookup: (address: string) => Promise<GeocodeResult | null>;
};

const REQUEST_TIMEOUT_MS = 8000;
/** Nominatim's usage policy asks for an identifying agent and at most one call a second. */
const NOMINATIM_AGENT =
  "RescueRelay/1.0 (urgent surplus-food dispatch; https://github.com/Phat-Le/Rescue-Relay)";
const NOMINATIM_MIN_GAP_MS = 1100;

/** Des Moines pilot bounds; a hit outside them is treated as a mismatch, not a location. */
const PILOT_VIEWBOX = { west: -96.7, south: 40.2, east: -90.0, north: 43.6 };

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: init?.redirect ?? "error",
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { ok: response.ok, status: response.status, body, text };
  } finally {
    clearTimeout(timer);
  }
}

function finite(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** Google returns REQUEST_DENIED for key problems and ZERO_RESULTS for bad addresses; only the latter is the donor's fault. */
function readGooglePayload(
  body: unknown,
  text: string,
  provider: GeocodeResult["provider"],
): GeocodeResult | null {
  const payload = body as
    | {
        status?: string;
        error_message?: string;
        results?: Array<{
          formatted_address?: string;
          geometry?: { location?: { lat?: number; lng?: number } };
        }>;
      }
    | undefined;
  if (!payload?.status) throw new Error(`${provider}: unreadable response ${text.slice(0, 200)}`);
  if (payload.status === "ZERO_RESULTS") return null;
  if (payload.status !== "OK")
    throw new Error(
      `${provider}: ${payload.status}${payload.error_message ? ` — ${payload.error_message}` : ""}`,
    );
  const location = payload.results?.[0]?.geometry?.location;
  const latitude = finite(location?.lat);
  const longitude = finite(location?.lng);
  if (latitude === undefined || longitude === undefined) return null;
  const formatted = payload.results?.[0]?.formatted_address;
  return { latitude, longitude, provider, ...(formatted ? { formattedAddress: formatted } : {}) };
}

function readGoogleV4Payload(body: unknown, text: string): GeocodeResult | null {
  const payload = body as
    | {
        results?: Array<{
          formattedAddress?: string;
          location?: { latitude?: number; longitude?: number };
        }>;
      }
    | undefined;
  const result = payload?.results?.[0];
  if (!result) {
    if (payload?.results) return null;
    throw new Error(`google_direct: unreadable response ${text.slice(0, 200)}`);
  }
  const latitude = finite(result.location?.latitude);
  const longitude = finite(result.location?.longitude);
  if (latitude === undefined || longitude === undefined) return null;
  return {
    latitude,
    longitude,
    provider: "google_direct",
    ...(result.formattedAddress ? { formattedAddress: result.formattedAddress } : {}),
  };
}

const googleGateway: Provider = {
  name: "google_gateway",
  configured: () => Boolean(process.env["LOVABLE_API_KEY"] && process.env["GOOGLE_MAPS_API_KEY"]),
  lookup: async (address) => {
    const { ok, status, body, text } = await fetchJson(
      `https://connector-gateway.lovable.dev/google_maps/maps/api/geocode/json?address=${encodeURIComponent(address)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
          "X-Connection-Api-Key": process.env["GOOGLE_MAPS_API_KEY"] as string,
        },
      },
    );
    if (!ok) {
      if (status === 403 && text.includes("API_KEY_HTTP_REFERRER_BLOCKED"))
        throw new Error("google_gateway: server key needs None or IP application restrictions.");
      if (status === 403 && text.includes("API_KEY_SERVICE_BLOCKED"))
        throw new Error("google_gateway: enable the Geocoding API for this key.");
      throw new Error(`google_gateway: HTTP ${status}`);
    }
    return readGooglePayload(body, text, "google_gateway");
  },
};

const googleDirect: Provider = {
  name: "google_direct",
  // Google Geocoding v4 accepts the server key in a header, so it never enters
  // a request URL that may be retained by an egress log.
  configured: () => Boolean(process.env["GOOGLE_MAPS_API_KEY"] && !process.env["LOVABLE_API_KEY"]),
  lookup: async (address) => {
    const { ok, status, body, text } = await fetchJson(
      `https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(address)}`,
      {
        headers: {
          "X-Goog-Api-Key": process.env["GOOGLE_MAPS_API_KEY"] as string,
          "X-Goog-FieldMask": "results.location,results.formattedAddress",
        },
      },
    );
    if (!ok) throw new Error(`google_direct: HTTP ${status}`);
    return readGoogleV4Payload(body, text);
  },
};

/** Keyless and public domain, but US addresses only — so it runs before Nominatim for the pilot. */
const usCensus: Provider = {
  name: "us_census",
  configured: () => true,
  lookup: async (address) => {
    const { ok, status, body } = await fetchJson(
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(address)}`,
    );
    if (!ok) throw new Error(`us_census: HTTP ${status}`);
    const match = (
      body as
        | {
            result?: {
              addressMatches?: Array<{
                matchedAddress?: string;
                coordinates?: { x?: number; y?: number };
              }>;
            };
          }
        | undefined
    )?.result?.addressMatches?.[0];
    if (!match) return null;
    const longitude = finite(match.coordinates?.x);
    const latitude = finite(match.coordinates?.y);
    if (latitude === undefined || longitude === undefined) return null;
    return {
      latitude,
      longitude,
      provider: "us_census",
      ...(match.matchedAddress ? { formattedAddress: match.matchedAddress } : {}),
    };
  },
};

let nominatimGate: Promise<unknown> = Promise.resolve();
/** Serializes calls one per NOMINATIM_MIN_GAP_MS so the shared public instance is not abused. */
function throttleNominatim<T>(task: () => Promise<T>): Promise<T> {
  const run = nominatimGate.then(task);
  nominatimGate = run.then(
    () => new Promise((resolve) => setTimeout(resolve, NOMINATIM_MIN_GAP_MS)),
    () => new Promise((resolve) => setTimeout(resolve, NOMINATIM_MIN_GAP_MS)),
  );
  return run;
}

const nominatim: Provider = {
  name: "nominatim",
  configured: () => true,
  lookup: (address) =>
    throttleNominatim(async () => {
      const viewbox = `${PILOT_VIEWBOX.west},${PILOT_VIEWBOX.south},${PILOT_VIEWBOX.east},${PILOT_VIEWBOX.north}`;
      const { ok, status, body } = await fetchJson(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&viewbox=${viewbox}&q=${encodeURIComponent(address)}`,
        { headers: { "User-Agent": NOMINATIM_AGENT, Accept: "application/json" } },
      );
      if (!ok) throw new Error(`nominatim: HTTP ${status}`);
      const hit = (
        body as Array<{ lat?: string; lon?: string; display_name?: string }> | undefined
      )?.[0];
      if (!hit) return null;
      const latitude = finite(hit.lat);
      const longitude = finite(hit.lon);
      if (latitude === undefined || longitude === undefined) return null;
      return {
        latitude,
        longitude,
        provider: "nominatim",
        ...(hit.display_name ? { formattedAddress: hit.display_name } : {}),
      };
    }),
};

/** Preferred first: a configured Google key is more precise than the keyless pair. */
export const GEOCODE_PROVIDERS: Provider[] = [googleGateway, googleDirect, usCensus, nominatim];

/**
 * Resolves a pickup address to coordinates, trying each configured provider in turn.
 *
 * A provider that cannot match the address yields to the next one; a provider that
 * errors is recorded and the chain continues, so one outage never blocks a rescue.
 * Throws AddressNotFoundError when providers ran but none matched, and
 * GeocoderUnavailableError when every provider errored.
 */
export async function geocodePickupAddress(
  address: string,
  providers: Provider[] = GEOCODE_PROVIDERS,
): Promise<GeocodeResult> {
  const trimmed = address.trim();
  if (!trimmed) throw new AddressNotFoundError("Enter a pickup address.");

  const failures: string[] = [];
  let anyProviderAnswered = false;

  for (const provider of providers) {
    if (!provider.configured()) continue;
    try {
      const result = await provider.lookup(trimmed);
      anyProviderAnswered = true;
      if (result) return result;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length)
    console.error(
      `[geocode] provider failures for ${JSON.stringify(trimmed)}: ${failures.join(" | ")}`,
    );

  if (anyProviderAnswered) {
    throw new AddressNotFoundError(
      "Pickup address could not be located. Enter a complete street address with city and state.",
    );
  }
  throw new GeocoderUnavailableError(
    "Address lookup is temporarily unavailable. Please try again in a moment.",
  );
}
