import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("keeps real sign-in available while the protected layout owns demo mode", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    const protectedLayout = readFileSync("src/routes/_authenticated/route.tsx", "utf8");

    expect(root).not.toContain("Instant Demo Guest Evaluator");
    expect(root).not.toContain("setUser(demoUser)");
    expect(protectedLayout).toContain("demoOnly: true");
  });
});
