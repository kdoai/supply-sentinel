import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
    files["dashboard_data.json"] = JSON.stringify(dashboardData, null, 2);
  }

  await Promise.all(
    Object.entries(files).map(([fileName, content]) =>
      writeFile(path.join(outputDir, fileName), content, "utf8"),
    ),
  );

  await appendAlertHistory({ outputDir, assessment });
}

async function appendAlertHistory({ outputDir, assessment }) {
  const historyPath = path.join(outputDir, "alert_history.json");
  let history = [];
  try {
    history = JSON.parse(await readFile(historyPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

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
