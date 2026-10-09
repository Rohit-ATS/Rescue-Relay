import { describe, expect, it } from "vitest";

import { DEMO_SEED_DONOR_USER_ID, DEMO_USER_ID, getInitialDonations } from "@/lib/demo-store";

describe("Demo post ownership", () => {
  // The delete control reads donor_user_id. Attributing the sample posts to the
  // viewer let them delete rescues they never created.
  it("attributes the sample posts to a donor who is not the demo viewer", () => {
    const donations = getInitialDonations();

    expect(donations.length).toBeGreaterThan(0);
    expect(donations.every((d) => d.donor_user_id === DEMO_SEED_DONOR_USER_ID)).toBe(true);
    expect(donations.some((d) => d.donor_user_id === DEMO_USER_ID)).toBe(false);
  });
});
