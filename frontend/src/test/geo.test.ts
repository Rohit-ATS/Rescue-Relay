import { describe, expect, it } from "vitest";
import {
  directionsUrl,
  distanceMiles,
  estimatedDriveMinutes,
  formatMiles,
  formatMinutes,
  hasPosition,
} from "@/lib/geo";

const DES_MOINES = { latitude: 41.5908, longitude: -93.6208 };
const ANKENY = { latitude: 41.7317, longitude: -93.6 };

describe("Distance", () => {
  it("measures a known separation to within a tenth of a mile", () => {
    // Des Moines to Ankeny is about 9.8 miles great-circle.
    expect(distanceMiles(DES_MOINES, ANKENY)).toBeCloseTo(9.8, 1);
  });

  it("is zero for the same point and symmetric between two points", () => {
    expect(distanceMiles(DES_MOINES, DES_MOINES)).toBe(0);
    expect(distanceMiles(DES_MOINES, ANKENY)).toBeCloseTo(distanceMiles(ANKENY, DES_MOINES), 10);
  });

  it("does not treat a degree of longitude as a degree of latitude", () => {
    // The old flat form scaled both axes by 52, overstating east-west distance.
    const northSouth = distanceMiles(DES_MOINES, {
      ...DES_MOINES,
      latitude: DES_MOINES.latitude + 1,
    });
    const eastWest = distanceMiles(DES_MOINES, {
      ...DES_MOINES,
      longitude: DES_MOINES.longitude + 1,
    });
    expect(northSouth).toBeCloseTo(69, 0);
    expect(eastWest).toBeCloseTo(51.7, 0);
    expect(eastWest).toBeLessThan(northSouth);
  });
});

describe("Drive estimates", () => {
  it("adds detour and handoff time on top of straight-line distance", () => {
    const minutes = estimatedDriveMinutes(DES_MOINES, ANKENY);
    const straightLineMinutes = (distanceMiles(DES_MOINES, ANKENY) / 24) * 60;
    expect(minutes).toBeGreaterThan(straightLineMinutes);
  });

  it("still budgets handoff time for a pickup next door", () => {
    expect(estimatedDriveMinutes(DES_MOINES, DES_MOINES)).toBe(10);
  });
});

describe("Position validity", () => {
  it("rejects the 0,0 placeholder an unset coordinate column reads as", () => {
    expect(hasPosition({ latitude: 0, longitude: 0 })).toBe(false);
  });

  it("rejects missing, non-finite and out-of-range coordinates", () => {
    expect(hasPosition(null)).toBe(false);
    expect(hasPosition({ latitude: Number.NaN, longitude: 1 })).toBe(false);
    expect(hasPosition({ latitude: 91, longitude: 1 })).toBe(false);
    expect(hasPosition({ latitude: 1, longitude: 181 })).toBe(false);
  });

  it("accepts a real position", () => {
    expect(hasPosition(DES_MOINES)).toBe(true);
  });
});

describe("Navigation hand-off", () => {
  it("builds a driving link that needs no API key", () => {
    const url = directionsUrl(DES_MOINES, ANKENY);
    expect(url).toContain("travelmode=driving");
    expect(url).toContain("origin=41.5908%2C-93.6208");
    expect(url).toContain("destination=41.7317%2C-93.6");
  });

  it("threads the pickup through as a waypoint when the driver starts elsewhere", () => {
    expect(directionsUrl(ANKENY, ANKENY, DES_MOINES)).toContain("waypoints=41.5908%2C-93.6208");
  });
});

describe("Formatting", () => {
  it("keeps short distances precise and long ones round", () => {
    expect(formatMiles(0.05)).toBe("under 0.1 mi");
    expect(formatMiles(2.34)).toBe("2.3 mi");
    expect(formatMiles(23.4)).toBe("23 mi");
  });

  it("reads durations the way a driver would say them", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 hr");
    expect(formatMinutes(95)).toBe("1 hr 35 min");
  });
});
