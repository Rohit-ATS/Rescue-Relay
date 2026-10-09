import { describe, expect, it, vi } from "vitest";

import { DEFAULT_RADIUS_M, buildQuery, fetchPublicFoodBanks } from "@/lib/food-banks";

/** Shaped from a real Overpass answer around Fremont, CA. */
const RESPONSE = {
  elements: [
    {
      type: "node",
      id: 4505134119,
      lat: 37.8763732,
      lon: -122.2832523,
      tags: { name: "Berkeley Food Pantry" },
    },
    // A building outline: no lat/lon of its own, only the centroid from `out center`.
    {
      type: "way",
      id: 221,
      center: { lat: 37.33, lon: -121.91 },
      tags: { name: "The Jerry Larson FOODBasket" },
    },
    // Real facility, but nothing to label it with.
    { type: "node", id: 333, lat: 37.4, lon: -121.85, tags: {} },
    // Unplaceable, so unusable as a marker.
    { type: "node", id: 444, tags: { name: "Nowhere" } },
  ],
};

const okFetch = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => body }) as unknown as typeof fetch;

describe("Public food banks", () => {
  it("asks Overpass for food banks of every element type around the point", () => {
    const query = buildQuery(37.5485, -121.9886, 80000);

    expect(query).toContain('nwr["social_facility"~"food_bank"]');
    expect(query).toContain("(around:80000,37.5485,-121.9886)");
    // Ways and relations have no coordinate without it.
    expect(query).toContain("out center;");
  });

  // Most of the pilot state's pantries carry the older tag or a combined value, and
  // an exact match on the current one found four of them in all of central Iowa.
  it("matches the older amenity tag and combined social_facility values", async () => {
    const query = buildQuery(41.5908, -93.6208, 200000);

    expect(query).toContain('nwr["amenity"="food_bank"]');
    expect(new RegExp('"social_facility"~"food_bank"').test(query)).toBe(true);

    const combined = {
      elements: [
        {
          type: "node",
          id: 14179673521,
          lat: 41.26,
          lon: -95.94,
          tags: { name: "Together Omaha", social_facility: "outreach, food_bank" },
        },
      ],
    };
    const banks = await fetchPublicFoodBanks(41.5908, -93.6208, {
      fetchImpl: okFetch(combined),
    });

    expect(banks.map((b) => b.name)).toEqual(["Together Omaha"]);
  });

  // Most OSM entries have no photo, but the few that do should reach the popup.
  it("carries the OSM image tag when a mapper supplied one", async () => {
    const withImage = {
      elements: [
        {
          type: "node",
          id: 7,
          lat: 41.6,
          lon: -93.6,
          tags: { name: "Northside Pantry", image: "https://example.org/pantry.jpg" },
        },
      ],
    };

    const banks = await fetchPublicFoodBanks(41.5908, -93.6208, { fetchImpl: okFetch(withImage) });

    expect(banks[0]?.photoUrl).toBe("https://example.org/pantry.jpg");
  });

  it("reaches far enough to cover the pilot state, not just the metro", () => {
    expect(DEFAULT_RADIUS_M).toBeGreaterThanOrEqual(200000);
  });

  // The union query reaches the same building as both a node and a way, which carry
  // different ids, so id alone cannot catch the second copy.
  it("shows one pin for a facility mapped as both a point and a building", async () => {
    const twice = {
      elements: [
        { type: "node", id: 1, lat: 41.6, lon: -93.6, tags: { name: "Northside Pantry" } },
        {
          type: "way",
          id: 2,
          center: { lat: 41.6001, lon: -93.6002 },
          tags: { name: "Northside Pantry" },
        },
        { type: "node", id: 3, lat: 41.9, lon: -93.1, tags: { name: "Northside Pantry" } },
      ],
    };

    const banks = await fetchPublicFoodBanks(41.5908, -93.6208, { fetchImpl: okFetch(twice) });

    // The far-away namesake is a different facility and stays.
    expect(banks.map((b) => b.id)).toEqual(["node/1", "node/3"]);
  });

  // One instance answering 429 used to mean the map showed no public food banks.
  it("falls through to a mirror when the first endpoint refuses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => RESPONSE }) as unknown as typeof fetch;

    const banks = await fetchPublicFoodBanks(37.5, -122, { fetchImpl });

    expect(banks).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [first, second] = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls;
    expect(first?.[0]).not.toBe(second?.[0]);
  });

  it("reads nodes by coordinate and ways by centroid", async () => {
    const banks = await fetchPublicFoodBanks(37.5, -122, { fetchImpl: okFetch(RESPONSE) });

    expect(banks).toHaveLength(3);
    expect(banks[0]).toEqual({
      id: "node/4505134119",
      name: "Berkeley Food Pantry",
      latitude: 37.8763732,
      longitude: -122.2832523,
      photoUrl: null,
    });
    expect(banks[1]?.latitude).toBe(37.33);
  });

  it("names an untagged facility rather than dropping it, but drops a placeless one", async () => {
    const banks = await fetchPublicFoodBanks(37.5, -122, { fetchImpl: okFetch(RESPONSE) });

    expect(banks.map((b) => b.name)).toContain("Food bank");
    expect(banks.map((b) => b.name)).not.toContain("Nowhere");
  });

  // A judge should see the partners, not an error, if Overpass is busy.
  it("yields nothing rather than throwing when every lookup fails", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;

    await expect(fetchPublicFoodBanks(37.5, -122, { fetchImpl: failing })).resolves.toEqual([]);
  });

  it("accepts an empty answer from a working mirror instead of asking the next one", async () => {
    const empty = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [] }),
    }) as unknown as typeof fetch;

    expect(await fetchPublicFoodBanks(37.5, -122, { fetchImpl: empty })).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);
  });

  it("does not call Overpass without a usable centre", async () => {
    const spy = okFetch(RESPONSE);

    expect(await fetchPublicFoodBanks(Number.NaN, -122, { fetchImpl: spy })).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
