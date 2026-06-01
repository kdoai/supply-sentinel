export const DEFAULT_COMPANY_POLICY = {
  company_policy_name: "Demo Manufacturing SCM Policy",
  thresholds: {
    attention: {
      min_inventory_days: 30,
      affected_supply_ratio_percent: 20,
    },
    danger: {
      min_inventory_days: 14,
      affected_supply_ratio_percent: 50,
    },
    stop_or_allocation_decision: {
      min_inventory_days: 7,
      affected_supply_ratio_percent: 70,
    },
  },
  early_preparation_trigger: {
    remaining_supply_ratio_percent_below: 30,
    description: "早めの準備とは、供給残量が30%を下回る状態を指す。供給減少率で見ると70%超。",
  },
  priority_weights: {
    customer_priority: 0.3,
    revenue_impact: 0.25,
    inventory_days: 0.2,
    alternative_availability: 0.15,
    single_supplier_dependency: 0.1,
  },
};

export const POLICY_LEVELS = {
  normal: {
    key: "normal",
    label: "通常",
    tone: "stable",
  },
  attention: {
    key: "attention",
    label: "注意",
    tone: "attention",
  },
  danger: {
    key: "danger",
    label: "危険",
    tone: "danger",
  },
  stop_or_allocation_decision: {
    key: "stop_or_allocation_decision",
    label: "停止/供給配分判断",
    tone: "critical",
  },
};

const WEIGHT_KEYS = [
  "customer_priority",
  "revenue_impact",
  "inventory_days",
  "alternative_availability",
  "single_supplier_dependency",
];

export function normalizePolicy(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const base = DEFAULT_COMPANY_POLICY;
  const thresholds = {
    attention: {
      min_inventory_days: numberOr(
        source.thresholds?.attention?.min_inventory_days,
        base.thresholds.attention.min_inventory_days,
      ),
      affected_supply_ratio_percent: numberOr(
        source.thresholds?.attention?.affected_supply_ratio_percent,
        base.thresholds.attention.affected_supply_ratio_percent,
      ),
    },
    danger: {
      min_inventory_days: numberOr(
        source.thresholds?.danger?.min_inventory_days,
        base.thresholds.danger.min_inventory_days,
      ),
      affected_supply_ratio_percent: numberOr(
        source.thresholds?.danger?.affected_supply_ratio_percent,
        base.thresholds.danger.affected_supply_ratio_percent,
      ),
    },
    stop_or_allocation_decision: {
      min_inventory_days: numberOr(
        source.thresholds?.stop_or_allocation_decision?.min_inventory_days,
        base.thresholds.stop_or_allocation_decision.min_inventory_days,
      ),
      affected_supply_ratio_percent: numberOr(
        source.thresholds?.stop_or_allocation_decision?.affected_supply_ratio_percent,
        base.thresholds.stop_or_allocation_decision.affected_supply_ratio_percent,
      ),
    },
  };

  const rawWeights = {};
  for (const key of WEIGHT_KEYS) {
    rawWeights[key] = Math.max(0, numberOr(source.priority_weights?.[key], base.priority_weights[key]));
  }
  const total = Object.values(rawWeights).reduce((sum, value) => sum + value, 0);
  const priorityWeights = {};
  for (const key of WEIGHT_KEYS) {
    priorityWeights[key] = total > 0 ? round3(rawWeights[key] / total) : base.priority_weights[key];
  }

  return {
    company_policy_name: String(source.company_policy_name || base.company_policy_name),
    thresholds,
    early_preparation_trigger: {
      remaining_supply_ratio_percent_below: numberOr(
        source.early_preparation_trigger?.remaining_supply_ratio_percent_below,
        base.early_preparation_trigger.remaining_supply_ratio_percent_below,
      ),
      description: String(
        source.early_preparation_trigger?.description || base.early_preparation_trigger.description,
      ),
    },
    priority_weights: priorityWeights,
  };
}

export function classifyImpact(metrics = {}, policyInput = DEFAULT_COMPANY_POLICY) {
  const policy = normalizePolicy(policyInput);
  const inventoryDaysMin = numberOr(metrics.inventory_days_min, Infinity);
  const affectedSupplyRatio = numberOr(
    metrics.affected_supply_ratio_percent ?? metrics.affected_supply_ratio,
    0,
  );
  const thresholds = policy.thresholds;

  if (
    inventoryDaysMin <= thresholds.stop_or_allocation_decision.min_inventory_days ||
    affectedSupplyRatio >= thresholds.stop_or_allocation_decision.affected_supply_ratio_percent
  ) {
    return {
      ...POLICY_LEVELS.stop_or_allocation_decision,
      reason: "停止/供給配分判断の企業閾値に到達",
    };
  }
  if (
    inventoryDaysMin <= thresholds.danger.min_inventory_days ||
    affectedSupplyRatio >= thresholds.danger.affected_supply_ratio_percent
  ) {
    return {
      ...POLICY_LEVELS.danger,
      reason: "危険判定の企業閾値に到達",
    };
  }
  if (
    inventoryDaysMin <= thresholds.attention.min_inventory_days ||
    affectedSupplyRatio >= thresholds.attention.affected_supply_ratio_percent
  ) {
    return {
      ...POLICY_LEVELS.attention,
      reason: "注意判定の企業閾値に到達",
    };
  }
  return {
    ...POLICY_LEVELS.normal,
    reason: "企業閾値上は通常範囲",
  };
}

