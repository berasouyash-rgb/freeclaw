// ═══════════════════════════════════════════════════════════════════
// Platform-map contract — the change-impact engine stays truthful.
// ═══════════════════════════════════════════════════════════════════
// Runs scripts/check-platform-map.mjs and fails on broken references
// (missing page/api/test files). Unmapped modules are warnings, not
// failures — the map grows over time; see the script output for the
// current coverage-gap list.
// ═══════════════════════════════════════════════════════════════════

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

describe("platform-map contract", () => {
  it("is valid JSON with flows", async () => {
    const map = JSON.parse(
      fs.readFileSync(path.join(root, "docs", "platform-map.json"), "utf8"),
    );
    expect(Array.isArray(map.flows)).toBe(true);
    expect(map.flows.length).toBeGreaterThan(0);
    for (const flow of map.flows) {
      expect(typeof flow.route).toBe("string");
      expect(typeof flow.page).toBe("string");
      expect(Array.isArray(flow.apis)).toBe(true);
      expect(Array.isArray(flow.tests)).toBe(true);
    }
  });

  it("passes the checker (no broken references)", async () => {
    let output = "";
    let failed = false;
    try {
      output = execFileSync(
        process.execPath,
        [path.join(root, "scripts", "check-platform-map.mjs")],
        { encoding: "utf8", timeout: 60000 },
      );
    } catch (err) {
      failed = true;
      output =
        (err as { stdout?: string }).stdout ?? String(err);
    }
    expect(output).toContain("platform-map OK");
    expect(failed).toBe(false);
  });
});
