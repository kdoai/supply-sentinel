import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateNetwork, validateScenario, validateTimeseries } from "../src/supply_sentinel/networkSchema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scenarioDir = path.join(__dirname, "..", "web", "assets", "scenarios");

async function loadJson(file) {
  return JSON.parse(await readFile(path.join(scenarioDir, file), "utf8"));
}

// Every scenario JSON (except the index/timeseries) must pass the locked contract.
test("all scenario files satisfy the network contract", async () => {
  const files = (await readdir(scenarioDir)).filter(
    (f) => f.endsWith(".json") && f !== "index.json" && !f.endsWith(".timeseries.json"),
  );
  assert.ok(files.length >= 1, "at least the naphtha scenario exists");
  for (const file of files) {
    const scenario = await loadJson(file);
    const r = validateScenario(scenario, file);
    assert.equal(r.ok, true, `${file}: ${r.errors.join("; ")}`);
  }
});

test("all timeseries files are well-formed", async () => {
  const files = (await readdir(scenarioDir)).filter((f) => f.endsWith(".timeseries.json"));
  for (const file of files) {
    const ts = await loadJson(file);
    const r = validateTimeseries(ts, file);
    assert.equal(r.ok, true, `${file}: ${r.errors.join("; ")}`);
  }
});

test("validateNetwork rejects a spend that does not equal volume*price", () => {
  const bad = {
    focal_material: "x",
    nodes: [
      { id: "a", tier: 1, kind: "supplier", name: "A" },
      { id: "b", tier: 0, kind: "plant", name: "B" },
    ],
    edges: [
      { id: "e", source: "a", target: "b", material: "x", monthly_volume: 10, unit_price_usd: 5, monthly_spend_usd: 999, share_percent: 100, dependency: 1.0 },
    ],
  };
  const r = validateNetwork(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("spend")));
});

test("validateNetwork rejects a cycle", () => {
  const bad = {
    focal_material: "x",
    nodes: [
      { id: "a", tier: 1, kind: "supplier", name: "A" },
      { id: "b", tier: 0, kind: "plant", name: "B" },
    ],
    edges: [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "a" },
    ],
  };
  const r = validateNetwork(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("cycle")));
});
