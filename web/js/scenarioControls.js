import { computeMetrics } from "./propagation.js";
import {
  calculatePolicyImpactScore,
  classifyImpact,
  normalizePolicy,
  priorityScore,
} from "./companyPolicy.js";

export const MATERIAL_OPTIONS = [
  { value: "naphtha", label: "ナフサ", spend_factor: 1, exposure_factor: 1 },
  { value: "pp", label: "PP", spend_factor: 0.68, exposure_factor: 0.72 },
  { value: "pe", label: "PE", spend_factor: 0.63, exposure_factor: 0.68 },
  { value: "abs", label: "ABS", spend_factor: 0.45, exposure_factor: 0.62 },
  { value: "packaging-film", label: "包装フィルム", spend_factor: 0.3, exposure_factor: 0.52 },
  { value: "semiconductor-adhesive", label: "半導体接着材", spend_factor: 0.4, exposure_factor: 0.46 },
  { value: "other-petrochemical", label: "その他石化素材", spend_factor: 0.25, exposure_factor: 0.35 },
];

export const DURATION_OPTIONS = [
  { value: "7", label: "1週間", days: 7 },
  { value: "14", label: "2週間", days: 14 },
  { value: "30", label: "1か月", days: 30 },
  { value: "90", label: "3か月", days: 90 },
];

export const IMPACT_NODE_OPTIONS = [
  { value: "refinery", label: "製油所", factor: 1 },
  { value: "tier2", label: "Tier2サプライヤー", factor: 0.9 },
  { value: "tier1", label: "Tier1サプライヤー", factor: 0.84 },
  { value: "port", label: "港湾", factor: 0.72 },
  { value: "plant", label: "自社工場", factor: 0.8 },
];

export const ALTERNATIVE_ROUTE_OPTIONS = [
  { value: "available", label: "あり", factor: 0.65 },
  { value: "partial", label: "一部あり", factor: 1 },
  { value: "none", label: "なし", factor: 1.15 },
];

export const DEMAND_POLICY_OPTIONS = [
  { value: "protect_priority_customers", label: "高優先顧客を守る" },
  { value: "maximize_revenue", label: "売上最大化" },
  { value: "prioritize_continuity", label: "生産継続優先" },
  { value: "fair_allocation", label: "全顧客均等配分" },
];

export const DEFAULT_SCENARIO_INPUT = {
  material: "naphtha",
  supplyReductionPercent: 30,
  durationDays: 14,
  impactNode: "refinery",
  alternativeRoute: "partial",
  demandPolicy: "protect_priority_customers",
};

export const HUMAN_APPROVAL_CATALOG = [
  { id: "allocation", label: "供給配分判断", owner: "SCM責任者", reason: "顧客・製品間の供給配分に影響するため" },
  { id: "purchase_order", label: "発注変更", owner: "調達部長", reason: "発注量・納期・価格条件を変更するため" },
  { id: "supplier_switching", label: "サプライヤ切替", owner: "調達部長 / 品質保証", reason: "品質・契約・供給安定性の確認が必要なため" },
  { id: "customer_notice", label: "顧客への正式通知", owner: "営業責任者", reason: "対外コミュニケーションとして承認が必要なため" },
  { id: "production_plan", label: "生産計画変更", owner: "生産管理責任者", reason: "工場負荷・納期・在庫引当に影響するため" },
  { id: "reduction", label: "縮小判断", owner: "SCM責任者 / 事業責任者", reason: "製品・顧客優先順位に関わるため" },
  { id: "alternative_approval", label: "代替材承認プロセス開始", owner: "品質保証 / 技術", reason: "顧客承認・品質確認が必要なため" },
];

