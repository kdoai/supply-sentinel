export function writeManagementReport(assessment) {
  return [
    "# Supply Risk Report",
    "",
    "## Executive Summary",
    "",
    `Supply Sentinel detected a ${assessment.severity} supply risk for ${assessment.material}. The risk score is ${assessment.risk_score}/100, with minimum inventory coverage of ${assessment.inventory_days_min} days across the current sample data.`,
    "",
    "## Evidence",
    "",
    ...assessment.evidence.map((item) => `- ${item}`),
    "",
    "## Business Impact",
    "",
    `- Impacted products: ${joinOrNone(assessment.impacted_products)}`,
    `- Impacted customers: ${joinOrNone(assessment.impacted_customers)}`,
    `- Impacted plants: ${joinOrNone(assessment.impacted_plants)}`,
    `- Minimum inventory days: ${assessment.inventory_days_min}`,
    `- Allocation rate indicated by supplier: ${assessment.allocation_rate_percent}%`,
    `- Delay window: ${assessment.delay_days_min}-${assessment.delay_days_max} days`,
    "",
    "## Recommended Initial Actions",
    "",
    ...assessment.recommended_actions.map((item) => `- ${item}`),
    "",
    "## Decisions Requiring Approval",
    "",
    ...assessment.approval_required.map((item) => `- ${item}`),
    "",
    "## Scoring Basis",
    "",
    ...Object.entries(assessment.scoring_factors).map(([name, points]) => `- ${name}: ${points}`),
    "",
    "## Next Monitoring Point",
    "",
    "Re-check supplier allocation status and unresolved high-priority customer exposure on the next scheduled run.",
    "",
  ].join("\n");
}

function joinOrNone(values) {
  return values.length ? values.join(", ") : "None";
}
