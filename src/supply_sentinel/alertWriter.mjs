export function writeTeamsAlert(assessment) {
  return [
    "# [Supply Sentinel] High supply risk detected",
    "",
    `Material: ${assessment.material}`,
    `Risk score: ${assessment.risk_score}/100`,
    `Severity: ${assessment.severity.toUpperCase()}`,
    `Estimated minimum inventory days: ${formatNullable(assessment.inventory_days_min)}`,
    `Affected period: ${assessment.affected_period}`,
    "",
    "## Impact",
    `- Products: ${joinOrNone(assessment.impacted_products)}`,
    `- Customers: ${joinOrNone(assessment.impacted_customers)}`,
    `- Plants: ${joinOrNone(assessment.impacted_plants)}`,
    "",
    "## Evidence",
    ...assessment.evidence.map((item) => `- ${item}`),
    "",
    "## Recommended First Actions",
    ...assessment.recommended_actions.map((item) => `- ${item}`),
    "",
    "## Human Approval Required",
    ...assessment.approval_required.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function joinOrNone(values) {
  return values.length ? values.join(", ") : "None";
}

function formatNullable(value) {
  return value == null ? "Unknown" : String(value);
}
