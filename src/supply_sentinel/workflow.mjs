import path from "node:path";
import { loadSampleData } from "./ingestion.mjs";
import { extractRiskEvent } from "./aiClient.mjs";
import { assessImpact } from "./impactEngine.mjs";
import { buildRouteIntelligence } from "./routeEngine.mjs";
import { writeTeamsAlert } from "./alertWriter.mjs";
import { writeManagementReport } from "./reportWriter.mjs";
import { writeDashboardHtml } from "./dashboardWriter.mjs";
import { createStateStore } from "./stateStore.mjs";

export async function runSupplySentinel({
  rootDir = process.cwd(),
  outputDir = path.join(rootDir, "outputs", "latest"),
  stateStore,
} = {}) {
  const data = await loadSampleData(rootDir);
  const riskEvent = await extractRiskEvent(data);
  const assessment = assessImpact(riskEvent, data);
  const routeIntel = buildRouteIntelligence(riskEvent, data);
  const teamsAlert = writeTeamsAlert(assessment);
  const managementReport = writeManagementReport(assessment);
  const dashboardHtml = writeDashboardHtml(assessment);
  const dashboardData = buildDashboardModel({ riskEvent, assessment, routeIntel, materials: data.materials });
  const store = stateStore || createStateStore({ outputDir });

  await store.saveRun({
    riskEvent,
    assessment,
    teamsAlert,
    managementReport,
    dashboardHtml,
    dashboardData,
  });

  return {
    riskEvent,
    assessment,
    routeIntel,
    teamsAlert,
    managementReport,
    dashboardHtml,
    dashboardData,
    outputDir,
  };
}

// Consolidated model consumed by the interactive map dashboard (web/).
export function buildDashboardModel({ riskEvent, assessment, routeIntel, materials = [] }) {
  return {
    meta: {
      app: "Supply Sentinel",
      scenario: `${riskEvent.material} supply risk`,
      generated_at: assessment.generated_at,
      // Material master enables data-driven multi-material monitoring (docs/13 §4.1, §10).
      materials,
    },
    risk_event: riskEvent,
    assessment,
    route_intel: routeIntel,
  };
}
