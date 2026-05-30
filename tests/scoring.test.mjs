import test from "node:test";
import assert from "node:assert/strict";
import { calculateRiskScore, severityFromScore } from "../src/supply_sentinel/scoring.mjs";

test("calculateRiskScore produces transparent factor totals", () => {
  const result = calculateRiskScore({
    riskEvent: {
      severity: "high",
      confidence: "high",
    },
    inventoryDaysMin: 5,
    impactedOrders: [{ priority: "high" }],
    approvedAlternatives: [{ alternative_material: "NAP-ALT-01", lead_time_days: 10 }],
  });

  assert.equal(result.score, 82);
  assert.deepEqual(result.factors, {
    external_event_severity: 25,
    supplier_notice_confidence: 18,
    inventory_days_risk: 25,
    customer_order_priority: 14,
    alternative_availability_risk: 0,
  });
});

test("severityFromScore maps alert thresholds", () => {
  assert.equal(severityFromScore(30), "low");
  assert.equal(severityFromScore(50), "medium");
  assert.equal(severityFromScore(82), "high");
  assert.equal(severityFromScore(90), "critical");
});
