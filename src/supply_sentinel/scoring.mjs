const SEVERITY_POINTS = {
  low: 6,
  medium: 15,
  high: 25,
  critical: 30,
};

const CONFIDENCE_POINTS = {
  low: 6,
  medium: 12,
  high: 18,
};

export function calculateRiskScore({ riskEvent, inventoryDaysMin, impactedOrders, approvedAlternatives }) {
  const factors = {
    external_event_severity: SEVERITY_POINTS[riskEvent.severity] ?? 0,
    supplier_notice_confidence: CONFIDENCE_POINTS[riskEvent.confidence] ?? 0,
    inventory_days_risk: inventoryDaysPoints(inventoryDaysMin),
    customer_order_priority: customerPriorityPoints(impactedOrders),
    alternative_availability_risk: alternativeRiskPoints({ inventoryDaysMin, approvedAlternatives }),
  };

  const score = Object.values(factors).reduce((total, points) => total + points, 0);
  return {
    score: Math.min(score, 100),
    factors,
  };
}

function inventoryDaysPoints(days) {
  if (days == null) {
    return 0;
  }
  if (days <= 7) {
    return 25;
  }
  if (days <= 14) {
    return 15;
  }
  if (days <= 30) {
    return 8;
  }
  return 0;
}

function customerPriorityPoints(orders) {
  if (orders.some((order) => order.priority === "high")) {
    return 14;
  }
  if (orders.some((order) => order.priority === "medium")) {
    return 8;
  }
  if (orders.length > 0) {
    return 3;
  }
  return 0;
}

function alternativeRiskPoints({ inventoryDaysMin, approvedAlternatives }) {
  if (approvedAlternatives.length === 0) {
    return 10;
  }

  const fastestLeadTime = Math.min(...approvedAlternatives.map((alternative) => alternative.lead_time_days));
  if (fastestLeadTime <= inventoryDaysMin) {
    return 0;
  }

  return 0;
}

export function severityFromScore(score) {
  if (score >= 85) {
    return "critical";
  }
  if (score >= 70) {
    return "high";
  }
  if (score >= 45) {
    return "medium";
  }
  return "low";
}