const DEMO_PRODUCTS = [
  {
    id: "resin-a",
    product_name: "樹脂A",
    materials: ["naphtha", "pp", "pe", "abs"],
    impact_material_label: "ナフサ / PP / PE",
    supplier: "デモ石化サプライヤ",
    tier: "Tier1 / Tier2: Jurong原料トレーダー",
    plant: "千葉工場",
    customer: "自動車部品A社",
    customer_priority: "high",
    base_inventory_days: 5,
    monthly_revenue_usd: 4_200_000,
    alternative_status: "一部承認済み",
    alternative_materials: ["NAP-ALT-01"],
    single_supplier_dependency: true,
    material_dependency: { naphtha: 1, pp: 0.75, pe: 0.65, abs: 0.55 },
  },
  {
    id: "solvent-b",
    product_name: "溶剤B",
    materials: ["naphtha", "pp"],
    impact_material_label: "ナフサ / PP",
    supplier: "デモ石化サプライヤ",
    tier: "Tier1",
    plant: "千葉工場",
    customer: "包装材B社",
    customer_priority: "high",
    base_inventory_days: 8,
    monthly_revenue_usd: 2_900_000,
    alternative_status: "未承認",
    alternative_materials: ["NAP-ALT-02"],
    single_supplier_dependency: true,
    material_dependency: { naphtha: 0.9, pp: 0.62 },
  },
  {
    id: "coating-c",
    product_name: "コーティングC",
    materials: ["naphtha", "semiconductor-adhesive"],
    impact_material_label: "ナフサ / 半導体接着材",
    supplier: "韓美ケム / サイアム原料",
    tier: "Tier1",
    plant: "大阪工場",
    customer: "化学品C社",
    customer_priority: "medium",
    base_inventory_days: 10,
    monthly_revenue_usd: 5_200_000,
    alternative_status: "承認済み",
    alternative_materials: ["NAP-ALT-01"],
    single_supplier_dependency: false,
    material_dependency: { naphtha: 0.7, "semiconductor-adhesive": 0.8 },
  },
  {
    id: "packaging-d",
    product_name: "包装フィルムD",
    materials: ["packaging-film", "pe", "pp"],
    impact_material_label: "包装フィルム / PE / PP",
    supplier: "台湾フィルムサプライヤ",
    tier: "Tier1 / 原反メーカー",
    plant: "大阪工場",
    customer: "消費財D社",
    customer_priority: "medium",
    base_inventory_days: 18,
    monthly_revenue_usd: 1_400_000,
    alternative_status: "一部承認済み",
    alternative_materials: ["FILM-ALT-01"],
    single_supplier_dependency: true,
    material_dependency: { "packaging-film": 1, pe: 0.85, pp: 0.6 },
  },
  {
    id: "adhesive-e",
    product_name: "電子接着材E",
    materials: ["semiconductor-adhesive", "abs"],
    impact_material_label: "半導体接着材 / ABS",
    supplier: "欧州電子材料サプライヤ",
    tier: "Tier1 / 化学メーカー",
    plant: "千葉工場",
    customer: "精密機器E社",
    customer_priority: "high",
    base_inventory_days: 12,
    monthly_revenue_usd: 2_200_000,
    alternative_status: "未承認",
    alternative_materials: ["ADH-ALT-03"],
    single_supplier_dependency: true,
    material_dependency: { "semiconductor-adhesive": 1, abs: 0.48 },
  },
];

export function normalizeScenarioInput(input = {}) {
  const material = optionValue(MATERIAL_OPTIONS, input.material, DEFAULT_SCENARIO_INPUT.material);
  return {
    material,
    supplyReductionPercent: clamp(Math.round(numberOr(input.supplyReductionPercent, 30)), 0, 100),
    durationDays: numberOr(input.durationDays, DEFAULT_SCENARIO_INPUT.durationDays),
    impactNode: optionValue(IMPACT_NODE_OPTIONS, input.impactNode, DEFAULT_SCENARIO_INPUT.impactNode),
    alternativeRoute: optionValue(
      ALTERNATIVE_ROUTE_OPTIONS,
      input.alternativeRoute,
      DEFAULT_SCENARIO_INPUT.alternativeRoute,
    ),
    demandPolicy: optionValue(DEMAND_POLICY_OPTIONS, input.demandPolicy, DEFAULT_SCENARIO_INPUT.demandPolicy),
  };
}

