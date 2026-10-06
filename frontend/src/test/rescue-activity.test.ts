import { describe, expect, it } from "vitest";
import { buildActivityFeed, type ActivityInputs } from "@/lib/rescue-activity";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const SOON = "2026-10-06T18:00:00Z";
const PAST = "2026-10-05T18:00:00Z";

const ME = "user-me";
const MY_ORG = "org-mine";

function inputs(over: Partial<ActivityInputs> = {}): ActivityInputs {
  return {
    userId: ME,
    organizationId: MY_ORG,
    roles: ["driver"],
    donations: [],
    matches: [],
    deliveries: [],
    ...over,
  };
}

const donation = (over: Partial<ActivityInputs["donations"][number]> = {}) => ({
  id: "don-1",
  title: "Prepared meals",
  pounds: 150,
  status: "driver_assigned",
  pickup_deadline: SOON,
  created_at: "2026-10-06T09:00:00Z",
  donor_user_id: "someone-else",
  ...over,
});

const match = (over: Partial<ActivityInputs["matches"][number]> = {}) => ({
  id: "match-1",
  donation_id: "don-1",
  recipient_org_id: MY_ORG,
  status: "accepted",
  created_at: "2026-10-06T09:30:00Z",
  responded_at: "2026-10-06T09:40:00Z",
  ...over,
});

const delivery = (over: Partial<ActivityInputs["deliveries"][number]> = {}) => ({
  id: "del-1",
  match_id: "match-1",
  driver_user_id: ME,
  picked_up_at: null,
  delivered_at: null,
  created_at: "2026-10-06T10:00:00Z",
  ...over,
});

describe("Volunteer driver lifecycle", () => {
  it("moves a claimed route into current activities", () => {
    const { current, recent } = buildActivityFeed(
      inputs({ donations: [donation()], matches: [match()], deliveries: [delivery()] }),
      NOW,
    );
    expect(recent).toHaveLength(0);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ role: "driver", phase: "current", waitingOnYou: true });
    expect(current[0]?.nextStep).toMatch(/confirm pickup/i);
  });

  it("asks for the drop-off once the food is collected", () => {
    const { current } = buildActivityFeed(
      inputs({
        donations: [donation({ status: "picked_up" })],
        matches: [match()],
        deliveries: [delivery({ picked_up_at: "2026-10-06T11:00:00Z" })],
      }),
      NOW,
    );
    expect(current[0]?.nextStep).toMatch(/drop-off/i);
    expect(current[0]?.waitingOnYou).toBe(true);
  });

  it("turns a finished route into a recent activity with its completion time", () => {
    const { current, recent } = buildActivityFeed(
      inputs({
        donations: [donation({ status: "delivered" })],
        matches: [match()],
        deliveries: [
          delivery({ picked_up_at: "2026-10-06T11:00:00Z", delivered_at: "2026-10-06T11:40:00Z" }),
        ],
      }),
      NOW,
    );
    expect(current).toHaveLength(0);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      phase: "recent",
      outcome: "delivered",
      waitingOnYou: false,
      completedAt: "2026-10-06T11:40:00Z",
    });
  });

  it("ignores routes another volunteer claimed", () => {
    const { current, recent } = buildActivityFeed(
      inputs({
        roles: ["driver"],
        donations: [donation()],
        matches: [match()],
        deliveries: [delivery({ driver_user_id: "other-driver" })],
      }),
      NOW,
    );
    expect(current).toHaveLength(0);
    expect(recent).toHaveLength(0);
  });
});

describe("Recipient involvement", () => {
  it("flags an unanswered offer as waiting on this user", () => {
    const { current } = buildActivityFeed(
      inputs({
        roles: ["recipient"],
        donations: [donation({ status: "matched" })],
        matches: [match({ status: "proposed", responded_at: null })],
      }),
      NOW,
    );
    expect(current[0]).toMatchObject({ role: "recipient", waitingOnYou: true });
    expect(current[0]?.nextStep).toMatch(/accept or decline/i);
  });

  it("closes out an offer this user declined", () => {
    const { current, recent } = buildActivityFeed(
      inputs({
        roles: ["recipient"],
        donations: [donation({ status: "open" })],
        matches: [match({ status: "declined" })],
      }),
      NOW,
    );
    expect(current).toHaveLength(0);
    expect(recent[0]).toMatchObject({ outcome: "declined", phase: "recent" });
  });

  it("retires an offer that was never answered before the deadline passed", () => {
    const { current, recent } = buildActivityFeed(
      inputs({
        roles: ["recipient"],
        donations: [donation({ status: "matched", pickup_deadline: PAST })],
        matches: [match({ status: "proposed", responded_at: null })],
      }),
      NOW,
    );
    expect(current).toHaveLength(0);
    expect(recent[0]?.outcome).toBe("expired");
  });

  it("ignores offers made to a different organization", () => {
    const { current, recent } = buildActivityFeed(
      inputs({
        roles: ["recipient"],
        donations: [donation()],
        matches: [match({ recipient_org_id: "org-other" })],
      }),
      NOW,
    );
    expect(current.concat(recent)).toHaveLength(0);
  });
});

