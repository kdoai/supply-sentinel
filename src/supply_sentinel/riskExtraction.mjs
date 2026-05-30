const RISK_TYPE_PATTERNS = [
  ["allocation", /allocation|割当|供給制限/i],
  ["supply_delay", /delay|delayed|遅延|納期/i],
  ["shutdown", /shutdown|停止|halt/i],
  ["logistics_delay", /vessel|logistics|congestion|物流|船/i],
  ["price_spike", /price|価格|急騰/i],
];

export function extractRiskEvent({ newsEvents, supplierNotices }) {
  const news = newsEvents[0] ?? {};
  const notice = supplierNotices[0] ?? {};
  const combinedText = [
    news.headline,
    news.summary,
    notice.subject,
    notice.body,
  ]
    .filter(Boolean)
    .join("\n");

  const material = normalizeMaterial(notice.body) ?? normalizeMaterial(combinedText) ?? news.material ?? "unknown";
  const delay = extractDelayDays(combinedText);
  const allocationRate = extractAllocationRate(combinedText);
  const riskType = detectRiskType(combinedText);
  const severity = determineSeverity({ news, delay, allocationRate, riskType });

  return {
    material,
    risk_type: riskType,
    region: news.region ?? null,
    affected_period: extractAffectedPeriod(combinedText) ?? "next 2-3 weeks",
    delay_days_min: delay.min,
    delay_days_max: delay.max,
    allocation_rate_percent: allocationRate,
    severity,
    confidence: notice.body ? "high" : "medium",
    evidence: buildEvidence({ news, notice, delay, allocationRate }),
    summary: buildSummary({ material, delay, allocationRate }),
    sources: {
      news_id: news.id ?? null,
      supplier_notice_id: notice.id ?? null,
    },
  };
}

function normalizeMaterial(text = "") {
  const lower = text.toLowerCase();
  if (lower.includes("naphtha")) {
    return "naphtha";
  }
  if (lower.includes("packaging")) {
    return "packaging-film";
  }
  if (lower.includes("adhesive")) {
    return "semiconductor-adhesive";
  }
  return null;
}

function detectRiskType(text) {
  const matchedTypes = RISK_TYPE_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([type]) => type);

  if (matchedTypes.includes("allocation")) {
    return "allocation";
  }
  if (matchedTypes.includes("supply_delay")) {
    return "supply_delay";
  }
  return matchedTypes[0] ?? "unknown";
}

function extractDelayDays(text) {
  const match = text.match(/(\d+)\s*(?:to|-)\s*(\d+)\s*days?/i);
  if (!match) {
    return { min: 0, max: 0 };
  }
  return {
    min: Number(match[1]),
    max: Number(match[2]),
  };
}

function extractAllocationRate(text) {
  const match = text.match(/(\d+)\s*%\s+of normal/i);
  if (!match) {
    return 100;
  }
  return Number(match[1]);
}

function extractAffectedPeriod(text) {
  const match = text.match(/next\s+([a-z0-9\s-]+?weeks?)/i);
  return match ? `next ${match[1].trim()}` : null;
}

function determineSeverity({ news, delay, allocationRate, riskType }) {
  if (riskType === "shutdown") {
    return "critical";
  }
  if (allocationRate <= 70 || delay.max >= 7 || news.severity_hint === "high") {
    return "high";
  }
  if (delay.max > 0 || allocationRate < 100) {
    return "medium";
  }
  return "low";
}

function buildEvidence({ news, notice, delay, allocationRate }) {
  const evidence = [];
  if (news.headline) {
    evidence.push(`News headline: ${news.headline}`);
  }
  if (delay.max > 0) {
    evidence.push(`Supplier notice indicates ${delay.min}-${delay.max} day shipment delay.`);
  }
  if (allocationRate < 100) {
    evidence.push(`Supplier notice indicates allocation may be limited to ${allocationRate}% of normal volume.`);
  }
  if (notice.subject) {
    evidence.push(`Supplier notice subject: ${notice.subject}`);
  }
  return evidence;
}

function buildSummary({ material, delay, allocationRate }) {
  const parts = [`${material} supply risk detected`];
  if (delay.max > 0) {
    parts.push(`expected delay ${delay.min}-${delay.max} days`);
  }
  if (allocationRate < 100) {
    parts.push(`allocation may be ${allocationRate}% of normal volume`);
  }
  return `${parts.join("; ")}.`;
}