export function scenarioInputFromForm(formData) {
  if (!formData || typeof formData.get !== "function") return { ...DEFAULT_SCENARIO_INPUT };
  return normalizeScenarioInput({
    material: formData.get("material"),
    supplyReductionPercent: formData.get("supply_reduction"),
    durationDays: formData.get("duration_days"),
    impactNode: formData.get("impact_node"),
    alternativeRoute: formData.get("alternative_route"),
    demandPolicy: formData.get("demand_policy"),
  });
}

export function calculateScenarioDecisionModel({ scenario = {}, scenarioInput = {}, companyPolicy = {} } = {}) {
  const input = normalizeScenarioInput(scenarioInput);
  const policy = normalizePolicy(companyPolicy);
  const disruption = buildDisruption(scenario, input);
  const engine = scenario.network
    ? computeMetrics(scenario.network, disruption, {
        inventory: scenario.inventory || [],
        alternatives: scenario.alternatives || [],
        risk_inputs: scenario.risk_inputs || {},
      })
    : { metrics: {} };

  const material = materialMeta(input.material);
  const node = optionMeta(IMPACT_NODE_OPTIONS, input.impactNode);
  const route = optionMeta(ALTERNATIVE_ROUTE_OPTIONS, input.alternativeRoute);
  const baseAffectedRatio = numberOr(engine.metrics?.affected_supply_ratio, 65);
  const totalSpend = Math.round(numberOr(engine.metrics?.total_spend_usd, 12_000_000) * material.spend_factor);
  const remainingSupplyRatio = Math.max(0, 100 - input.supplyReductionPercent);
  const earlyPreparationThreshold = policy.early_preparation_trigger.remaining_supply_ratio_percent_below;
  const earlyPreparationTriggered = remainingSupplyRatio < earlyPreparationThreshold;
  const affectedSupplyRatio = Math.round(
    clamp(baseAffectedRatio * (input.supplyReductionPercent / 30) * material.exposure_factor * node.factor * route.factor, 0, 100),
  );
  const spendAtRisk = Math.round(totalSpend * (affectedSupplyRatio / 100));

  const productImpactTable = buildProductImpactTable({
    input,
    policy,
    affectedSupplyRatio,
    totalSpend,
  });
  const affectedProducts = productImpactTable.filter((row) => row.is_affected);
  const inventoryDaysMin = affectedProducts.length
    ? Math.min(...affectedProducts.map((row) => row.inventory_days))
    : null;
  const impactedCustomers = unique(affectedProducts.map((row) => row.customer));
  const impactedPlants = unique(affectedProducts.map((row) => row.plant));

  const humanApprovalItems = buildHumanApprovalItems(
    affectedProducts,
    policy,
    affectedSupplyRatio,
    earlyPreparationTriggered,
  );
  const alertLevel = classifyImpact(
    {
      inventory_days_min: inventoryDaysMin ?? 999,
      affected_supply_ratio_percent: affectedSupplyRatio,
    },
    policy,
  );
  const policyImpactScore = calculatePolicyImpactScore(
    {
      inventory_days_min: inventoryDaysMin ?? 999,
      affected_supply_ratio_percent: affectedSupplyRatio,
      human_approval_count: humanApprovalItems.length,
    },
    policy,
  );

  const protectedProducts = affectedProducts
    .filter((row) => row.recommended_decision === "維持" || (row.customer_priority === "高" && row.priority_score >= 70))
    .slice(0, 3);
  const reductionCandidates = affectedProducts
    .filter((row) => row.recommended_decision === "縮小")
    .slice(0, 3);
  const allocationCandidates = affectedProducts
    .filter((row) => row.recommended_decision === "供給配分" || row.inventory_days <= policy.thresholds.stop_or_allocation_decision.min_inventory_days)
    .slice(0, 4);
  const alternativeApprovalItems = affectedProducts
    .filter((row) => row.alternative_status !== "承認済み")
    .flatMap((row) => row.alternative_materials.map((materialId) => ({ product_name: row.product_name, material_id: materialId, status: row.alternative_status })));
  const inventoryBuildItems = affectedProducts
    .filter((row) => row.inventory_days <= policy.thresholds.attention.min_inventory_days)
    .map((row) => ({ product_name: row.product_name, plant: row.plant, inventory_days: row.inventory_days }));
  const supplierDiversificationItems = affectedProducts
    .filter((row) => row.single_supplier_dependency)
    .map((row) => ({ product_name: row.product_name, supplier: row.affected_supplier, tier: row.supplier_tier }));

  return {
    scenario_input: input,
    scenario_label: scenario.label || "デモ供給制約シナリオ",
    policy,
    scenario_basis: summarizeScenarioBasis(scenario.provenance || []),
    calculated_metrics: {
      policy_name: policy.company_policy_name,
      material: material.label,
      supply_reduction_percent: input.supplyReductionPercent,
      remaining_supply_ratio_percent: remainingSupplyRatio,
      duration_days: input.durationDays,
      affected_supply_ratio_percent: affectedSupplyRatio,
      spend_at_risk_usd: spendAtRisk,
      total_spend_usd: totalSpend,
      impacted_product_count: affectedProducts.length,
      impacted_customer_count: impactedCustomers.length,
      impacted_plant_count: impactedPlants.length,
      inventory_days_min: inventoryDaysMin,
      policy_impact_score: policyImpactScore,
      alert_level: alertLevel,
      early_preparation_threshold_percent: earlyPreparationThreshold,
      early_preparation_triggered: earlyPreparationTriggered,
      early_preparation_rule: `残供給率が${earlyPreparationThreshold}%未満になったら早めに準備`,
    },
    product_impact_table: productImpactTable,
    affected_customers: impactedCustomers,
    affected_plants: impactedPlants,
    affected_suppliers: unique(affectedProducts.map((row) => row.affected_supplier)),
    alternatives: alternativeApprovalItems,
    protected_products: protectedProducts,
    reduction_candidates: reductionCandidates,
    allocation_candidates: allocationCandidates,
    alternative_approval_items: alternativeApprovalItems,
    inventory_build_items: inventoryBuildItems,
    supplier_diversification_items: supplierDiversificationItems,
    human_approval_items: humanApprovalItems,
    engine_metrics: engine.metrics || {},
  };
}

