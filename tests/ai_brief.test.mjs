import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DEFAULT_COMPANY_POLICY } from "../web/js/companyPolicy.js";
import { buildAiScenarioBrief } from "../web/js/aiScenarioBrief.js";
import { calculateScenarioDecisionModel } from "../web/js/scenarioControls.js";

async function buildDefaultModel() {
  const scenario = JSON.parse(await readFile(new URL("../web/assets/scenarios/naphtha-asia-allocation.json", import.meta.url), "utf8"));
  return calculateScenarioDecisionModel({
    scenario,
    scenarioInput: { supplyReductionPercent: 30, material: "naphtha" },
    companyPolicy: DEFAULT_COMPANY_POLICY,
  });
}

test("AI Scenario Brief is deterministic fallback and references calculated metrics", async () => {
  const model = await buildDefaultModel();
  const brief = buildAiScenarioBrief({ model });

  assert.equal(brief.source, "deterministic-fallback");
  assert.equal(brief.generation_mode, "ローカル生成 / デモ回答");
  assert.equal(
    brief.referenced_calculation_values.affected_supply_ratio_percent,
    model.calculated_metrics.affected_supply_ratio_percent,
  );
  assert.equal(brief.referenced_calculation_values.inventory_days_min, model.calculated_metrics.inventory_days_min);
  assert.equal(brief.referenced_calculation_values.remaining_supply_ratio_percent, 70);
  assert.equal(brief.referenced_calculation_values.early_preparation_triggered, false);
  assert.match(brief.executive_summary, /影響供給比率は65%/);
  assert.match(brief.executive_summary, /早期準備トリガー\(30%未満\)には未達/);
  assert.match(brief.guardrail, /AIが新規作成していません/);
});

test("AI Scenario Brief explains decisions and additional confirmation points", async () => {
  const model = await buildDefaultModel();
  const brief = buildAiScenarioBrief({ model });

  assert.ok(brief.product_priority_reason.length > 0);
  assert.ok(brief.protected_products.length > 0);
  assert.ok(brief.alternative_material_checks.length > 0);
  assert.ok(brief.additional_confirmation_points.includes("代替材の顧客承認範囲"));
  assert.ok(brief.human_approval_required.some((item) => item.includes("発注変更")));
  assert.match(brief.customer_explanation_draft, /正式連絡|正式通知|承認/);
});
