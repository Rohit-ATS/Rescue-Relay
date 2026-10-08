import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPreviewServer, fileForPathname } from "../../scripts/preview-pages.mjs";

const fixtures: string[] = [];

function makePagesOutput() {
  const directory = mkdtempSync(path.join(tmpdir(), "rescue-relay-pages-"));
  fixtures.push(directory);
  mkdirSync(path.join(directory, "dashboard"));
  writeFileSync(path.join(directory, "index.html"), "<h1>Home</h1>");
  writeFileSync(path.join(directory, "dashboard", "index.html"), "<h1>Dashboard</h1>");
  writeFileSync(path.join(directory, "404.html"), "<h1>Not found</h1>");
  return directory;
}

afterEach(() => {
  while (fixtures.length) rmSync(fixtures.pop()!, { recursive: true, force: true });
});

describe("GitHub Pages preview", () => {
  it("serves prerendered deep links and the SPA fallback without exposing parent paths", () => {
    const directory = makePagesOutput();

    expect(fileForPathname(directory, "/dashboard")).toBe(
      path.join(directory, "dashboard", "index.html"),
    );
    expect(fileForPathname(directory, "/missing")).toBe(path.join(directory, "404.html"));
    expect(fileForPathname(directory, "/%2e%2e/private.txt")).toBeNull();
  });

  it("returns the static Pages output over HTTP", async () => {
    const server = createPreviewServer(makePagesOutput());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Preview server did not bind a port");
      const response = await fetch(`http://127.0.0.1:${address.port}/dashboard`);

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Dashboard");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
