import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  approveMembershipRequestLocally,
  fetchPendingMembershipRequests,
} from "@/lib/rescue-client";

beforeEach(() => {
  localStorage.clear();
});

describe("Membership requests on a static host", () => {
  it("does not reach for a server function, which GitHub Pages cannot serve", () => {
    const source = readFileSync("src/routes/_authenticated.memberships.tsx", "utf8");
    // The page is deployed to a static host: a createServerFn call there fetches the
    // SPA shell instead of data, and the page fails with a parse error.
    expect(source).not.toContain("useServerFn");
    expect(source).not.toContain("rescue.functions");
  });

  it("lists the pending requests a coordinator has to review", async () => {
    const requests = await fetchPendingMembershipRequests();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0]).toMatchObject({ status: "pending" });
    expect(requests[0]?.requesterName).toBeTruthy();
    expect(requests[0]?.organizationName).toBeTruthy();
  });

  it("removes a request from the queue once approved", async () => {
    const before = await fetchPendingMembershipRequests();
    const target = before[0];
    expect(target).toBeDefined();

    await approveMembershipRequestLocally(target!.id);

    const after = await fetchPendingMembershipRequests();
    expect(after.map((r) => r.id)).not.toContain(target!.id);
    expect(after).toHaveLength(before.length - 1);
  });

  it("keeps the approval after a reload", async () => {
    const [target] = await fetchPendingMembershipRequests();
    await approveMembershipRequestLocally(target!.id);

    // A fresh read goes back through storage, as a reloaded page would.
    const after = await fetchPendingMembershipRequests();
    expect(after.map((r) => r.id)).not.toContain(target!.id);
  });

  it("reports an unknown request rather than throwing", async () => {
    expect(await approveMembershipRequestLocally("no-such-request")).toEqual({ ok: false });
  });
});

describe("Workspace hydration tolerates older state", () => {
  const KEY = "rescuerelay-demo-workspace-v2";

  it("fills in collections a workspace saved by an older build is missing", async () => {
    // Exactly what broke the deployed dashboard: a v1 workspace stored before
    // membershipRequests existed was written through verbatim, so the first read of
    // it was undefined and the page died on `.filter`.
    localStorage.setItem(
      KEY,
      JSON.stringify({ donations: [{ id: "d1", status: "open" }], userId: "someone" }),
    );

    const requests = await fetchPendingMembershipRequests();
    expect(Array.isArray(requests)).toBe(true);
  });

  it("does not lose the donations an older workspace did carry", async () => {
    const { fetchWorkspaceData } = await import("@/lib/rescue-client");
    localStorage.setItem(
      KEY,
      JSON.stringify({ donations: [{ id: "kept-donation", status: "open" }], userId: "someone" }),
    );

    const workspace = await fetchWorkspaceData();
    expect(workspace.donations.map((d) => d.id)).toContain("kept-donation");
    expect(workspace.userId).toBe("someone");
    // Every collection is present, whatever the stored shape was.
    for (const key of ["roles", "organizations", "matches", "deliveries", "events", "membershipRequests"] as const) {
      expect(Array.isArray(workspace[key])).toBe(true);
    }
  });

  it("survives a stored workspace whose collections are the wrong type", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ donations: [{ id: "d1" }], roles: "not-an-array", events: null, membershipRequests: 7 }),
    );

    const { fetchWorkspaceData } = await import("@/lib/rescue-client");
    const workspace = await fetchWorkspaceData();
    expect(Array.isArray(workspace.roles)).toBe(true);
    expect(Array.isArray(workspace.events)).toBe(true);
    expect(Array.isArray(workspace.membershipRequests)).toBe(true);
  });
});
