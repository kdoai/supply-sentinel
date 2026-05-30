import test from "node:test";
import assert from "node:assert/strict";
import { loadSampleData } from "../src/supply_sentinel/ingestion.mjs";
import { extractRiskEvent } from "../src/supply_sentinel/riskExtraction.mjs";
import { assessImpact } from "../src/supply_sentinel/impactEngine.mjs";

test("assessImpact maps naphtha risk to products, customers, plants, and score", async () => {
  const data = await loadSampleData();
  const riskEvent = extractRiskEvent(data);
  const assessment = assessImpact(riskEvent, data);

  assert.equal(assessment.material, "naphtha");
  assert.equal(assessment.risk_score, 82);
  assert.equal(assessment.severity, "high");
  assert.deepEqual(assessment.impacted_products, ["Resin A", "Solvent B", "Coating C"]);
  assert.deepEqual(assessment.impacted_customers, ["Customer Alpha", "Customer Beta", "Customer Gamma"]);
  assert.deepEqual(assessment.impacted_plants, ["Chiba Plant", "Osaka Plant"]);
  assert.equal(assessment.inventory_days_min, 5);
  assert.equal(assessment.approved_alternatives.length, 1);
});
