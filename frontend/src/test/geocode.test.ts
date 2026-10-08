import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AddressNotFoundError,
  GeocoderUnavailableError,
  geocodePickupAddress,
  type GeocodeResult,
} from "@/lib/geocode.server";

type Provider = NonNullable<Parameters<typeof geocodePickupAddress>[1]>[number];

function provider(
  name: GeocodeResult["provider"],
  behavior: "hit" | "miss" | "error",
  configured = true,
): Provider {
  return {
    name,
    configured: () => configured,
    lookup: async () => {
      if (behavior === "error") throw new Error(`${name} exploded`);
      if (behavior === "miss") return null;
      return { latitude: 41.58, longitude: -93.63, provider: name };
    },
  };
}

describe("Pickup address geocoding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses header-authenticated Google Geocoding v4 without exposing the server key in the URL", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "server-only-key");
    vi.stubEnv("LOVABLE_API_KEY", "");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              formattedAddress: "400 E Locust St, Des Moines, IA 50309, USA",
              location: { latitude: 41.588, longitude: -93.611 },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await geocodePickupAddress("400 E Locust St, Des Moines, IA");

    expect(result).toMatchObject({
      latitude: 41.588,
      longitude: -93.611,
      provider: "google_direct",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://geocode.googleapis.com/v4/geocode/address/");
    expect(url).not.toContain("server-only-key");
    expect(new Headers(init.headers).get("X-Goog-Api-Key")).toBe("server-only-key");
    expect(init.redirect).toBe("error");
  });

  it("returns the first provider that resolves the address", async () => {
    const result = await geocodePickupAddress("400 E Locust St, Des Moines, IA", [
      provider("google_direct", "hit"),
      provider("us_census", "hit"),
    ]);
    expect(result.provider).toBe("google_direct");
    expect(result.latitude).toBeCloseTo(41.58);
  });

  it("falls through a failing provider to a working one so one outage cannot block a rescue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await geocodePickupAddress("400 E Locust St, Des Moines, IA", [
      provider("google_gateway", "error"),
      provider("us_census", "hit"),
    ]);
    expect(result.provider).toBe("us_census");
  });

  it("skips unconfigured providers without treating them as failures", async () => {
    const result = await geocodePickupAddress("400 E Locust St, Des Moines, IA", [
      provider("google_gateway", "error", false),
      provider("nominatim", "hit"),
    ]);
    expect(result.provider).toBe("nominatim");
  });

  it("blames the address when providers answered but none matched", async () => {
    await expect(
      geocodePickupAddress("zzzz", [provider("us_census", "miss"), provider("nominatim", "miss")]),
    ).rejects.toBeInstanceOf(AddressNotFoundError);
  });

  it("reports an outage when every provider errored, so the donor is told to retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      geocodePickupAddress("400 E Locust St", [
        provider("us_census", "error"),
        provider("nominatim", "error"),
      ]),
    ).rejects.toBeInstanceOf(GeocoderUnavailableError);
  });

  it("rejects an empty address before calling any provider", async () => {
    const spy = vi.fn();
    await expect(
      geocodePickupAddress("   ", [{ name: "us_census", configured: () => true, lookup: spy }]),
    ).rejects.toBeInstanceOf(AddressNotFoundError);
    expect(spy).not.toHaveBeenCalled();
  });
});