export function summarizeScenarioBasis(provenance = []) {
  const rows = Array.isArray(provenance) ? provenance : [];
  const kindLabels = {
    news: "デモ用ニュース想定",
    supplier_notice: "デモ用サプライヤ通知",
    logistics: "想定物流シグナル",
    price_feed: "デモ用価格想定",
  };
  return rows.slice(0, 5).map((source) => ({
    id: source.id || source.ref || source.source || "demo-source",
    label: kindLabels[source.kind] || "デモ用想定情報",
    source: source.source || "Demo Source",
    claim: source.claim || source.label || "シナリオ根拠",
    confidence: source.confidence || "-",
    is_demo: true,
    disclaimer: "この情報はデモ用のシナリオ根拠です。リアルタイムニュース取得ではありません。",
  }));
}

function buildProductImpactTable({ input, policy, affectedSupplyRatio, totalSpend }) {
  const material = materialMeta(input.material);
  const node = optionMeta(IMPACT_NODE_OPTIONS, input.impactNode);
  const route = optionMeta(ALTERNATIVE_ROUTE_OPTIONS, input.alternativeRoute);
  const maxRevenue = Math.max(...DEMO_PRODUCTS.map((product) => product.monthly_revenue_usd));

  return DEMO_PRODUCTS.map((product) => {
    const materialDependency = numberOr(product.material_dependency[input.material], 0);
    const directMaterialMatch = product.materials.includes(input.material);
    const impactPressure = input.supplyReductionPercent * material.exposure_factor * node.factor * route.factor * materialDependency;
    const isAffected = directMaterialMatch && impactPressure >= 10;
    const inventoryDays = isAffected
      ? adjustedInventoryDays(product.base_inventory_days, input.supplyReductionPercent, input.durationDays, product.single_supplier_dependency)
      : product.base_inventory_days;
    const priorityFactors = {
      customer_priority: customerPriorityScore(product.customer_priority, input.demandPolicy),
      revenue_impact: revenueScore(product.monthly_revenue_usd, maxRevenue, input.demandPolicy),
      inventory_days: inventoryRiskScore(inventoryDays, policy),
      alternative_availability: alternativeRiskScore(product.alternative_status),
      single_supplier_dependency: product.single_supplier_dependency ? 100 : 35,
    };
    const score = isAffected ? priorityScore(priorityFactors, policy) : 0;
    const recommendedDecision = isAffected
      ? recommendDecision({ product, inventoryDays, score, policy, input, affectedSupplyRatio })
      : "維持";
    const decisionReason = isAffected
      ? buildDecisionReason({ product, inventoryDays, score, policy, affectedSupplyRatio, recommendedDecision })
      : "対象素材の直接影響は小さいため、現行計画を維持。";

    return {
      product_id: product.id,
      product_name: product.product_name,
      impact_material: directMaterialMatch ? material.label : product.impact_material_label,
      affected_supplier: product.supplier,
      supplier_tier: product.tier,
      plant: product.plant,
      customer: product.customer,
      customer_priority: priorityLabel(product.customer_priority),
      inventory_days: inventoryDays,
      revenue_impact_usd: isAffected ? Math.round(product.monthly_revenue_usd * affectedSupplyRatio / 100) : 0,
      monthly_revenue_usd: product.monthly_revenue_usd,
      alternative_status: product.alternative_status,
      alternative_materials: product.alternative_materials,
      single_supplier_dependency: product.single_supplier_dependency,
      priority_score: score,
      recommended_decision: recommendedDecision,
      decision_reason: decisionReason,
      is_affected: isAffected,
      priority_factors: priorityFactors,
      spend_weighted_exposure_usd: isAffected ? Math.round(totalSpend * (product.monthly_revenue_usd / sumRevenueForMaterial(input.material))) : 0,
    };
  }).sort((a, b) => {
    if (Number(b.is_affected) !== Number(a.is_affected)) return Number(b.is_affected) - Number(a.is_affected);
    return b.priority_score - a.priority_score;
  });
}

