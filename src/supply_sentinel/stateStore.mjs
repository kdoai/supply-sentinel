import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cosmosDbConfig, cosmosDbConfigured, stateStoreMode } from "./config.mjs";

const DASHBOARD_FILE = "dashboard_data.json";
const ALERT_HISTORY_FILE = "alert_history.json";
const MANUAL_RUN_QUOTA_FILE = "manual_run_quota.json";

export async function saveRunArtifacts({
  outputDir,
  riskEvent,
  assessment,
  teamsAlert,
  managementReport,
  dashboardHtml,
  dashboardData,
}) {
  await mkdir(outputDir, { recursive: true });

  const files = {
    "risk_event.json": JSON.stringify(riskEvent, null, 2),
    "impact_assessment.json": JSON.stringify(assessment, null, 2),
    "teams_alert.md": teamsAlert,
    "management_report.md": managementReport,
    "dashboard.html": dashboardHtml,
  };

  if (dashboardData) {
    files[DASHBOARD_FILE] = JSON.stringify(dashboardData, null, 2);
  }

  await Promise.all(
    Object.entries(files).map(([fileName, content]) =>
      writeFile(path.join(outputDir, fileName), content, "utf8"),
    ),
  );

  await appendAlertHistory({ outputDir, assessment });
}

export function createStateStore({ outputDir, mode } = {}) {
  const resolvedMode = stateStoreMode({ stateStore: mode });
  if (resolvedMode === "cosmos") {
    return createCosmosStateStore();
  }
  return createLocalStateStore({ outputDir });
}

export function createLocalStateStore({ outputDir = path.join(process.cwd(), "outputs", "latest") } = {}) {
  return {
    kind: "local",
    outputDir,
    async saveRun(run) {
      await saveRunArtifacts({ outputDir, ...run });
    },
    async getLatestDashboard() {
      return loadLatestDashboardData({ outputDir });
    },
    async listAlerts() {
      return loadAlertHistory({ outputDir });
    },
    async reserveManualRunQuota(options) {
      return reserveLocalManualRunQuota({ outputDir, ...options });
    },
  };
}

export function createCosmosStateStore() {
  const config = cosmosDbConfig();
  return {
    kind: "cosmos",
    configured: cosmosDbConfigured(),
    async saveRun(run) {
      const container = await getCosmosContainer(config);
      const assessment = run.assessment || {};
      const now = new Date().toISOString();
      await container.items.upsert({
        id: "latest-dashboard",
        pk: "latest",
        type: "dashboard",
        updated_at: now,
        dashboard: run.dashboardData,
      });
      await container.items.upsert({
        id: `run-${assessment.alert_id || now}`,
        pk: "run",
        type: "run",
        updated_at: now,
        risk_event: run.riskEvent,
        assessment,
        teams_alert: run.teamsAlert,
        management_report: run.managementReport,
      });
      await container.items.upsert({
        id: `alert-${assessment.alert_id || now}`,
        pk: "alert",
        type: "alert",
        updated_at: now,
        alert: buildAlertHistoryItem(assessment),
      });
    },
    async getLatestDashboard() {
      const container = await getCosmosContainer(config);
      const { resource } = await container.item("latest-dashboard", "latest").read();
      if (!resource || !resource.dashboard) {
        throw new Error("Latest dashboard document was not found in Cosmos DB.");
      }
      return resource.dashboard;
    },
    async listAlerts() {
      const container = await getCosmosContainer(config);
      const query = {
        query: "SELECT c.alert FROM c WHERE c.pk = @pk ORDER BY c.updated_at DESC",
        parameters: [{ name: "@pk", value: "alert" }],
      };
      const { resources } = await container.items.query(query).fetchAll();
      return resources.map((item) => item.alert).filter(Boolean);
    },
    async reserveManualRunQuota(options) {
      const container = await getCosmosContainer(config);
      return reserveCosmosManualRunQuota(container, options);
    },
  };
}

