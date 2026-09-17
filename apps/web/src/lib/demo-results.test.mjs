import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { demoScans } from "./demo-scans.ts";
import { demoResults } from "./demo-results.ts";

test("every selectable preset has a report, an image, and a source", async () => {
  for (const [service, scans] of Object.entries(demoScans)) {
    assert.equal(new Set(scans.map(scan => scan.id)).size, scans.length);
    assert.deepEqual(Object.keys(demoResults[service]).sort(), scans.map(scan => scan.id).sort());
    for (const scan of scans) {
      const report = demoResults[service][scan.id];
      assert.ok(report.summary && report.impression && report.findings.length);
      assert.ok(report.findings.every(item => item.clinical && item.explanation));
      assert.equal(new URL(scan.sourceUrl).protocol, "https:");
      await access(new URL(`../../public${scan.path}`, import.meta.url));
    }
  }
});
