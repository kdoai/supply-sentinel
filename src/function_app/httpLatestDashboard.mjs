import path from "node:path";
import { createStateStore } from "../supply_sentinel/stateStore.mjs";
import { buildAgentRun } from "../supply_sentinel/agentTrace.mjs";

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "outputs", "latest");

export async function httpLatestDashboard(context = {}, req = {}) {
  const outputDir = process.env.SUPPLY_SENTINEL_OUTPUT_DIR || DEFAULT_OUTPUT_DIR;
  const store = createStateStore({ outputDir });

  try {
    const dashboard = await store.getLatestDashboard();
    enrichCloudDashboard(dashboard, store.kind);
    const response = jsonResponse(200, {
      served_at: new Date().toISOString(),
      state_store: store.kind,
      dashboard,
    });
    context.res = response;
    return response;
  } catch (error) {
    const response = jsonResponse(404, {
      error: "latest_dashboard_not_found",
      message: error && error.message ? error.message : String(error),
      hint: "Run the timer trigger or `npm run build:web` before requesting the latest dashboard.",
      path: req.url || "/api/latest-dashboard",
    });
    context.res = response;
    return response;
  }
}

export async function latestDashboardHandler(request, context) {
  const response = await httpLatestDashboard(context, { url: request.url });
  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
  };
}

function jsonResponse(status, body) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": process.env.AGENT_ADVICE_ALLOW_ORIGIN || "*",
    },
    body: JSON.stringify(body),
  };
}

function enrichCloudDashboard(dashboard, stateStoreKind) {
  if (!dashboard || typeof dashboard !== "object") return dashboard;
  dashboard.meta = dashboard.meta || {};
  dashboard.meta.cloud = {
    served_at: new Date().toISOString(),
    state_store: stateStoreKind,
    persisted: stateStoreKind === "cosmos",
  };
  dashboard.agent_run = buildAgentRun(dashboard);
  return dashboard;
}
