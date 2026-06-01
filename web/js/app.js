import {
  ALTERNATIVE_ROUTE_OPTIONS,
  DEFAULT_SCENARIO_INPUT,
  DEMAND_POLICY_OPTIONS,
  DURATION_OPTIONS,
  IMPACT_NODE_OPTIONS,
  MATERIAL_OPTIONS,
  calculateScenarioDecisionModel,
  normalizeScenarioInput,
  scenarioInputFromForm,
} from "./scenarioControls.js";
import {
  DEFAULT_COMPANY_POLICY,
  editablePolicyFromForm,
  normalizePolicy,
} from "./companyPolicy.js";
import { buildAiScenarioBrief } from "./aiScenarioBrief.js";

const VIEW_TITLES = {
  scenario: "シナリオ設定",
  impact: "製品影響・優先順位",
  actions: "打ち手・AI説明",
};

const state = {
  scenario: null,
  scenarioInput: { ...DEFAULT_SCENARIO_INPUT },
  companyPolicy: normalizePolicy(DEFAULT_COMPANY_POLICY),
  model: null,
  brief: null,
};

init();

async function init() {
  setBootText("シナリオデータを読み込んでいます");
  try {
    const [scenario, policy] = await Promise.all([
      loadJson("./assets/scenarios/naphtha-asia-allocation.json"),
      loadJson("./assets/company_policy.demo.json"),
    ]);
    state.scenario = scenario;
    state.companyPolicy = normalizePolicy(policy);
    setBootText("画面を構成しています");
    bindChrome();
    renderForms();
    renderModel();
  } catch (error) {
    console.error(error);
    renderLoadError(error);
  } finally {
    hideBootLoader();
  }
}

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} を読み込めませんでした (${response.status})`);
  return response.json();
}

function bindChrome() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.getAttribute("data-view")));
  });

  const toggle = document.getElementById("sidebar-toggle");
  const shell = document.getElementById("app-shell");
  toggle?.addEventListener("click", () => {
    const collapsed = shell.classList.toggle("sidebar-collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.textContent = collapsed ? "›" : "‹";
  });

  document.getElementById("run-scenario")?.addEventListener("click", () => {
    renderModel();
    switchView("impact");
  });
  document.getElementById("reset-policy")?.addEventListener("click", () => {
    state.companyPolicy = normalizePolicy(DEFAULT_COMPANY_POLICY);
    renderForms();
    renderModel();
  });
}

function switchView(view) {
  const next = VIEW_TITLES[view] ? view : "scenario";
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.getAttribute("data-view") === next);
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.getAttribute("data-view-panel") === next);
  });
  setText("view-title", VIEW_TITLES[next]);
}

function renderForms() {
  const scenarioForm = document.getElementById("scenario-form");
  if (scenarioForm) {
    scenarioForm.innerHTML = scenarioFormHtml(state.scenarioInput);
    scenarioForm.addEventListener("input", () => {
      state.scenarioInput = scenarioInputFromForm(new FormData(scenarioForm));
      setText("supply-reduction-value", `${state.scenarioInput.supplyReductionPercent}%減`);
      renderModel();
    });
    scenarioForm.addEventListener("change", () => {
      state.scenarioInput = scenarioInputFromForm(new FormData(scenarioForm));
      renderModel();
    });
  }

  const policyForm = document.getElementById("policy-form");
  if (policyForm) {
    policyForm.innerHTML = policyFormHtml(state.companyPolicy);
    policyForm.addEventListener("input", () => {
      state.companyPolicy = editablePolicyFromForm(new FormData(policyForm), state.companyPolicy);
      renderModel();
    });
    policyForm.addEventListener("change", () => {
      state.companyPolicy = editablePolicyFromForm(new FormData(policyForm), state.companyPolicy);
      renderModel();
    });
  }
}

function renderModel() {
  if (!state.scenario) return;
  state.scenarioInput = normalizeScenarioInput(state.scenarioInput);
  state.companyPolicy = normalizePolicy(state.companyPolicy);
  state.model = calculateScenarioDecisionModel({
    scenario: state.scenario,
    scenarioInput: state.scenarioInput,
    companyPolicy: state.companyPolicy,
  });
  state.brief = buildAiScenarioBrief({ model: state.model });

  renderChips();
  renderPolicyNote();
  renderDecisionKpis();
  renderScenarioBasis();
  renderProductTable();
  renderDecisionOutputs();
  renderMitigations();
  renderAiBrief();
  renderApprovalQueue();
  renderAgentTrace();
}

function scenarioFormHtml(input) {
  return `
    <div class="form-grid">
      <label class="field">
        <span>対象素材</span>
        <select name="material">${optionHtml(MATERIAL_OPTIONS, input.material)}</select>
      </label>
      <label class="field range-field">
        <span>供給減少率 <strong id="supply-reduction-value">${esc(input.supplyReductionPercent)}%減</strong></span>
        <input type="range" name="supply_reduction" min="0" max="100" step="5" value="${esc(input.supplyReductionPercent)}">
      </label>
      <label class="field">
        <span>影響期間</span>
        <select name="duration_days">${optionHtml(DURATION_OPTIONS, String(input.durationDays))}</select>
      </label>
      <label class="field">
        <span>影響ノード</span>
        <select name="impact_node">${optionHtml(IMPACT_NODE_OPTIONS, input.impactNode)}</select>
      </label>
      <label class="field">
        <span>代替ルート利用可否</span>
        <select name="alternative_route">${optionHtml(ALTERNATIVE_ROUTE_OPTIONS, input.alternativeRoute)}</select>
      </label>
      <label class="field">
        <span>需要方針</span>
        <select name="demand_policy">${optionHtml(DEMAND_POLICY_OPTIONS, input.demandPolicy)}</select>
      </label>
    </div>
  `;
}

function policyFormHtml(policy) {
  return `
    <div class="policy-form-grid">
      <fieldset>
        <legend>閾値</legend>
        ${numberField("注意: 最低在庫日数", "attention_inventory", policy.thresholds.attention.min_inventory_days, "日")}
        ${numberField("注意: 影響供給比率", "attention_supply", policy.thresholds.attention.affected_supply_ratio_percent, "%")}
        ${numberField("危険: 最低在庫日数", "danger_inventory", policy.thresholds.danger.min_inventory_days, "日")}
        ${numberField("危険: 影響供給比率", "danger_supply", policy.thresholds.danger.affected_supply_ratio_percent, "%")}
        ${numberField("停止/配分: 最低在庫日数", "stop_inventory", policy.thresholds.stop_or_allocation_decision.min_inventory_days, "日")}
        ${numberField("停止/配分: 影響供給比率", "stop_supply", policy.thresholds.stop_or_allocation_decision.affected_supply_ratio_percent, "%")}
        ${numberField("早期準備: 残供給率", "early_remaining_supply", policy.early_preparation_trigger.remaining_supply_ratio_percent_below, "%未満")}
      </fieldset>
      <fieldset>
        <legend>優先順位の重み</legend>
        ${numberField("顧客優先度", "weight_customer_priority", policy.priority_weights.customer_priority, "", "0.01")}
        ${numberField("売上影響", "weight_revenue_impact", policy.priority_weights.revenue_impact, "", "0.01")}
        ${numberField("在庫日数", "weight_inventory_days", policy.priority_weights.inventory_days, "", "0.01")}
        ${numberField("代替材有無", "weight_alternative_availability", policy.priority_weights.alternative_availability, "", "0.01")}
        ${numberField("単一サプライヤー依存", "weight_single_supplier_dependency", policy.priority_weights.single_supplier_dependency, "", "0.01")}
      </fieldset>
    </div>
  `;
}

function numberField(label, name, value, suffix = "", step = "1") {
  return `
    <label class="number-field">
      <span>${esc(label)}</span>
      <span class="number-input-wrap">
        <input type="number" name="${esc(name)}" value="${esc(value)}" step="${esc(step)}">
        ${suffix ? `<em>${esc(suffix)}</em>` : ""}
      </span>
    </label>
  `;
}

function renderChips() {
  const input = state.model.scenario_input;
  const material = state.model.calculated_metrics.material;
  const duration = `${input.durationDays}日`;
  setText("scenario-summary-chip", `${material} / 供給${input.supplyReductionPercent}%減 / ${duration}`);
  setText("policy-source-chip", `判定基準: ${state.model.policy.company_policy_name}`);
  setText("ai-mode-chip", `AI判断補助: ${state.brief.generation_mode}`);
}

function renderPolicyNote() {
  const metrics = state.model.calculated_metrics;
  setText(
    "policy-note",
    `${metrics.policy_name} に基づく警戒レベル: ${metrics.alert_level.label} (${metrics.alert_level.reason})`,
  );
}

function renderDecisionKpis() {
  const m = state.model.calculated_metrics;
  setHtml(
    "decision-kpis",
    [
      kpiCard("影響製品", `${m.impacted_product_count}件`, "対象素材に直接影響する製品"),
      kpiCard("影響顧客", `${m.impacted_customer_count}社`, "受注・出荷影響のある顧客"),
      kpiCard("影響工場", `${m.impacted_plant_count}拠点`, "在庫・生産計画を確認すべき工場"),
      kpiCard("最短在庫", m.inventory_days_min == null ? "該当なし" : `${m.inventory_days_min}日`, "製品別の補正後在庫日数"),
      kpiCard("影響供給比率", `${m.affected_supply_ratio_percent}%`, "企業ポリシー判定に使う供給影響"),
      kpiCard("残供給率", `${m.remaining_supply_ratio_percent}%`, m.early_preparation_rule, m.early_preparation_triggered ? "danger" : "stable"),
      kpiCard("早期準備", m.early_preparation_triggered ? "発動" : "未達", "残供給率30%未満で発動", m.early_preparation_triggered ? "critical" : "stable"),
      kpiCard("金額影響", compactUsd(m.spend_at_risk_usd), `全体 ${compactUsd(m.total_spend_usd)}`),
      kpiCard("警戒レベル", m.alert_level.label, m.alert_level.reason, m.alert_level.tone),
      kpiCard("Policy Score", `${m.policy_impact_score}/100`, "Demo Manufacturing SCM Policy に基づく計算値"),
    ].join(""),
  );
}

function kpiCard(label, value, note, tone = "") {
  return `
    <article class="decision-kpi ${tone ? `is-${esc(tone)}` : ""}">
      <span>${esc(label)}</span>
      <strong>${esc(value)}</strong>
      <p>${esc(note)}</p>
    </article>
  `;
}

function renderScenarioBasis() {
  setHtml(
    "scenario-basis",
    `
      <div class="demo-disclaimer">この情報はデモ用のシナリオ根拠です。リアルタイムニュース取得ではありません。</div>
      <div class="basis-list">
        ${state.model.scenario_basis.map((item) => `
          <article class="basis-card">
            <strong>${esc(item.label)}</strong>
            <span>${esc(item.source)} / 確度 ${esc(item.confidence)}</span>
            <p>${esc(item.claim)}</p>
            <em>${esc(item.disclaimer)}</em>
          </article>
        `).join("")}
      </div>
    `,
  );
}

function renderProductTable() {
  const rows = state.model.product_impact_table;
  setHtml(
    "product-impact-body",
    rows.map((row) => `
      <tr class="${row.is_affected ? "is-affected" : "is-calm"}">
        <td><strong>${esc(row.product_name)}</strong></td>
        <td>${esc(row.impact_material)}</td>
        <td>${esc(row.affected_supplier)}<br><span>${esc(row.supplier_tier)}</span></td>
        <td>${esc(row.inventory_days)}日</td>
        <td>${compactUsd(row.revenue_impact_usd)}</td>
        <td>${esc(row.customer_priority)}</td>
        <td>${esc(row.alternative_status)}</td>
        <td>${row.single_supplier_dependency ? "あり" : "分散あり"}</td>
        <td><span class="decision-pill">${esc(row.recommended_decision)}</span></td>
        <td>${esc(row.decision_reason)}</td>
      </tr>
    `).join(""),
  );
}

function renderDecisionOutputs() {
  renderProductCards("protected-products", state.model.protected_products, "守る製品はありません");
  renderProductCards("reduction-candidates", state.model.reduction_candidates, "縮小候補はありません");
  renderProductCards("allocation-candidates", state.model.allocation_candidates, "供給配分候補はありません");
}

function renderProductCards(id, rows, emptyText) {
  setHtml(
    id,
    rows.length
      ? rows.map((row) => `
          <article class="product-decision-card">
            <strong>${esc(row.product_name)}</strong>
            <span>${esc(row.recommended_decision)} / 優先度 ${esc(row.priority_score)}</span>
            <p>${esc(row.decision_reason)}</p>
          </article>
        `).join("")
      : emptyState(emptyText),
  );
}

function renderMitigations() {
  setHtml("alternative-items", listItems(state.model.alternative_approval_items, (item) => `${item.material_id}: ${item.product_name} (${item.status})`));
  setHtml("inventory-items", listItems(state.model.inventory_build_items, (item) => `${item.product_name}: ${item.plant} / 在庫${item.inventory_days}日`));
  setHtml("supplier-items", listItems(state.model.supplier_diversification_items, (item) => `${item.product_name}: ${item.supplier} / ${item.tier}`));
}

function renderAiBrief() {
  const b = state.brief;
  setHtml(
    "ai-scenario-brief",
    `
      <div class="brief-guardrail">${esc(b.guardrail)}</div>
      <section class="brief-section">
        <h4>経営向け要約</h4>
        <p>${esc(b.executive_summary)}</p>
      </section>
      <section class="brief-section">
        <h4>製品優先順位の理由</h4>
        <p>${esc(b.product_priority_reason)}</p>
      </section>
      <div class="brief-columns">
        ${briefList("守るべき製品", b.protected_products)}
        ${briefList("縮小候補製品", b.reduction_candidates)}
        ${briefList("代替材確認", b.alternative_material_checks)}
        ${briefList("在庫積み増し", b.inventory_build_candidates)}
        ${briefList("調達先分散", b.supplier_diversification_candidates)}
        ${briefList("人間承認が必要な判断", b.human_approval_required)}
      </div>
      <section class="brief-section">
        <h4>追加確認ポイント</h4>
        <ol>${b.additional_confirmation_points.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>
      </section>
      <section class="brief-section">
        <h4>顧客説明ドラフト</h4>
        <p>${esc(b.customer_explanation_draft)}</p>
      </section>
      <section class="brief-section referenced-values">
        <h4>参照した計算値</h4>
        <code>${esc(JSON.stringify(b.referenced_calculation_values, null, 2))}</code>
      </section>
    `,
  );
}

function briefList(title, rows) {
  return `
    <section class="brief-mini-list">
      <h4>${esc(title)}</h4>
      <ul>${rows.length ? rows.map((item) => `<li>${esc(item)}</li>`).join("") : "<li>該当なし</li>"}</ul>
    </section>
  `;
}

function renderApprovalQueue() {
  const items = state.model.human_approval_items;
  setHtml(
    "approval-queue",
    items.length
      ? items.map((item) => `
          <article class="approval-card">
            <div>
              <strong>${esc(item.label)}</strong>
              <span>${esc(item.owner)} / ${esc(item.status)}</span>
            </div>
            <p>${esc(item.reason)}</p>
            <em>${esc(item.execution_policy)}</em>
          </article>
        `).join("")
      : emptyState("承認待ち判断はありません"),
  );
}

function renderAgentTrace() {
  const m = state.model.calculated_metrics;
  setHtml(
    "agent-trace",
    `
      <ol class="trace-list">
        <li><strong>Scenario Input</strong><span>${esc(m.material)} / 供給${esc(m.supply_reduction_percent)}%減 / ${esc(m.duration_days)}日</span></li>
        <li><strong>Rule-based Calculation</strong><span>影響供給比率 ${esc(m.affected_supply_ratio_percent)}%、最短在庫 ${m.inventory_days_min ?? "該当なし"}日、金額影響 ${compactUsd(m.spend_at_risk_usd)}</span></li>
        <li><strong>Company Policy Gate</strong><span>${esc(m.policy_name)} に基づき ${esc(m.alert_level.label)} と判定</span></li>
        <li><strong>AI Scenario Brief</strong><span>計算済みmetricsを説明文、打ち手、確認ポイントに変換。実行判断は人間承認へ。</span></li>
      </ol>
    `,
  );
}

function renderLoadError(error) {
  setHtml(
    "view-scenario",
    `<section class="panel load-error"><h3>読み込みに失敗しました</h3><p>${esc(error.message || error)}</p></section>`,
  );
}

function optionHtml(options, selected) {
  return options
    .map((option) => `<option value="${esc(option.value)}" ${String(option.value) === String(selected) ? "selected" : ""}>${esc(option.label)}</option>`)
    .join("");
}

function listItems(rows, labeler) {
  return rows.length ? rows.map((row) => `<li>${esc(labeler(row))}</li>`).join("") : "<li>該当なし</li>";
}

function emptyState(text) {
  return `<div class="empty-state">${esc(text)}</div>`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function setBootText(text) {
  setText("boot-loader-text", text);
}

function hideBootLoader() {
  document.getElementById("boot-loader")?.classList.add("is-hidden");
}

function compactUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0ドル";
  if (Math.abs(n) >= 1_000_000) return `${trim1(n / 1_000_000)}百万ドル`;
  if (Math.abs(n) >= 1_000) return `${trim1(n / 1_000)}千ドル`;
  return `${Math.round(n).toLocaleString("ja-JP")}ドル`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function trim1(value) {
  const string = Number(value).toFixed(1);
  return string.endsWith(".0") ? string.slice(0, -2) : string;
}
