import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStateStore, loadAlertHistory } from "../src/supply_sentinel/stateStore.mjs";
import { cosmosDbConfigured, stateStoreMode } from "../src/supply_sentinel/config.mjs";
import { httpLatestDashboard } from "../src/function_app/httpLatestDashboard.mjs";
import { authorizeManualRun } from "../src/function_app/httpRunAgent.mjs";

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
    assert.equal(body.dashboard.meta.app, dashboard.meta.app);
    assert.equal(body.dashboard.assessment.material, dashboard.assessment.material);
    assert.deepEqual(body.dashboard.meta.cloud.state_store, "local");
    assert.equal(body.dashboard.meta.cloud.persisted, false);
    assert.equal(body.dashboard.agent_run.run_mode, "demo");
    assert.equal(body.dashboard.agent_run.persisted, false);
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

test("manual AI巡回 authorization is public by default for hackathon demo", () => {
  const previous = process.env.SUPPLY_SENTINEL_RUN_AGENT_TOKEN;
  const previousPublic = process.env.SUPPLY_SENTINEL_RUN_AGENT_PUBLIC;
  delete process.env.SUPPLY_SENTINEL_RUN_AGENT_TOKEN;
  delete process.env.SUPPLY_SENTINEL_RUN_AGENT_PUBLIC;
  try {
    assert.equal(authorizeManualRun({ headers: {} }).ok, true);
  } finally {
    if (previous === undefined) delete process.env.SUPPLY_SENTINEL_RUN_AGENT_TOKEN;
    else process.env.SUPPLY_SENTINEL_RUN_AGENT_TOKEN = previous;
    if (previousPublic === undefined) delete process.env.SUPPLY_SENTINEL_RUN_AGENT_PUBLIC;
    else process.env.SUPPLY_SENTINEL_RUN_AGENT_PUBLIC = previousPublic;
  }
});

test("manual AI巡回 authorization can be locked down with an operator token", () => {
  const previous = process.env.SUPPLY_SENTINEL_RUN_AGENT_TOKEN;
  const previousPublic = process.env.SUPPLY_SENTINEL_RUN_AGENT_PUBLIC;
  process.env.SUPPLY_SENTINEL_RUN_AGENT_TOKEN = "demo-secret";
  process.env.SUPPLY_SENTINEL_RUN_AGENT_PUBLIC = "false";
  try {
    assert.equal(authorizeManualRun({ headers: {} }).status, 401);
    assert.equal(authorizeManualRun({ headers: { "x-supply-sentinel-run-key": "wrong" } }).status, 403);
    assert.equal(authorizeManualRun({ headers: { "x-supply-sentinel-run-key": "demo-secret" } }).ok, true);
    assert.equal(authorizeManualRun({ headers: { authorization: "Bearer demo-secret" } }).ok, true);
  } finally {
    if (previous === undefined) delete process.env.SUPPLY_SENTINEL_RUN_AGENT_TOKEN;
    else process.env.SUPPLY_SENTINEL_RUN_AGENT_TOKEN = previous;
    if (previousPublic === undefined) delete process.env.SUPPLY_SENTINEL_RUN_AGENT_PUBLIC;
    else process.env.SUPPLY_SENTINEL_RUN_AGENT_PUBLIC = previousPublic;
  }
});

test("manual AI巡回 local quota allows only the configured daily limit", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "sentinel-quota-"));
  const store = createStateStore({ outputDir, mode: "local" });
  const now = new Date("2026-06-02T02:00:00Z");

  const first = await store.reserveManualRunQuota({ limit: 2, now, timeZone: "Asia/Tokyo" });
  const second = await store.reserveManualRunQuota({ limit: 2, now, timeZone: "Asia/Tokyo" });
  const third = await store.reserveManualRunQuota({ limit: 2, now, timeZone: "Asia/Tokyo" });

  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);
  assert.equal(third.allowed, false);
  assert.equal(third.used, 2);
  assert.equal(third.limit, 2);
});
