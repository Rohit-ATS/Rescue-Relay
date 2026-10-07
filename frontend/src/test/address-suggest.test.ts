import { describe, expect, it, vi } from "vitest";
import { MIN_QUERY_LENGTH, suggestAddresses } from "@/lib/address-suggest";

function reply(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  } as unknown as Response) as unknown as typeof fetch;
}

const feature = (properties: Record<string, string>) => ({ properties });

const LOCUST = feature({
  housenumber: "400",
  street: "East Locust Street",
  city: "Des Moines",
  state: "Iowa",
  postcode: "50309",
  countrycode: "US",
});
const FRANCE = feature({
  housenumber: "161",
  street: "Route de la Croix",
  city: "Marcenais",
  countrycode: "FR",
});

describe("Address suggestions", () => {
  it("splits a result into a street line and a place line", async () => {
    const [first] = await suggestAddresses("400 e locust", {
      fetchImpl: reply({ features: [LOCUST] }),
    });
    expect(first?.primary).toBe("400 East Locust Street");
    expect(first?.secondary).toBe("Des Moines, Iowa, 50309");
    expect(first?.value).toBe("400 East Locust Street, Des Moines, Iowa, 50309");
  });

  it("leaves out results from other countries", async () => {
    const results = await suggestAddresses("161 mission", {
      fetchImpl: reply({ features: [FRANCE, LOCUST] }),
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.primary).toBe("400 East Locust Street");
  });

  it("falls back to a place name when there is no street", async () => {
    const [first] = await suggestAddresses("riverbend", {
      fetchImpl: reply({
        features: [feature({ name: "Riverbend Food Pantry", city: "Des Moines", state: "Iowa" })],
      }),
    });
    expect(first?.primary).toBe("Riverbend Food Pantry");
  });

  it("collapses buildings that share one street address", async () => {
    const results = await suggestAddresses("400 e locust", {
      fetchImpl: reply({ features: [LOCUST, LOCUST] }),
    });
    expect(results).toHaveLength(1);
  });

  it("does not spend a request on a query too short to be useful", async () => {
    const spy = reply({ features: [LOCUST] });
    expect(await suggestAddresses("40", { fetchImpl: spy })).toEqual([]);
    expect(vi.mocked(spy)).not.toHaveBeenCalled();
    expect(MIN_QUERY_LENGTH).toBeGreaterThan(2);
  });

  it("biases toward the pilot region without restricting to it", async () => {
    const spy = reply({ features: [LOCUST] });
    await suggestAddresses("400 e locust", { fetchImpl: spy });
    const url = String(vi.mocked(spy).mock.calls[0]?.[0]);
    expect(url).toContain("lat=41.5908");
    expect(url).toContain("lon=-93.6208");
  });

  it("uses Photon, because Nominatim's policy forbids type-ahead search", async () => {
    const spy = reply({ features: [LOCUST] });
    await suggestAddresses("400 e locust", { fetchImpl: spy });
    const url = String(vi.mocked(spy).mock.calls[0]?.[0]);
    expect(url).toContain("photon.komoot.io");
    expect(url).not.toContain("nominatim");
  });

  it("yields nothing rather than throwing when the service fails", async () => {
    expect(await suggestAddresses("400 e locust", { fetchImpl: reply({}, false) })).toEqual([]);
    const boom = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    expect(await suggestAddresses("400 e locust", { fetchImpl: boom })).toEqual([]);
  });

  it("tolerates a malformed response", async () => {
    expect(
      await suggestAddresses("400 e locust", { fetchImpl: reply({ unexpected: true }) }),
    ).toEqual([]);
    expect(
      await suggestAddresses("400 e locust", { fetchImpl: reply({ features: [{}, feature({})] }) }),
    ).toEqual([]);
  });
});
