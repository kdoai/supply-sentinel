import test from "node:test";
import assert from "node:assert/strict";
import { loadSampleData } from "../src/supply_sentinel/ingestion.mjs";
import { extractRiskEvent } from "../src/supply_sentinel/riskExtraction.mjs";
import { buildRouteIntelligence } from "../src/supply_sentinel/routeEngine.mjs";

test("buildRouteIntelligence flags Asian naphtha routes and keeps the Middle East route resilient", async () => {
  const data = await loadSampleData();
  const riskEvent = extractRiskEvent(data);
  const intel = buildRouteIntelligence(riskEvent, data);

  assert.equal(intel.focal_material, "naphtha");
  assert.equal(intel.kpis.total_routes, 4);
  assert.equal(intel.kpis.affected_routes, 3);
  assert.equal(intel.kpis.resilient_routes, 1);
  assert.equal(intel.kpis.affected_share_percent, 65);
  assert.equal(intel.kpis.monthly_spend_at_risk, 7800000);
  assert.equal(intel.kpis.total_monthly_spend, 12000000);

  const middleEast = intel.routes.find((route) => route.route_id === "R-NAP-01");
  assert.equal(middleEast.status, "resilient");
  assert.equal(middleEast.affected, false);

  // Non-focal materials must never be marked affected by a naphtha event.
  const otherMaterialAffected = intel.routes.some(
    (route) => route.material !== "naphtha" && route.affected,
  );
  assert.equal(otherMaterialAffected, false);

  // Flow spans upstream origin (stage 0) through downstream customer (stage 4).
  const stages = new Set(intel.flow.nodes.map((node) => node.stage));
  assert.ok([0, 1, 2, 3, 4].every((stage) => stages.has(stage)));
});
