import { describe, expect, it } from "vitest";
import { countRescueStatuses, filterRescues } from "@/lib/rescue-opportunities";

const rows = [
  {
    id: "1",
    title: "Hot line prepared meals",
    category: "prepared meals",
    pounds: 180,
    status: "open",
    pickup_address: "400 E Locust St",
    pickup_deadline: "2026-10-07T01:19:00Z",
  },
  {
    id: "2",
    title: "Bakery surplus trays",
    category: "bakery",
    pounds: 90,
    status: "matched",
    pickup_address: "730 3rd St",
    pickup_deadline: "2026-10-06T22:19:00Z",
  },
  {
    id: "3",
    title: "Chilled produce flats",
    category: "produce",
    pounds: 240,
    status: "accepted",
    pickup_address: "1101 Walnut St",
    pickup_deadline: "2026-10-07T00:19:00Z",
  },
  {
    id: "4",
    title: "Dairy case pull",
    category: "dairy",
    pounds: 120,
    status: "driver_assigned",
    pickup_address: "2507 University Ave",
    pickup_deadline: "2026-10-06T23:19:00Z",
  },
  {
    id: "5",
    title: "Weekend produce rescue",
    category: "produce",
    pounds: 310,
    status: "delivered",
    pickup_address: "400 E Locust St",
    pickup_deadline: "2026-10-05T23:19:00Z",
  },
  {
    id: "6",
    title: "Late night sandwich trays",
    category: "prepared meals",
    pounds: 70,
    status: "expired",
    pickup_address: "400 E Locust St",
    pickup_deadline: "2026-10-04T23:19:00Z",
  },
];

describe("Relay board filtering", () => {
  it("returns everything by default", () => {
    expect(filterRescues(rows)).toHaveLength(6);
  });

  it("searches the rescue title", () => {
    expect(filterRescues(rows, { query: "bakery" }).map((r) => r.id)).toEqual(["2"]);
  });

  it("searches the pickup address, which is often what someone remembers", () => {
    expect(filterRescues(rows, { query: "walnut" }).map((r) => r.id)).toEqual(["3"]);
  });

  it("searches the food category", () => {
    expect(filterRescues(rows, { query: "produce" }).map((r) => r.id)).toEqual(["3", "5"]);
  });

  it("matches the status the way the badge spells it", () => {
    expect(filterRescues(rows, { query: "driver assigned" }).map((r) => r.id)).toEqual(["4"]);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(filterRescues(rows, { query: "  DAIRY  " }).map((r) => r.id)).toEqual(["4"]);
  });

  it("filters to rescues still moving", () => {
    expect(filterRescues(rows, { status: "active" }).map((r) => r.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("filters to delivered and to closed separately", () => {
    expect(filterRescues(rows, { status: "delivered" }).map((r) => r.id)).toEqual(["5"]);
    expect(filterRescues(rows, { status: "closed" }).map((r) => r.id)).toEqual(["6"]);
  });

  it("accepts an exact status as well as a bucket", () => {
    expect(filterRescues(rows, { status: "picked_up" })).toHaveLength(0);
    expect(filterRescues(rows, { status: "matched" }).map((r) => r.id)).toEqual(["2"]);
  });

  it("applies search and status together", () => {
    expect(filterRescues(rows, { query: "produce", status: "active" }).map((r) => r.id)).toEqual([
      "3",
    ]);
  });

  it("returns nothing when the pair excludes everything", () => {
    expect(filterRescues(rows, { query: "bakery", status: "delivered" })).toHaveLength(0);
  });

  it("counts each bucket for the filter labels", () => {
    expect(countRescueStatuses(rows)).toEqual({ all: 6, active: 4, delivered: 1, closed: 1 });
  });
});
