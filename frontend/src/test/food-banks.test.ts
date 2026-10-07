import { describe, expect, it, vi } from "vitest";

import { buildQuery, fetchPublicFoodBanks } from "@/lib/food-banks";

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

    expect(query).toContain('nwr["social_facility"="food_bank"]');
    expect(query).toContain("(around:80000,37.5485,-121.9886)");
    // Ways and relations have no coordinate without it.
    expect(query).toContain("out center;");
  });

  it("reads nodes by coordinate and ways by centroid", async () => {
    const banks = await fetchPublicFoodBanks(37.5, -122, { fetchImpl: okFetch(RESPONSE) });

    expect(banks).toHaveLength(3);
    expect(banks[0]).toEqual({
      id: "node/4505134119",
      name: "Berkeley Food Pantry",
      latitude: 37.8763732,
      longitude: -122.2832523,
    });
    expect(banks[1]?.latitude).toBe(37.33);
  });

  it("names an untagged facility rather than dropping it, but drops a placeless one", async () => {
    const banks = await fetchPublicFoodBanks(37.5, -122, { fetchImpl: okFetch(RESPONSE) });

    expect(banks.map((b) => b.name)).toContain("Food bank");
    expect(banks.map((b) => b.name)).not.toContain("Nowhere");
  });

  // A judge should see the partners, not an error, if Overpass is busy.
  it("yields nothing rather than throwing when the lookup fails", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;

    await expect(fetchPublicFoodBanks(37.5, -122, { fetchImpl: failing })).resolves.toEqual([]);
  });

  it("does not call Overpass without a usable centre", async () => {
    const spy = okFetch(RESPONSE);

    expect(await fetchPublicFoodBanks(Number.NaN, -122, { fetchImpl: spy })).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
