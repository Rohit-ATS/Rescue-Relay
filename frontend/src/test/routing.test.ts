import { describe, expect, it, vi } from "vitest";
import { fetchDrivingRoute } from "@/lib/routing";

const PICKUP = { latitude: 41.5847, longitude: -93.6308 };
const BANK = { latitude: 41.5264, longitude: -93.6175 };

function osrmResponse(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  } as unknown as Response) as unknown as typeof fetch;
}

const GOOD = {
  code: "Ok",
  routes: [
    {
      distance: 7532,
      duration: 530,
      geometry: {
        coordinates: [
          [-93.630764, 41.584605],
          [-93.630481, 41.584667],
          [-93.6175, 41.526349],
        ],
      },
    },
  ],
};

describe("Driving route", () => {
  it("returns the road geometry, not just the two endpoints", async () => {
    const route = await fetchDrivingRoute(PICKUP, BANK, osrmResponse(GOOD));
    expect(route.followsRoads).toBe(true);
    expect(route.path).toHaveLength(3);
  });

  it("converts coordinates to the lat,lng order the map draws in", async () => {
    const route = await fetchDrivingRoute(PICKUP, BANK, osrmResponse(GOOD));
    // OSRM sends lon,lat; the first point must come back as lat,lng.
    expect(route.path[0]).toEqual([41.584605, -93.630764]);
  });

  it("reports real road distance and drive time", async () => {
    const route = await fetchDrivingRoute(PICKUP, BANK, osrmResponse(GOOD));
    expect(route.distanceMiles).toBeCloseTo(4.68, 2);
    expect(route.durationMinutes).toBe(9);
  });

  it("sends the request as lon,lat, which is what OSRM expects", async () => {
    const spy = osrmResponse(GOOD);
    await fetchDrivingRoute(PICKUP, BANK, spy);
    expect(vi.mocked(spy).mock.calls[0]?.[0]).toContain("-93.6308,41.5847;-93.6175,41.5264");
  });

  it("falls back to a straight line when the service errors", async () => {
    const route = await fetchDrivingRoute(PICKUP, BANK, osrmResponse({}, false));
    expect(route.followsRoads).toBe(false);
    expect(route.path).toEqual([
      [41.5847, -93.6308],
      [41.5264, -93.6175],
    ]);
    expect(route.distanceMiles).toBeGreaterThan(0);
  });

  it("falls back when the service answers but finds no route", async () => {
    const route = await fetchDrivingRoute(
      PICKUP,
      BANK,
      osrmResponse({ code: "NoRoute", routes: [] }),
    );
    expect(route.followsRoads).toBe(false);
  });

  it("falls back rather than throwing when the network fails", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    const route = await fetchDrivingRoute(PICKUP, BANK, failing);
    expect(route.followsRoads).toBe(false);
    expect(route.durationMinutes).toBeGreaterThan(0);
  });

  it("falls back when the geometry is too short to draw", async () => {
    const route = await fetchDrivingRoute(
      PICKUP,
      BANK,
      osrmResponse({
        code: "Ok",
        routes: [{ distance: 10, duration: 10, geometry: { coordinates: [[-93.6, 41.5]] } }],
      }),
    );
    expect(route.followsRoads).toBe(false);
  });
});