export async function reserveLocalManualRunQuota({
  outputDir = path.join(process.cwd(), "outputs", "latest"),
  limit = 20,
  now = new Date(),
  timeZone = "Asia/Tokyo",
} = {}) {
  await mkdir(outputDir, { recursive: true });
  const day = dayKey(now, timeZone);
  const quotaPath = path.join(outputDir, MANUAL_RUN_QUOTA_FILE);
  let state = {};
  try {
    state = JSON.parse(await readFile(quotaPath, "utf8"));
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }

  const used = Number(state[day]?.used || 0);
  if (used >= limit) {
    return quotaResult({ allowed: false, day, used, limit });
  }
  const next = { ...state, [day]: { day, used: used + 1, updated_at: now.toISOString() } };
  await writeFile(quotaPath, JSON.stringify(next, null, 2), "utf8");
  return quotaResult({ allowed: true, day, used: used + 1, limit });
}

async function reserveCosmosManualRunQuota(container, {
  limit = 20,
  now = new Date(),
  timeZone = "Asia/Tokyo",
} = {}) {
  const day = dayKey(now, timeZone);
  const id = `manual-run-quota-${day}`;
  let doc = { id, pk: "quota", type: "manual-run-quota", day, used: 0 };
  try {
    const { resource } = await container.item(id, "quota").read();
    if (resource) doc = resource;
  } catch (error) {
    if (!error || error.code !== 404) throw error;
  }

  const used = Number(doc.used || 0);
  if (used >= limit) {
    return quotaResult({ allowed: false, day, used, limit });
  }

  const next = {
    ...doc,
    used: used + 1,
    limit,
    updated_at: now.toISOString(),
  };
  await container.items.upsert(next);
  return quotaResult({ allowed: true, day, used: used + 1, limit });
}

function quotaResult({ allowed, day, used, limit }) {
  return {
    allowed,
    day,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

function dayKey(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now instanceof Date ? now : new Date(now));
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function getCosmosContainer(config) {
  if (!cosmosDbConfigured()) {
    throw new Error("Cosmos DB is not configured. Set COSMOS_DB_ENDPOINT and use managed identity or COSMOS_DB_KEY.");
  }

  const { CosmosClient } = await import("@azure/cosmos");
  let client;
  if (config.useAad) {
    const { DefaultAzureCredential } = await import("@azure/identity");
    client = new CosmosClient({
      endpoint: config.endpoint,
      aadCredentials: new DefaultAzureCredential(),
    });
  } else {
    client = new CosmosClient({
      endpoint: config.endpoint,
      key: config.key,
    });
  }

  return client.database(config.databaseId).container(config.containerId);
}

export async function loadLatestDashboardData({ outputDir = path.join(process.cwd(), "outputs", "latest") } = {}) {
  const content = await readFile(path.join(outputDir, DASHBOARD_FILE), "utf8");
  return JSON.parse(content);
}

export async function loadAlertHistory({ outputDir = path.join(process.cwd(), "outputs", "latest") } = {}) {
  try {
    const content = await readFile(path.join(outputDir, ALERT_HISTORY_FILE), "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function appendAlertHistory({ outputDir, assessment }) {
  const historyPath = path.join(outputDir, ALERT_HISTORY_FILE);
  const history = await loadAlertHistory({ outputDir });

  const nextHistory = [
    ...history.filter((item) => item.alert_id !== assessment.alert_id),
    buildAlertHistoryItem(assessment),
  ];

  await writeFile(historyPath, JSON.stringify(nextHistory, null, 2), "utf8");
}

function buildAlertHistoryItem(assessment) {
  return {
    alert_id: assessment.alert_id,
    material: assessment.material,
    risk_score: assessment.risk_score,
    severity: assessment.severity,
    status: "open",
    generated_at: assessment.generated_at,
    impacted_products: assessment.impacted_products,
    impacted_customers: assessment.impacted_customers,
  };
}
