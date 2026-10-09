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

describe("Turn-by-turn directions", () => {
  const WITH_STEPS = {
    code: "Ok",
    routes: [
      {
        distance: 7532,
        duration: 530,
        geometry: {
          coordinates: [
            [-93.630764, 41.584605],
            [-93.6175, 41.526349],
          ],
        },
        legs: [
          {
            steps: [
              { distance: 34.4, name: "", maneuver: { type: "depart" } },
              { distance: 531.7, name: "2nd Avenue", maneuver: { type: "turn", modifier: "left" } },
            ],
          },
          {
            steps: [
              {
                distance: 4087.8,
                name: "John MacVicar Freeway",
                maneuver: { type: "merge", modifier: "slight left" },
              },
              { distance: 0, name: "", maneuver: { type: "arrive" } },
            ],
          },
        ],
      },
    ],
  };

  it("phrases each manoeuvre and keeps every leg in one list", async () => {
    const route = await fetchDrivingRoute(PICKUP, BANK, osrmResponse(WITH_STEPS), {
      waypoints: [{ latitude: 41.56, longitude: -93.62 }],
    });

    expect(route.steps.map((s) => s.instruction)).toEqual([
      "Start the drive",
      "Turn left onto 2nd Avenue",
      "Merge slightly left onto John MacVicar Freeway",
      "Arrive at the stop",
    ]);
    expect(route.steps[1]?.distanceMiles).toBeCloseTo(531.7 / 1609.344, 4);
  });

  it("routes through the waypoints it was given, in order", async () => {
    const spy = osrmResponse(WITH_STEPS);
    await fetchDrivingRoute(PICKUP, BANK, spy, {
      waypoints: [{ latitude: 41.56, longitude: -93.62 }],
    });

    const url = String((spy as unknown as { mock: { calls: string[][] } }).mock.calls[0]?.[0]);
    expect(url).toContain("-93.6308,41.5847;-93.62,41.56;-93.6175,41.5264");
    // Without this OSRM returns geometry but no manoeuvres.
    expect(url).toContain("steps=true");
  });

  // A driver would rather see "no directions" than a turn list for a line that
  // ignores roads entirely.
  it("offers no directions for the straight-line fallback, and totals every stop", async () => {
    const route = await fetchDrivingRoute(PICKUP, BANK, osrmResponse({}, false), {
      waypoints: [{ latitude: 41.9, longitude: -93.9 }],
    });

    expect(route.followsRoads).toBe(false);
    expect(route.steps).toEqual([]);
    expect(route.path).toHaveLength(3);
    // The detour through the waypoint is longer than the direct line it replaced.
    const direct = await fetchDrivingRoute(PICKUP, BANK, osrmResponse({}, false));
    expect(route.distanceMiles).toBeGreaterThan(direct.distanceMiles);
  });
});
