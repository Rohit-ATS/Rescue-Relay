import { describe, expect, it } from "vitest";
import { WORKSPACE_QUERY_KEY, reconnectDelay } from "@/lib/live-sync";

describe("Realtime reconnection backoff", () => {
  it("never retries faster than one second, so a flapping socket cannot spin", () => {
    for (let attempts = 0; attempts < 12; attempts += 1) {
      expect(reconnectDelay(attempts, () => 0)).toBeGreaterThanOrEqual(1000);
    }
  });

  it("caps the wait so a recovered connection is picked up promptly", () => {
    expect(reconnectDelay(99, () => 1)).toBeLessThanOrEqual(15000);
  });

  it("grows the ceiling with consecutive failures", () => {
    expect(reconnectDelay(1, () => 1)).toBeGreaterThan(reconnectDelay(0, () => 1));
    expect(reconnectDelay(4, () => 1)).toBeGreaterThan(reconnectDelay(2, () => 1));
  });

  it("jitters within the window so clients do not retry in lockstep", () => {
    expect(reconnectDelay(5, () => 0)).not.toBe(reconnectDelay(5, () => 1));
  });

  it("keys the workspace query so unrelated caches survive invalidation", () => {
    expect(WORKSPACE_QUERY_KEY).toEqual(["rescue-workspace"]);
  });
});
