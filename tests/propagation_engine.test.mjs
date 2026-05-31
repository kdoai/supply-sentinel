import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeMetrics, propagate, traceDownstream } from "../src/supply_sentinel/propagationEngine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scenarioDir = path.join(__dirname, "..", "web", "assets", "scenarios");

async function loadJson(rel) {
  return JSON.parse(await readFile(path.join(scenarioDir, rel), "utf8"));
}

test("naphtha scenario reproduces the locked demo invariants (65% / $7.8M / 5d / 82)", async () => {
  const scenario = await loadJson("naphtha-asia-allocation.json");
  const result = computeMetrics(scenario.network, scenario.disruption, {
    inventory: scenario.inventory,
    alternatives: scenario.alternatives,
    risk_inputs: scenario.risk_inputs,
  });
  const m = result.metrics;
  assert.equal(m.affected_supply_ratio, 65);
  assert.equal(m.spend_at_risk_usd, 7800000);
  assert.equal(m.total_spend_usd, 12000000);
  assert.equal(m.inventory_days_min, 5);
  assert.equal(m.risk_score, 82);
  assert.equal(m.severity, "high");
  assert.equal(m.impacted_products.length, 3);
  assert.equal(m.impacted_customers.length, 3);
  assert.equal(m.impacted_orders.length, 3);
});

test("middle-east lane stays resilient while the three Asian lanes are disrupted", async () => {
  const scenario = await loadJson("naphtha-asia-allocation.json");
  const { node_status, edge_status } = computeMetrics(scenario.network, scenario.disruption, {
    inventory: scenario.inventory,
    alternatives: scenario.alternatives,
    risk_inputs: scenario.risk_inputs,
  });
  assert.equal(node_status.n_sup_gulf.status, "resilient");
  assert.equal(edge_status.e_gulf_chiba, "resilient");
  assert.equal(edge_status.e_demo_chiba, "disrupted");
  assert.equal(edge_status.e_hanmi_osaka, "disrupted");
  assert.equal(edge_status.e_siam_osaka, "disrupted");
});

test("a tier-3 refinery hit propagates two tiers down to the tier-1 supplier", async () => {
  const scenario = await loadJson("naphtha-asia-allocation.json");
  // hit only the upstream refinery; the 2-tier-down supplier must drop too.
  const avail = propagate(scenario.network, { hit_nodes: ["n_ref_jurong"], capacity_drop: 0.3 });
  assert.ok(avail.get("n_t2_jurong_trader") < 0.999, "tier-2 trader impaired");
  assert.ok(avail.get("n_sup_demo") < 0.999, "tier-1 demo supplier impaired");
  assert.equal(Math.round(avail.get("n_sup_gulf") * 1000), 1000, "middle-east supplier untouched");
});

test("traceDownstream from a refinery reaches our orders", async () => {
  const scenario = await loadJson("naphtha-asia-allocation.json");
  const trace = traceDownstream(scenario.network, "n_ref_jurong");
  assert.ok(trace.nodes.includes("n_plant_chiba"));
  assert.ok(trace.nodes.includes("n_prod_resinA"));
  assert.ok(trace.nodes.includes("n_cust_autoA"));
});

test("timeseries baked metrics equal a live engine recompute for every month", async () => {
  const scenario = await loadJson("naphtha-asia-allocation.json");
  const ts = await loadJson("naphtha-asia-allocation.timeseries.json");
  for (const month of ts.months) {
    const result = computeMetrics(scenario.network, month.disruption, {
      inventory: month.inventory,
      alternatives: scenario.alternatives,
      risk_inputs: month.risk_inputs,
    });
    const m = result.metrics;
    const baked = month.metrics;
    assert.equal(m.risk_score, baked.risk_score, `${month.month} risk_score`);
    assert.equal(m.severity, baked.severity, `${month.month} severity`);
    assert.equal(m.affected_supply_ratio, baked.affected_supply_ratio, `${month.month} ratio`);
    assert.equal(m.spend_at_risk_usd, baked.spend_at_risk_usd, `${month.month} spend`);
    assert.equal(m.total_spend_usd, baked.total_spend_usd, `${month.month} total spend`);
    assert.equal(m.inventory_days_min, baked.inventory_days_min, `${month.month} inv days`);
  }
});
