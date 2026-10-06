import { describe, expect, it } from "vitest";
import { scoreRescue } from "@/lib/rescue-scoring";

describe("Rescue Score", () => {
  it("ranks a nearby cold-storage recipient as eligible and explainable", () => {
    const result = scoreRescue({ name: "Hope Pantry", distanceMiles: 2.1, coldStorage: true, acceptsCategory: true, householdsServed: 85, capacityLbs: 300, requiredStorage: "refrigerated", pounds: 150, minutesRemaining: 45 });
    expect(result.eligible).toBe(true);
    expect(result.score).toBeGreaterThan(80);
    expect(result.explanation).toContain("2.1 miles");
  });

  it("blocks a recipient without required cold storage", () => {
    const result = scoreRescue({ name: "Neighborhood Fridge", distanceMiles: 1, coldStorage: false, acceptsCategory: true, householdsServed: 45, capacityLbs: 300, requiredStorage: "refrigerated", pounds: 150, minutesRemaining: 45 });
    expect(result.eligible).toBe(false);
    expect(result.explanation).toContain("no cold-chain capacity");
  });
});
