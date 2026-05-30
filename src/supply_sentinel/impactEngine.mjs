import { calculateRiskScore, severityFromScore } from "./scoring.mjs";

export function assessImpact(riskEvent, data) {
  const material = riskEvent.material;
  const impactedBomRows = data.bom.filter((row) => sameKey(row.material, material));
  const impactedProducts = unique(impactedBomRows.map((row) => row.product));
  const impactedOrders = data.orders.filter((order) => impactedProducts.includes(order.product));
  const impactedPlants = unique(impactedOrders.map((order) => order.plant));
  const inventoryRows = data.inventory.filter((row) => sameKey(row.material, material));
  const inventoryAssessments = inventoryRows.map((row) => ({
    material: row.material,
    plant: row.plant,
    stock_qty: row.stock_qty,
    daily_usage: row.daily_usage,
    unit: row.unit,
    days_of_supply: round(row.stock_qty / row.daily_usage, 1),
  }));
  const inventoryDaysMin = inventoryAssessments.length
    ? Math.min(...inventoryAssessments.map((row) => row.days_of_supply))
    : null;
  const alternatives = data.alternatives.filter((row) => sameKey(row.material, material));
  const approvedAlternatives = alternatives.filter((row) => row.approved === true);
  const scoring = calculateRiskScore({
    riskEvent,
    inventoryDaysMin,
    impactedOrders,
    approvedAlternatives,
  });

  return {
    alert_id: buildAlertId(riskEvent),
    material,
    risk_type: riskEvent.risk_type,
    risk_score: scoring.score,
    severity: severityFromScore(scoring.score),
    source_severity: riskEvent.severity,
    confidence: riskEvent.confidence,
    scoring_factors: scoring.factors,
    affected_period: riskEvent.affected_period,
    delay_days_min: riskEvent.delay_days_min,
    delay_days_max: riskEvent.delay_days_max,
    allocation_rate_percent: riskEvent.allocation_rate_percent,
    inventory_days_min: inventoryDaysMin,
    inventory: inventoryAssessments,
    impacted_products: impactedProducts,
    impacted_customers: unique(impactedOrders.map((order) => order.customer)),
    impacted_plants: impactedPlants,
    impacted_orders: impactedOrders,
    alternatives,
    approved_alternatives: approvedAlternatives,
    evidence: riskEvent.evidence,
    recommended_actions: recommendActions({
      riskEvent,
      impactedOrders,
      inventoryDaysMin,
      approvedAlternatives,
    }),
    approval_required: [
      "Purchase order changes",
      "Supplier switching",
      "Formal customer notification",
      "Major production plan changes",
    ],
    generated_at: new Date().toISOString(),
  };
}

function recommendActions({ riskEvent, impactedOrders, inventoryDaysMin, approvedAlternatives }) {
  const actions = [];
  actions.push("Confirm latest allocation volume and shipment schedule with the supplier.");

  if (inventoryDaysMin != null && inventoryDaysMin <= 7) {
    actions.push("Reserve available inventory for high-priority orders and plants.");
  }

  if (approvedAlternatives.length > 0) {
    const names = approvedAlternatives.map((alternative) => alternative.alternative_material).join(", ");
    actions.push(`Check applicability of approved alternative material: ${names}.`);
  } else {
    actions.push("Start emergency review for alternative material or secondary supplier options.");
  }

  if (impactedOrders.some((order) => order.priority === "high")) {
    actions.push("Prepare customer communication draft for high-priority customers.");
  }

  if (riskEvent.delay_days_max > 0) {
    actions.push(`Assess production schedule exposure against the ${riskEvent.delay_days_min}-${riskEvent.delay_days_max} day delay window.`);
  }

  return actions;
}

function sameKey(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildAlertId(riskEvent) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const material = String(riskEvent.material).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `alert-${date}-${material}`;
}