export function calculatePolicyImpactScore(metrics = {}, policyInput = DEFAULT_COMPANY_POLICY) {
  const policy = normalizePolicy(policyInput);
  const affectedSupplyRatio = clamp(
    numberOr(metrics.affected_supply_ratio_percent ?? metrics.affected_supply_ratio, 0),
    0,
    100,
  );
  const inventoryDaysMin = numberOr(metrics.inventory_days_min, policy.thresholds.attention.min_inventory_days);
  const stopDays = Math.max(1, policy.thresholds.stop_or_allocation_decision.min_inventory_days);
  const attentionDays = Math.max(stopDays + 1, policy.thresholds.attention.min_inventory_days);
  const inventoryUrgency = clamp(((attentionDays - inventoryDaysMin) / (attentionDays - stopDays)) * 100, 0, 100);
  return Math.round(clamp(20 + affectedSupplyRatio * 0.62 + inventoryUrgency * 0.22, 0, 100));
}

export function priorityScore(factors = {}, policyInput = DEFAULT_COMPANY_POLICY) {
  const policy = normalizePolicy(policyInput);
  const weights = policy.priority_weights;
  return Math.round(
    clamp(
      numberOr(factors.customer_priority, 0) * weights.customer_priority +
        numberOr(factors.revenue_impact, 0) * weights.revenue_impact +
        numberOr(factors.inventory_days, 0) * weights.inventory_days +
        numberOr(factors.alternative_availability, 0) * weights.alternative_availability +
        numberOr(factors.single_supplier_dependency, 0) * weights.single_supplier_dependency,
      0,
      100,
    ),
  );
}

export function editablePolicyFromForm(formData, currentPolicy = DEFAULT_COMPANY_POLICY) {
  const policy = normalizePolicy(currentPolicy);
  return normalizePolicy({
    company_policy_name: policy.company_policy_name,
    thresholds: {
      attention: {
        min_inventory_days: formNumber(formData, "attention_inventory", policy.thresholds.attention.min_inventory_days),
        affected_supply_ratio_percent: formNumber(
          formData,
          "attention_supply",
          policy.thresholds.attention.affected_supply_ratio_percent,
        ),
      },
      danger: {
        min_inventory_days: formNumber(formData, "danger_inventory", policy.thresholds.danger.min_inventory_days),
        affected_supply_ratio_percent: formNumber(
          formData,
          "danger_supply",
          policy.thresholds.danger.affected_supply_ratio_percent,
        ),
      },
      stop_or_allocation_decision: {
        min_inventory_days: formNumber(
          formData,
          "stop_inventory",
          policy.thresholds.stop_or_allocation_decision.min_inventory_days,
        ),
        affected_supply_ratio_percent: formNumber(
          formData,
          "stop_supply",
          policy.thresholds.stop_or_allocation_decision.affected_supply_ratio_percent,
        ),
      },
    },
    early_preparation_trigger: {
      remaining_supply_ratio_percent_below: formNumber(
        formData,
        "early_remaining_supply",
        policy.early_preparation_trigger.remaining_supply_ratio_percent_below,
      ),
      description: policy.early_preparation_trigger.description,
    },
    priority_weights: {
      customer_priority: formNumber(formData, "weight_customer_priority", policy.priority_weights.customer_priority),
      revenue_impact: formNumber(formData, "weight_revenue_impact", policy.priority_weights.revenue_impact),
      inventory_days: formNumber(formData, "weight_inventory_days", policy.priority_weights.inventory_days),
      alternative_availability: formNumber(
        formData,
        "weight_alternative_availability",
        policy.priority_weights.alternative_availability,
      ),
      single_supplier_dependency: formNumber(
        formData,
        "weight_single_supplier_dependency",
        policy.priority_weights.single_supplier_dependency,
      ),
    },
  });
}

function formNumber(formData, key, fallback) {
  if (!formData || typeof formData.get !== "function") return fallback;
  return numberOr(formData.get(key), fallback);
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