function buildHumanApprovalItems(affectedProducts, policy, affectedSupplyRatio, earlyPreparationTriggered = false) {
  if (!affectedProducts.length) return [];
  const minInventory = Math.min(...affectedProducts.map((row) => row.inventory_days));
  const needsAllocation =
    affectedSupplyRatio >= policy.thresholds.danger.affected_supply_ratio_percent ||
    minInventory <= policy.thresholds.danger.min_inventory_days ||
    earlyPreparationTriggered;
  const labels = new Set(["purchase_order", "supplier_switching", "customer_notice", "production_plan"]);
  if (needsAllocation) labels.add("allocation");
  if (affectedProducts.some((row) => row.recommended_decision === "縮小")) labels.add("reduction");
  if (affectedProducts.some((row) => row.alternative_status !== "承認済み")) labels.add("alternative_approval");

  return HUMAN_APPROVAL_CATALOG.filter((item) => labels.has(item.id)).map((item) => ({
    ...item,
    status: "承認待ち",
    execution_policy: "AIはドラフトまで。確定・送信・実行は人間承認後。",
  }));
}

function buildDisruption(scenario, input) {
  const byNode = {
    refinery: scenario.disruption?.hit_nodes || ["n_ref_jurong", "n_ref_ulsan", "n_ref_maptaput"],
    tier2: ["n_t2_jurong_trader"],
    tier1: ["n_sup_demo", "n_sup_hanmi", "n_sup_siam"],
    port: ["n_t2_jurong_trader", "n_sup_hanmi", "n_sup_siam"],
    plant: ["n_plant_chiba"],
  };
  return {
    type: "scenario_input",
    hit_nodes: byNode[input.impactNode] || byNode.refinery,
    capacity_drop: input.supplyReductionPercent / 100,
    note: "ユーザー入力の供給制約シナリオから生成",
  };
}

function recommendDecision({ product, inventoryDays, score, policy, input, affectedSupplyRatio }) {
  if (product.customer_priority === "high" && score >= 70) return "維持";
  if (
    inventoryDays <= policy.thresholds.stop_or_allocation_decision.min_inventory_days ||
    affectedSupplyRatio >= policy.thresholds.stop_or_allocation_decision.affected_supply_ratio_percent
  ) {
    return "供給配分";
  }
  if (product.alternative_status !== "承認済み") return "代替材確認";
  if (input.durationDays > inventoryDays && product.customer_priority === "medium") return "縮小";
  if (score >= 65) return "生産前倒し";
  return "縮小";
}

