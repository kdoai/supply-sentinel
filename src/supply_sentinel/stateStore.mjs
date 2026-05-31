import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cosmosDbConfigured, stateStoreMode } from "./config.mjs";

const DASHBOARD_FILE = "dashboard_data.json";
const ALERT_HISTORY_FILE = "alert_history.json";

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
  };
}

export function createCosmosStateStore() {
  return {
    kind: "cosmos",
    configured: cosmosDbConfigured(),
    async saveRun() {
      throw new Error("Cosmos DB state store is a cloud boundary stub in the local build.");
    },
    async getLatestDashboard() {
      throw new Error("Cosmos DB state store is a cloud boundary stub in the local build.");
    },
    async listAlerts() {
      throw new Error("Cosmos DB state store is a cloud boundary stub in the local build.");
    },
  };
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
    {
      alert_id: assessment.alert_id,
      material: assessment.material,
      risk_score: assessment.risk_score,
      severity: assessment.severity,
      status: "open",
      generated_at: assessment.generated_at,
      impacted_products: assessment.impacted_products,
      impacted_customers: assessment.impacted_customers,
    },
  ];

  await writeFile(historyPath, JSON.stringify(nextHistory, null, 2), "utf8");
}
