import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DEFAULT_COMPANY_POLICY } from "../web/js/companyPolicy.js";
import { calculateScenarioDecisionModel } from "../web/js/scenarioControls.js";

async function loadScenario() {
  return JSON.parse(await readFile(new URL("../web/assets/scenarios/naphtha-asia-allocation.json", import.meta.url), "utf8"));
}

test("supply reduction changes affected ratio, inventory days, and brief inputs", async () => {
  const scenario = await loadScenario();
  const mild = calculateScenarioDecisionModel({
    scenario,
    scenarioInput: { supplyReductionPercent: 30, material: "naphtha" },
    companyPolicy: DEFAULT_COMPANY_POLICY,
  });
  const severe = calculateScenarioDecisionModel({
    scenario,
    scenarioInput: { supplyReductionPercent: 60, material: "naphtha" },
    companyPolicy: DEFAULT_COMPANY_POLICY,
  });

  assert.equal(mild.calculated_metrics.affected_supply_ratio_percent, 65);
  assert.ok(severe.calculated_metrics.affected_supply_ratio_percent > mild.calculated_metrics.affected_supply_ratio_percent);
  assert.ok(severe.calculated_metrics.inventory_days_min < mild.calculated_metrics.inventory_days_min);
  assert.ok(severe.calculated_metrics.policy_impact_score >= mild.calculated_metrics.policy_impact_score);
});

test("target material changes the affected product set", async () => {
  const scenario = await loadScenario();
  const naphtha = calculateScenarioDecisionModel({
    scenario,
    scenarioInput: { supplyReductionPercent: 30, material: "naphtha" },
    companyPolicy: DEFAULT_COMPANY_POLICY,
  });
  const packaging = calculateScenarioDecisionModel({
    scenario,
    scenarioInput: { supplyReductionPercent: 30, material: "packaging-film" },
    companyPolicy: DEFAULT_COMPANY_POLICY,
  });

  const naphthaNames = naphtha.product_impact_table.filter((row) => row.is_affected).map((row) => row.product_name);
  const packagingNames = packaging.product_impact_table.filter((row) => row.is_affected).map((row) => row.product_name);

  assert.ok(naphthaNames.includes("樹脂A"));
  assert.deepEqual(packagingNames, ["包装フィルムD"]);
});

test("priority weight changes alter product priority scores", async () => {
  const scenario = await loadScenario();
  const defaultModel = calculateScenarioDecisionModel({
    scenario,
    scenarioInput: { supplyReductionPercent: 30, material: "naphtha" },
    companyPolicy: DEFAULT_COMPANY_POLICY,
  });
  const revenueHeavyModel = calculateScenarioDecisionModel({
    scenario,
    scenarioInput: { supplyReductionPercent: 30, material: "naphtha" },
    companyPolicy: {
      ...DEFAULT_COMPANY_POLICY,
      priority_weights: {
        customer_priority: 0.05,
        revenue_impact: 0.75,
        inventory_days: 0.05,
        alternative_availability: 0.05,
        single_supplier_dependency: 0.1,
      },
    },
  });

  const defaultTop = defaultModel.product_impact_table[0].product_name;
  const revenueTop = revenueHeavyModel.product_impact_table[0].product_name;

  assert.equal(defaultTop, "樹脂A");
  assert.equal(revenueTop, "コーティングC");
});

test("human-in-the-loop items cover execution decisions", async () => {
  const scenario = await loadScenario();
  const model = calculateScenarioDecisionModel({
    scenario,
    scenarioInput: { supplyReductionPercent: 60, material: "naphtha" },
    companyPolicy: DEFAULT_COMPANY_POLICY,
  });

  const labels = model.human_approval_items.map((item) => item.label);
  assert.ok(labels.includes("発注変更"));
  assert.ok(labels.includes("サプライヤ切替"));
  assert.ok(labels.includes("顧客への正式通知"));
  assert.ok(labels.includes("生産計画変更"));
  assert.ok(labels.includes("供給配分判断"));
  assert.ok(labels.includes("代替材承認プロセス開始"));
  for (const item of model.human_approval_items) {
    assert.match(item.execution_policy, /AIはドラフトまで/);
  }
});

test("early preparation trigger fires when remaining supply falls below 30 percent", async () => {
  const scenario = await loadScenario();
  const model = calculateScenarioDecisionModel({
    scenario,
    scenarioInput: { supplyReductionPercent: 75, material: "naphtha" },
    companyPolicy: DEFAULT_COMPANY_POLICY,
  });

  assert.equal(model.calculated_metrics.remaining_supply_ratio_percent, 25);
  assert.equal(model.calculated_metrics.early_preparation_threshold_percent, 30);
  assert.equal(model.calculated_metrics.early_preparation_triggered, true);
  assert.ok(model.human_approval_items.map((item) => item.label).includes("供給配分判断"));
});
