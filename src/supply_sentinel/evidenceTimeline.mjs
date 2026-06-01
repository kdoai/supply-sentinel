const RISK_KEYWORDS = [
  { pattern: /shutdown|outage|fire|explosion|halt|stoppage|停止|火災|事故/i, points: 16, label: "停止・事故シグナル" },
  { pattern: /allocation|shortage|tight|supply crunch|供給不足|逼迫|割当/i, points: 14, label: "供給逼迫シグナル" },
  { pattern: /delay|disruption|congestion|strike|遅延|混乱|ストライキ|滞留/i, points: 11, label: "物流・供給遅延シグナル" },
  { pattern: /price|surge|spike|rally|価格|急騰|上昇/i, points: 8, label: "価格上昇シグナル" },
];

export function buildEvidenceTimeline({ provenance = [], assessment = {}, riskEvent = {}, materials = [] } = {}) {
  const sources = provenance
    .filter((source) => isPublicLiveSource(source))
    .map((source) => enrichSource(source, materials))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.published_at || a.fetched_at || 0) - Date.parse(b.published_at || b.fetched_at || 0));

  if (!sources.length) return [];

  const currentScore = clamp(Number(assessment.risk_score) || 0, 0, 100);
  const baseScore = clamp(Math.min(currentScore - 8, Math.max(18, currentScore - 42)), 0, 100);
  const totalWeight = sources.reduce((sum, source) => sum + source.timeline_weight, 0) || sources.length;
  let cumulative = 0;

  return sources.map((source, index) => {
    const before = index === 0
      ? baseScore
      : Math.round(baseScore + ((currentScore - baseScore) * cumulative) / totalWeight);
    cumulative += source.timeline_weight;
    const after = index === sources.length - 1
      ? currentScore
      : Math.round(baseScore + ((currentScore - baseScore) * cumulative) / totalWeight);

    return {
      id: source.id || `evidence-${index + 1}`,
      sequence: index + 1,
      material: source.material || riskEvent.material || assessment.material || "unknown",
      material_label: source.material_label || source.material || riskEvent.material || assessment.material || "監視対象",
      source: source.source || "公開Web",
      title: source.claim || source.label || "公開記事",
      claim: source.claim || "",
      url: source.url,
      published_at: source.published_at || null,
      fetched_at: source.fetched_at || null,
      score_before: before,
      score_after: after,
      score_delta: after - before,
      signal: source.signal_label,
      reason: `${source.material_label || source.material || "監視対象"}に関する${source.signal_label}を検知。公開URL付き記事として保存し、在庫/BOM照合の再評価対象に追加。`,
      impact_snapshot: {
        risk_score: currentScore,
        affected_supply_ratio: assessment.affected_supply_ratio ?? null,
        inventory_days_min: assessment.inventory_days_min ?? null,
        impacted_products: Array.isArray(assessment.impacted_products) ? assessment.impacted_products.slice(0, 5) : [],
        impacted_customers: Array.isArray(assessment.impacted_customers) ? assessment.impacted_customers.slice(0, 5) : [],
      },
    };
  });
}

function isPublicLiveSource(source) {
  return source?.origin === "live_web" && /^https?:\/\//i.test(String(source.url || ""));
}

function enrichSource(source, materials) {
  const text = `${source.claim || ""} ${source.raw_excerpt || ""}`.toLowerCase();
  const matchedMaterial = matchMaterial(text, materials);
  const signal = matchSignal(text);
  const confidencePoints = String(source.confidence || "").toLowerCase() === "high" ? 4 : 0;
  return {
    ...source,
    material: matchedMaterial.id || source.material || "unknown",
    material_label: matchedMaterial.label || source.material || "監視対象",
    signal_label: signal.label,
    timeline_weight: Math.max(4, signal.points + confidencePoints),
  };
}

function matchMaterial(text, materials) {
  for (const material of Array.isArray(materials) ? materials : []) {
    const id = material.material_id || material.id || material.material || "";
    const label = material.display_name || material.label || material.name || id;
    const candidates = [
      id,
      label,
      ...(Array.isArray(material.aliases) ? material.aliases : []),
      ...(Array.isArray(material.monitoring_keywords) ? material.monitoring_keywords : []),
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    if (candidates.some((candidate) => candidate && text.includes(candidate))) {
      return { id, label };
    }
  }
  return { id: "", label: "" };
}

function matchSignal(text) {
  for (const item of RISK_KEYWORDS) {
    if (item.pattern.test(text)) return item;
  }
  return { points: 6, label: "供給リスク関連シグナル" };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
