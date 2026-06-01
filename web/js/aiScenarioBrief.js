export function buildAiScenarioBrief(input = {}) {
  const model = input.model || input;
  const scenario = model.scenario_input || {};
  const policy = model.policy || {};
  const metrics = model.calculated_metrics || {};
  const products = Array.isArray(model.product_impact_table) ? model.product_impact_table : [];
  const affectedProducts = products.filter((row) => row.is_affected);
  const protectedProducts = Array.isArray(model.protected_products) ? model.protected_products : [];
  const reductionCandidates = Array.isArray(model.reduction_candidates) ? model.reduction_candidates : [];
  const approvalItems = Array.isArray(model.human_approval_items) ? model.human_approval_items : [];
  const alternatives = Array.isArray(model.alternative_approval_items) ? model.alternative_approval_items : [];
  const inventoryBuildItems = Array.isArray(model.inventory_build_items) ? model.inventory_build_items : [];
  const supplierDiversificationItems = Array.isArray(model.supplier_diversification_items)
    ? model.supplier_diversification_items
    : [];

  const topProduct = protectedProducts[0] || affectedProducts[0] || null;
  const firstReduction = reductionCandidates[0] || null;
  const level = metrics.alert_level?.label || "通常";
  const inventoryText = metrics.inventory_days_min == null ? "該当なし" : `${metrics.inventory_days_min}日`;
  const ratioText = `${numberOr(metrics.affected_supply_ratio_percent, 0)}%`;
  const spendText = compactUsd(metrics.spend_at_risk_usd);
  const earlyPreparationText = metrics.early_preparation_triggered
    ? `残供給率が${metrics.remaining_supply_ratio_percent}%となり、早期準備トリガー(${metrics.early_preparation_threshold_percent}%未満)に該当します。`
    : `残供給率は${metrics.remaining_supply_ratio_percent}%で、早期準備トリガー(${metrics.early_preparation_threshold_percent}%未満)には未達です。`;

  const executiveSummary = [
    `${metrics.material || "対象素材"}の供給${numberOr(metrics.supply_reduction_percent, 0)}%減シナリオでは、`,
    `${policy.company_policy_name || "企業ポリシー"}に基づく警戒レベルは「${level}」です。`,
    `影響供給比率は${ratioText}、金額影響は${spendText}、最短在庫は${inventoryText}です。`,
    earlyPreparationText,
    topProduct ? `まず${topProduct.product_name}を優先保護対象として扱います。` : "現時点で直接影響の大きい製品は限定的です。",
  ].join("");

  const productPriorityReason = topProduct
    ? `${topProduct.product_name}は${topProduct.customer_priority}優先顧客、在庫${topProduct.inventory_days}日、${topProduct.decision_reason}`
    : "対象素材に直結する製品が少ないため、在庫と受注変化の継続確認を優先します。";

  const reductionReason = firstReduction
    ? `${firstReduction.product_name}は${firstReduction.customer_priority}優先顧客で、代替材状況は${firstReduction.alternative_status}です。企業基準上は縮小候補として扱えます。`
    : "縮小候補は限定的です。供給配分と代替材確認を先に進めてください。";

  const confirmationPoints = [
    "追加調達余力とリードタイム",
    "代替材の顧客承認範囲",
    "高優先顧客の納期許容幅",
    "生産計画を前倒しできる日数",
  ];

  const customerDraft = topProduct
    ? `${topProduct.customer}向けには、供給制約シナリオを前提に、対象製品${topProduct.product_name}の納期・配分影響を確認中であること、確定判断は社内承認後に正式連絡することを説明します。`
    : "顧客向けには、現時点ではデモシナリオに基づく影響確認中であり、正式通知は人間承認後に行う旨を説明します。";

  return {
    title: "AI Scenario Brief",
    generation_mode: "ローカル生成 / デモ回答",
    source: "deterministic-fallback",
    guardrail:
      "AIは計算済みmetricsと企業判断基準だけを説明します。在庫日数、影響供給比率、スコアはAIが新規作成していません。",
    referenced_calculation_values: {
      policy_name: policy.company_policy_name || "",
      supply_reduction_percent: metrics.supply_reduction_percent ?? null,
      remaining_supply_ratio_percent: metrics.remaining_supply_ratio_percent ?? null,
      affected_supply_ratio_percent: metrics.affected_supply_ratio_percent ?? null,
      spend_at_risk_usd: metrics.spend_at_risk_usd ?? null,
      inventory_days_min: metrics.inventory_days_min ?? null,
      policy_impact_score: metrics.policy_impact_score ?? null,
      alert_level: level,
      early_preparation_rule: metrics.early_preparation_rule || null,
      early_preparation_triggered: Boolean(metrics.early_preparation_triggered),
    },
    executive_summary: executiveSummary,
    product_priority_reason: productPriorityReason,
    protected_products: protectedProducts.map(toBriefProduct),
    reduction_candidates: reductionCandidates.map(toBriefProduct),
    allocation_candidates: (model.allocation_candidates || []).map(toBriefProduct),
    alternative_material_checks: alternatives.map((item) => `${item.material_id}: ${item.product_name} (${item.status})`),
    inventory_build_candidates: inventoryBuildItems.map((item) => `${item.product_name}: ${item.plant} / 在庫${item.inventory_days}日`),
    supplier_diversification_candidates: supplierDiversificationItems.map(
      (item) => `${item.product_name}: ${item.supplier} (${item.tier})`,
    ),
    additional_confirmation_points: confirmationPoints,
    customer_explanation_draft: customerDraft,
    human_approval_required: approvalItems.map((item) => `${item.label}: ${item.owner}`),
    decision_notes: [
      reductionReason,
      `Human-in-the-loop対象は${approvalItems.length}件です。AIは文案・整理までで、発注変更、切替、通知、計画変更は実行しません。`,
    ],
  };
}

function toBriefProduct(row) {
  return `${row.product_name}: ${row.decision_reason}`;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compactUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0ドル";
  if (Math.abs(n) >= 1_000_000) return `${trim1(n / 1_000_000)}百万ドル`;
  if (Math.abs(n) >= 1_000) return `${trim1(n / 1_000)}千ドル`;
  return `${Math.round(n).toLocaleString("ja-JP")}ドル`;
}

function trim1(value) {
  const string = Number(value).toFixed(1);
  return string.endsWith(".0") ? string.slice(0, -2) : string;
}
