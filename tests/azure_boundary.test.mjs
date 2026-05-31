import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStateStore, loadAlertHistory } from "../src/supply_sentinel/stateStore.mjs";
import { cosmosDbConfigured, stateStoreMode } from "../src/supply_sentinel/config.mjs";
import { httpLatestDashboard } from "../src/function_app/httpLatestDashboard.mjs";

test("local state store reads latest dashboard and alert history", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "sentinel-store-"));
  const dashboard = { meta: { app: "Supply Sentinel" }, assessment: { risk_score: 82 } };
  const alerts = [{ alert_id: "alert-1", status: "open" }];

  await writeFile(path.join(outputDir, "dashboard_data.json"), JSON.stringify(dashboard), "utf8");
  await writeFile(path.join(outputDir, "alert_history.json"), JSON.stringify(alerts), "utf8");

  const store = createStateStore({ outputDir, mode: "local" });
  assert.equal(store.kind, "local");
  assert.deepEqual(await store.getLatestDashboard(), dashboard);
  assert.deepEqual(await store.listAlerts(), alerts);
});

test("missing alert history is treated as an empty operational backlog", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "sentinel-alerts-"));
  assert.deepEqual(await loadAlertHistory({ outputDir }), []);
});

test("HTTP latest dashboard trigger returns API-shaped JSON from local store", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "sentinel-api-"));
  const dashboard = { meta: { app: "Supply Sentinel" }, assessment: { material: "naphtha" } };
  await writeFile(path.join(outputDir, "dashboard_data.json"), JSON.stringify(dashboard), "utf8");

  const previousOutputDir = process.env.SUPPLY_SENTINEL_OUTPUT_DIR;
  process.env.SUPPLY_SENTINEL_OUTPUT_DIR = outputDir;
  try {
    const context = {};
    const response = await httpLatestDashboard(context, { url: "/api/latest-dashboard" });
    const body = JSON.parse(response.body);

    assert.equal(response.status, 200);
    assert.equal(context.res, response);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(body.state_store, "local");
    assert.deepEqual(body.dashboard, dashboard);
  } finally {
    if (previousOutputDir === undefined) {
      delete process.env.SUPPLY_SENTINEL_OUTPUT_DIR;
    } else {
      process.env.SUPPLY_SENTINEL_OUTPUT_DIR = previousOutputDir;
    }
  }
});

test("cloud boundary stays explicit without Cosmos credentials", () => {
  assert.equal(stateStoreMode({ stateStore: "cosmos" }), "cosmos");
  assert.equal(cosmosDbConfigured(), Boolean(process.env.COSMOS_DB_ENDPOINT && process.env.COSMOS_DB_KEY));
});
