import path from "node:path";
import { loadSampleData } from "./ingestion.mjs";
import { extractRiskEvent } from "./riskExtraction.mjs";
import { assessImpact } from "./impactEngine.mjs";
import { buildRouteIntelligence } from "./routeEngine.mjs";
import { writeTeamsAlert } from "./alertWriter.mjs";
import { writeManagementReport } from "./reportWriter.mjs";
import { writeDashboardHtml } from "./dashboardWriter.mjs";
import { saveRunArtifacts } from "./stateStore.mjs";

export async function runSupplySentinel({ rootDir = process.cwd(), outputDir = path.join(rootDir, "outputs", "latest") } = {}) {
  const data = await loadSampleData(rootDir);
  const riskEvent = extractRiskEvent(data);
  const assessment = assessImpact(riskEvent, data);
  const routeIntel = buildRouteIntelligence(riskEvent, data);
  const teamsAlert = writeTeamsAlert(assessment);
  const managementReport = writeManagementReport(assessment);
  const dashboardHtml = writeDashboardHtml(assessment);
  const dashboardData = buildDashboardModel({ riskEvent, assessment, routeIntel });

  await saveRunArtifacts({
    outputDir,
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
export function buildDashboardModel({ riskEvent, assessment, routeIntel }) {
  return {
    meta: {
      app: "Supply Sentinel",
      scenario: `${riskEvent.material} supply risk`,
      generated_at: assessment.generated_at,
    },
    risk_event: riskEvent,
    assessment,
    route_intel: routeIntel,
  };
}
