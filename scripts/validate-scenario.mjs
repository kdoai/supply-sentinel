// validate-scenario.mjs — self-check a generated scenario against the locked contract.
//
// Usage:  node scripts/validate-scenario.mjs <scenario-id>
// Checks: schema validity (network/scenario/timeseries) + that each timeseries
// month's baked metrics equal a live propagationEngine recompute. Exits non-zero
// on any problem. Phase B agents run this until it prints "OK".

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateScenario, validateTimeseries } from "../src/supply_sentinel/networkSchema.mjs";
import { computeMetrics } from "../src/supply_sentinel/propagationEngine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, "..", "web", "assets", "scenarios");

const id = process.argv[2];
const BAKE = process.argv.includes("--bake");
if (!id) {
  console.error("usage: node scripts/validate-scenario.mjs <scenario-id> [--bake]");
  console.error("  --bake: overwrite each timeseries month's metrics with the engine result");
  process.exit(2);
}

async function loadJson(file) {
  return JSON.parse(await readFile(path.join(dir, file), "utf8"));
}

const errors = [];
const scenario = await loadJson(`${id}.json`).catch((e) => {
  errors.push(`cannot read ${id}.json: ${e.message}`);
  return null;
});

if (scenario) {
  const r = validateScenario(scenario, `${id}.json`);
  errors.push(...r.errors);

  // Recompute the headline disruption and report the numbers.
  const head = computeMetrics(scenario.network, scenario.disruption, {
    inventory: scenario.inventory,
    alternatives: scenario.alternatives,
    risk_inputs: scenario.risk_inputs,
  });
  console.log(`Headline metrics for ${id}:`, JSON.stringify(head.metrics, null, 2));

  const ts = await loadJson(`${id}.timeseries.json`).catch((e) => {
    errors.push(`cannot read ${id}.timeseries.json: ${e.message}`);
    return null;
  });
  if (ts) {
    const CANON = [
      "risk_score",
      "severity",
      "affected_supply_ratio",
      "spend_at_risk_usd",
      "total_spend_usd",
      "inventory_days_min",
    ];
    for (const month of ts.months || []) {
      const live = computeMetrics(scenario.network, month.disruption || {}, {
        inventory: month.inventory || scenario.inventory,
        alternatives: scenario.alternatives,
        risk_inputs: month.risk_inputs || scenario.risk_inputs,
      }).metrics;
      if (BAKE) {
        month.metrics = Object.fromEntries(CANON.map((k) => [k, live[k]]));
        continue;
      }
      const baked = month.metrics || {};
      for (const key of CANON) {
        if (live[key] !== baked[key]) {
          errors.push(
            `${id} month ${month.month}: metrics.${key} baked=${baked[key]} but engine=${live[key]} (run with --bake to fix)`,
          );
        }
      }
    }
    if (BAKE) {
      await writeFile(path.join(dir, `${id}.timeseries.json`), JSON.stringify(ts, null, 2) + "\n", "utf8");
      console.log(`Baked engine metrics into ${id}.timeseries.json (${ts.months.length} months).`);
    }
    const tr = validateTimeseries(ts, `${id}.timeseries.json`);
    errors.push(...tr.errors);
  }
}

if (errors.length) {
  console.error(`\nFAIL (${errors.length}):`);
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log("\nOK — scenario conforms to the contract and timeseries metrics are engine-consistent.");
