import { describe, expect, it } from "vitest";
import {
  buildOpportunities,
  listFoodBanks,
  listPartners,
  type OpportunityInputs,
} from "@/lib/rescue-opportunities";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const SOON = "2026-10-06T18:00:00Z";
const PAST = "2026-10-05T18:00:00Z";
const VIEWER = { latitude: 41.5908, longitude: -93.6208 };

const donation = (over: Partial<OpportunityInputs["donations"][number]> = {}) => ({
  id: "don-1",
  title: "Prepared meals",
  category: "prepared meals",
  pounds: 150,
  storage_required: "refrigerated",
  pickup_address: "400 E Locust St",
  pickup_deadline: SOON,
  status: "accepted",
  latitude: 41.5892,
  longitude: -93.6113,
  ...over,
});

const org = (over: Partial<OpportunityInputs["organizations"][number]> = {}) => ({
  id: "org-1",
  name: "Hope Pantry",
  type: "recipient",
  address: "1200 Grand Ave",
  latitude: 41.5858,
  longitude: -93.633,
  cold_storage: true,
  capacity_lbs: 400,
  households_served: 85,
  accepted_categories: ["prepared meals"],
  verification_status: "verified",
  ...over,
});

const match = (over: Partial<OpportunityInputs["matches"][number]> = {}) => ({
  id: "match-1",
  donation_id: "don-1",
  recipient_org_id: "org-1",
  status: "accepted",
  score: 90,
  ...over,
});

function inputs(over: Partial<OpportunityInputs> = {}): OpportunityInputs {
  return {
    donations: [donation()],
    matches: [match()],
    organizations: [org()],
    deliveries: [],
    viewer: VIEWER,
    ...over,
  };
}

describe("Volunteer opportunities", () => {
  it("names the food bank a run would serve", () => {
    const [opportunity] = buildOpportunities(inputs(), NOW);
    expect(opportunity?.foodBank).toMatchObject({
      name: "Hope Pantry",
      coldStorage: true,
      householdsServed: 85,
    });
    expect(opportunity?.destinationConfirmed).toBe(true);
  });

  it("reports distance to the pickup and the estimated drive to the drop-off", () => {
    const [opportunity] = buildOpportunities(inputs(), NOW);
    expect(opportunity?.milesToPickup).toBeGreaterThan(0);
    expect(opportunity?.routeMiles).toBeGreaterThan(0);
    expect(opportunity?.routeMinutes).toBeGreaterThan(0);
  });

  it("omits distances when the volunteer has not shared a position", () => {
    const [opportunity] = buildOpportunities(inputs({ viewer: null }), NOW);
    expect(opportunity?.milesToPickup).toBeUndefined();
    // The pickup-to-drop-off leg does not depend on the viewer, so it survives.
    expect(opportunity?.routeMiles).toBeGreaterThan(0);
  });

  it("shows the likely destination before any recipient has accepted", () => {
    const [opportunity] = buildOpportunities(
      inputs({
        donations: [donation({ status: "matched" })],
        organizations: [org(), org({ id: "org-2", name: "Eastside Fridge" })],
        matches: [
          match({ status: "proposed", score: 40 }),
          match({ id: "m2", recipient_org_id: "org-2", status: "proposed", score: 95 }),
        ],
      }),
      NOW,
    );
    expect(opportunity?.foodBank?.name).toBe("Eastside Fridge");
    expect(opportunity?.destinationConfirmed).toBe(false);
    expect(opportunity?.claimable).toBe(false);
  });

  it("marks an accepted, unclaimed, in-window run as claimable", () => {
    expect(buildOpportunities(inputs(), NOW)[0]?.claimable).toBe(true);
  });

  it("stops offering a run another driver already claimed", () => {
    const [opportunity] = buildOpportunities(
      inputs({ deliveries: [{ id: "del-1", match_id: "match-1", driver_user_id: "other" }] }),
      NOW,
    );
    expect(opportunity?.claimable).toBe(false);
    expect(opportunity?.claimedByUserId).toBe("other");
  });

  it("stops offering a run whose pickup window has closed", () => {
    const [opportunity] = buildOpportunities(
      inputs({ donations: [donation({ pickup_deadline: PAST })] }),
      NOW,
    );
    expect(opportunity?.expired).toBe(true);
    expect(opportunity?.claimable).toBe(false);
  });

  it("leaves out rescues that are already finished", () => {
    for (const status of ["delivered", "expired", "cancelled"]) {
      expect(buildOpportunities(inputs({ donations: [donation({ status })] }), NOW)).toHaveLength(
        0,
      );
    }
  });

  it("puts claimable work first, then the nearest pickup", () => {
    const far = donation({ id: "don-far", latitude: 41.9, longitude: -93.9 });
    const near = donation({ id: "don-near", latitude: 41.591, longitude: -93.621 });
    const unclaimable = donation({
      id: "don-unclaimable",
      status: "matched",
      latitude: 41.5905,
      longitude: -93.6205,
    });
    const result = buildOpportunities(
      inputs({
        donations: [unclaimable, far, near],
        matches: [
          match({ id: "m-far", donation_id: "don-far" }),
          match({ id: "m-near", donation_id: "don-near" }),
          match({ id: "m-unclaimable", donation_id: "don-unclaimable", status: "proposed" }),
        ],
      }),
      NOW,
    );
    expect(result.map((o) => o.donationId)).toEqual(["don-near", "don-far", "don-unclaimable"]);
  });
});

describe("Partner directory", () => {
  it("lists every organization type, not just food banks", () => {
    const partners = listPartners(
      [org({ id: "bank" }), org({ id: "kitchen", name: "Court Ave Kitchen", type: "donor" })],
      null,
    );
    expect(partners.map((p) => p.type).sort()).toEqual(["donor", "recipient"]);
  });

  it("carries the organization type through so the card can label it", () => {
    expect(listPartners([org({ type: "donor" })], null)[0]?.type).toBe("donor");
  });
});

describe("Food bank directory", () => {
  it("lists recipients only, nearest first when a position is known", () => {
    const banks = listFoodBanks(
      [
        org({ id: "far", name: "Far Pantry", latitude: 42.5, longitude: -93.6 }),
        org({ id: "donor-org", name: "A Restaurant", type: "donor" }),
        org({ id: "near", name: "Near Pantry", latitude: 41.5909, longitude: -93.6209 }),
      ],
      VIEWER,
    );
    expect(banks.map((b) => b.id)).toEqual(["near", "far"]);
    expect(banks[0]?.milesAway).toBeLessThan(1);
  });

  it("falls back to alphabetical order without a viewer position", () => {
    const banks = listFoodBanks(
      [org({ id: "b", name: "Zion Pantry" }), org({ id: "a", name: "Adams Pantry" })],
      null,
    );
    expect(banks.map((b) => b.name)).toEqual(["Adams Pantry", "Zion Pantry"]);
    expect(banks[0]?.milesAway).toBeUndefined();
  });

  it("includes pending and suspended partners so coordinators can act on them", () => {
    const banks = listFoodBanks([org({ id: "p", verification_status: "pending" })], null);
    expect(banks[0]?.verificationStatus).toBe("pending");
  });
});
