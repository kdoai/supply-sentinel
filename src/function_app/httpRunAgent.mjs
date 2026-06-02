import path from "node:path";
import { runSupplySentinel } from "../supply_sentinel/workflow.mjs";
import { createStateStore } from "../supply_sentinel/stateStore.mjs";
import { buildAgentRun } from "../supply_sentinel/agentTrace.mjs";
import { manualRunConfig } from "../supply_sentinel/config.mjs";

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "outputs", "latest");

export async function httpRunAgent(context = {}, req = {}) {
  if (req.method === "OPTIONS") {
    const response = corsResponse(204, "");
    context.res = response;
    return response;
  }

  if (req.method && req.method !== "POST") {
    const response = jsonResponse(405, { error: "method_not_allowed" });
    context.res = response;
    return response;
  }

  const auth = authorizeManualRun(req);
  if (!auth.ok) {
    const response = jsonResponse(auth.status, {
      error: auth.error,
      message: auth.message,
      requires_key: true,
    });
    context.res = response;
    return response;
  }

  const outputDir = process.env.SUPPLY_SENTINEL_OUTPUT_DIR || DEFAULT_OUTPUT_DIR;
  const store = createStateStore({ outputDir });
  const startedAt = new Date().toISOString();

  try {
    const result = await runSupplySentinel({
      rootDir: process.cwd(),
      outputDir,
      stateStore: store,
      trigger: {
        type: "manual",
        requested_at: startedAt,
        requested_by: "demo-operator",
      },
    });
    const dashboard = result.dashboardData;
    enrichManualRunDashboard(dashboard, store.kind, startedAt);
    const response = jsonResponse(200, {
      ok: true,
      run_started_at: startedAt,
      served_at: new Date().toISOString(),
      state_store: store.kind,
      dashboard,
    });
    context.res = response;
    return response;
  } catch (error) {
    const response = jsonResponse(500, {
      error: "agent_run_failed",
      message: error && error.message ? error.message : String(error),
      run_started_at: startedAt,
    });
    context.res = response;
    return response;
  }
}

export async function runAgentHandler(request, context) {
  const response = await httpRunAgent(context, {
    method: request.method,
    url: request.url,
    headers: headerReader(request.headers),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
  };
}

export function authorizeManualRun(req = {}) {
  const config = manualRunConfig();
  if (config.allowWithoutToken) return { ok: true };
  if (!config.token) {
    return {
      ok: false,
      status: 403,
      error: "manual_run_not_configured",
      message: "Manual agent runs are disabled until SUPPLY_SENTINEL_RUN_AGENT_TOKEN is configured.",
    };
  }

  const actual = readHeader(req.headers, "x-supply-sentinel-run-key") || bearerToken(readHeader(req.headers, "authorization"));
  if (constantTimeEqual(actual, config.token)) return { ok: true };
  return {
    ok: false,
    status: actual ? 403 : 401,
    error: actual ? "invalid_run_key" : "missing_run_key",
    message: "A valid operator run key is required to start the AI巡回エージェント.",
  };
}

function enrichManualRunDashboard(dashboard, stateStoreKind, startedAt) {
  if (!dashboard || typeof dashboard !== "object") return dashboard;
  dashboard.meta = dashboard.meta || {};
  dashboard.meta.cloud = {
    served_at: new Date().toISOString(),
    state_store: stateStoreKind,
    persisted: stateStoreKind === "cosmos",
  };
  dashboard.meta.agent_trigger = {
    type: "manual",
    requested_at: startedAt,
    schedule: process.env.SUPPLY_SENTINEL_TIMER_CRON || "0 */6 * * *",
  };
  dashboard.agent_run = buildAgentRun(dashboard);
  return dashboard;
}

function jsonResponse(status, body) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": process.env.AGENT_ADVICE_ALLOW_ORIGIN || "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-supply-sentinel-run-key,authorization",
    },
    body: JSON.stringify(body),
  };
}

function corsResponse(status, body) {
  return jsonResponse(status, body);
}

function headerReader(headers) {
  return {
    get(name) {
      if (!headers) return "";
      if (typeof headers.get === "function") return headers.get(name) || "";
      return readHeader(headers, name);
    },
  };
}

function readHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const lower = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === lower) return Array.isArray(value) ? value[0] : String(value || "");
  }
  return "";
}

function bearerToken(value) {
  const match = String(value || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function constantTimeEqual(actual, expected) {
  const a = String(actual || "");
  const b = String(expected || "");
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