function buildDecisionReason({ product, inventoryDays, score, policy, affectedSupplyRatio, recommendedDecision }) {
  const reasons = [];
  reasons.push(`${priorityLabel(product.customer_priority)}優先顧客`);
  reasons.push(`在庫${inventoryDays}日`);
  reasons.push(`売上影響${compactUsd(product.monthly_revenue_usd)}/月`);
  if (product.single_supplier_dependency) reasons.push("単一サプライヤー依存");
  if (product.alternative_status !== "承認済み") reasons.push(`代替材${product.alternative_status}`);
  if (inventoryDays <= policy.thresholds.stop_or_allocation_decision.min_inventory_days) {
    reasons.push("停止/供給配分判断の在庫閾値以下");
  } else if (inventoryDays <= policy.thresholds.danger.min_inventory_days) {
    reasons.push("危険判定の在庫閾値以下");
  }
  if (affectedSupplyRatio >= policy.thresholds.danger.affected_supply_ratio_percent) {
    reasons.push(`影響供給比率${affectedSupplyRatio}%`);
  }
  return `${reasons.join("・")}のため「${recommendedDecision}」を推奨。優先度スコア${score}は企業ポリシーの重みに基づく。`;
}

function adjustedInventoryDays(baseDays, reductionPercent, durationDays, singleSupplierDependency) {
  const extraReduction = Math.max(0, reductionPercent - 30);
  const durationPenalty = Math.max(0, durationDays - 14) / 30;
  const singleSupplierPenalty = singleSupplierDependency ? 0.09 : 0.055;
  return round1(Math.max(1, baseDays - extraReduction * singleSupplierPenalty - durationPenalty * 1.2));
}

function customerPriorityScore(priority, demandPolicy) {
  const base = priority === "high" ? 100 : priority === "medium" ? 62 : 35;
  if (demandPolicy === "fair_allocation") return Math.max(45, Math.round(base * 0.72));
  if (demandPolicy === "protect_priority_customers") return priority === "high" ? 100 : Math.round(base * 0.85);
  return base;
}

function revenueScore(revenue, maxRevenue, demandPolicy) {
  const score = maxRevenue > 0 ? (revenue / maxRevenue) * 100 : 0;
  return demandPolicy === "maximize_revenue" ? Math.min(100, score * 1.18) : score;
}

function inventoryRiskScore(days, policy) {
  if (days <= policy.thresholds.stop_or_allocation_decision.min_inventory_days) return 100;
  if (days <= policy.thresholds.danger.min_inventory_days) return 76;
  if (days <= policy.thresholds.attention.min_inventory_days) return 48;
  return 15;
}

function alternativeRiskScore(status) {
  if (status === "未承認") return 95;
  if (status === "一部承認済み") return 55;
  if (status === "承認済み") return 20;
  return 70;
}

function materialMeta(material) {
  return MATERIAL_OPTIONS.find((option) => option.value === material) || MATERIAL_OPTIONS[0];
}

function optionMeta(options, value) {
  return options.find((option) => option.value === value) || options[0];
}

function optionValue(options, value, fallback) {
  return options.some((option) => option.value === value) ? value : fallback;
}

function priorityLabel(priority) {
  if (priority === "high") return "高";
  if (priority === "medium") return "中";
  return "低";
}

function sumRevenueForMaterial(material) {
  const total = DEMO_PRODUCTS
    .filter((product) => product.materials.includes(material))
    .reduce((sum, product) => sum + product.monthly_revenue_usd, 0);
  return total || 1;
}

function compactUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0ドル";
  if (Math.abs(n) >= 1_000_000) return `${trim1(n / 1_000_000)}百万ドル`;
  if (Math.abs(n) >= 1_000) return `${trim1(n / 1_000)}千ドル`;
  return `${Math.round(n).toLocaleString("ja-JP")}ドル`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function trim1(value) {
  const string = Number(value).toFixed(1);
  return string.endsWith(".0") ? string.slice(0, -2) : string;
}