describe("Donor involvement", () => {
  it("tracks a posted rescue until it is delivered", () => {
    const live = buildActivityFeed(
      inputs({
        roles: ["donor"],
        organizationId: null,
        donations: [donation({ status: "open", donor_user_id: ME })],
      }),
      NOW,
    );
    expect(live.current[0]).toMatchObject({ role: "donor", phase: "current", waitingOnYou: false });

    const done = buildActivityFeed(
      inputs({
        roles: ["donor"],
        organizationId: null,
        donations: [donation({ status: "delivered", donor_user_id: ME })],
        matches: [match({ recipient_org_id: "org-other" })],
        deliveries: [
          delivery({ driver_user_id: "other-driver", delivered_at: "2026-10-06T11:40:00Z" }),
        ],
      }),
      NOW,
    );
    expect(done.recent[0]).toMatchObject({
      role: "donor",
      outcome: "delivered",
      completedAt: "2026-10-06T11:40:00Z",
    });
  });
});

describe("Feed shaping", () => {
  it("labels one rescue with the most hands-on role rather than duplicating it", () => {
    const { current } = buildActivityFeed(
      inputs({
        roles: ["driver", "donor", "coordinator"],
        donations: [donation({ donor_user_id: ME })],
        matches: [match()],
        deliveries: [delivery()],
      }),
      NOW,
    );
    expect(current).toHaveLength(1);
    expect(current[0]?.role).toBe("driver");
  });

  it("floats work blocked on this user above work that is merely urgent", () => {
    const { current } = buildActivityFeed(
      inputs({
        roles: ["recipient"],
        donations: [
          donation({
            id: "don-urgent",
            status: "accepted",
            pickup_deadline: "2026-10-06T13:00:00Z",
          }),
          donation({
            id: "don-blocked",
            status: "matched",
            pickup_deadline: "2026-10-06T23:00:00Z",
          }),
        ],
        matches: [
          match({ id: "m-urgent", donation_id: "don-urgent", status: "accepted" }),
          match({
            id: "m-blocked",
            donation_id: "don-blocked",
            status: "proposed",
            responded_at: null,
          }),
        ],
      }),
      NOW,
    );
    expect(current[0]?.donationId).toBe("don-blocked");
    expect(current[0]?.waitingOnYou).toBe(true);
  });

  it("orders recent activities with the newest completion first", () => {
    const { recent } = buildActivityFeed(
      inputs({
        roles: ["driver"],
        donations: [
          donation({ id: "d-old", status: "delivered" }),
          donation({ id: "d-new", status: "delivered" }),
        ],
        matches: [
          match({ id: "m-old", donation_id: "d-old" }),
          match({ id: "m-new", donation_id: "d-new" }),
        ],
        deliveries: [
          delivery({ id: "del-old", match_id: "m-old", delivered_at: "2026-10-05T11:00:00Z" }),
          delivery({ id: "del-new", match_id: "m-new", delivered_at: "2026-10-06T11:00:00Z" }),
        ],
      }),
      NOW,
    );
    expect(recent.map((a) => a.donationId)).toEqual(["d-new", "d-old"]);
  });

  it("gives a coordinator oversight of rescues they are not party to, flagging stalled ones", () => {
    const { current } = buildActivityFeed(
      inputs({
        roles: ["coordinator"],
        organizationId: null,
        donations: [donation({ status: "matched", pickup_deadline: PAST })],
      }),
      NOW,
    );
    expect(current[0]).toMatchObject({ role: "coordinator", waitingOnYou: true });
    expect(current[0]?.nextStep).toMatch(/exception/i);
  });

  it("returns nothing for a user with no involvement at all", () => {
    const { current, recent } = buildActivityFeed(
      inputs({ roles: ["donor"], organizationId: null, donations: [donation()] }),
      NOW,
    );
    expect(current.concat(recent)).toHaveLength(0);
  });
});
