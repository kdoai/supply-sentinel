import { createMap } from "./map.js";
import { renderPanels } from "./panels.js";
import { createNetwork, networkLegendHtml } from "./network.js";
import { computeMetrics } from "./propagation.js";

const VIEW_TITLES = {
  dashboard: "監視ダッシュボード",
  analysis: "影響分析",
  response: "初動対応",
};

const MATERIAL_PROFILES = {
  naphtha: {
    label: "ナフサ",
    region: "Asia",
    headline: "ナフサ供給リスク",
    normalScore: 34,
    inventoryDays: 12,
  },
  "packaging-film": {
    label: "包装フィルム",
    region: "East Asia",
    headline: "包装フィルム供給リスク",
    normalScore: 24,
    inventoryDays: 18,
    inventory: [
      { material: "packaging-film", plant: "千葉工場", stock_qty: 1260, daily_usage: 70, unit: "roll", days_of_supply: 18 },
    ],
    alternatives: [
      { material: "packaging-film", alternative_material: "PKG-ALT-02", approved: true, lead_time_days: 9, constraints: "標準包装材のみ承認済み。高防湿グレードは品質確認が必要。" },
    ],
  },
  "semiconductor-adhesive": {
    label: "半導体接着材",
    region: "Europe",
    headline: "半導体接着材供給リスク",
    normalScore: 31,
    inventoryDays: 14,
    inventory: [
      { material: "semiconductor-adhesive", plant: "名古屋工場", stock_qty: 420, daily_usage: 30, unit: "kg", days_of_supply: 14 },
    ],
    alternatives: [
      { material: "semiconductor-adhesive", alternative_material: "ADH-ALT-01", approved: false, lead_time_days: 28, constraints: "顧客認定待ち。量産品への適用は未承認。" },
    ],
  },
};

let dashboardData = null;
let currentDashboardData = null;
let demoConfig = { stages: [], data_sources: [], interval_ms: 1800 };
let demoStep = 0;
let demoTimer = null;
let demoPlaying = false;
let worldGeojson = null;
let mapInstance = null;
let networkInstance = null;
let mapControlsBound = false;
let activeMaterial = "naphtha";
let scenarioIndex = { scenarios: [] };
let activeScenarioId = "";
let activeScenario = null;
let activeTimeseries = null;
let activeMonthIndex = -1;
let agentMessages = [];
let agentContextKey = "";
let agentChatBound = false;

function setLoaderText(message) {
  const el = document.getElementById("boot-loader-text");
  if (el) el.textContent = message;
}

function hideLoader() {
  document.getElementById("boot-loader")?.classList.add("is-hidden");
}

function showFatalError(message) {
  setLoaderText(`読み込みに失敗しました: ${message}`);
  const banner = document.createElement("div");
  banner.setAttribute("role", "alert");
  banner.style.cssText =
    "position:fixed;left:0;right:0;top:0;z-index:9999;" +
    "background:#7f1d1d;color:#fff;padding:12px 16px;font:13px/1.5 system-ui,sans-serif;";
  banner.textContent = `ダッシュボードの読み込みに失敗しました: ${message}`;
  document.body.appendChild(banner);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  return res.json();
}

function apiBaseUrl() {
  const config = window.SUPPLY_SENTINEL_CONFIG || {};
  return String(config.apiBase || "").replace(/\/$/, "");
}

async function fetchDashboardData() {
  const base = apiBaseUrl();
  const apiUrl = base ? `${base}/api/latest-dashboard` : "";
  if (apiUrl) {
    try {
      const payload = await fetchJson(apiUrl);
      if (payload && payload.dashboard) {
        payload.dashboard.meta = payload.dashboard.meta || {};
        payload.dashboard.meta.cloud = {
          served_at: payload.served_at || null,
          state_store: payload.state_store || "api",
          api_base: base,
          persisted: payload.state_store === "cosmos",
        };
        return payload.dashboard;
      }
    } catch (error) {
      console.warn("Cloud dashboard API unavailable; falling back to static demo data.", error);
    }
  }
  const fallback = await fetchJson("./dashboard_data.json");
  fallback.meta = fallback.meta || {};
  fallback.meta.cloud = {
    served_at: null,
    state_store: "static-json",
    api_base: "",
    persisted: false,
  };
  return fallback;
}

function ensureMap() {
  const canvasEl = document.getElementById("world-map");
  if (!canvasEl || !currentDashboardData || !worldGeojson) return;

  if (!mapInstance) {
    mapInstance = createMap(canvasEl, worldGeojson);
    bindMapControls(canvasEl);
    window.addEventListener("resize", () => {
      try {
        mapInstance.resize();
      } catch {
        // Ignore resize races.
      }
    });
  }

  requestAnimationFrame(() => {
    try {
      mapInstance.resize();
      mapInstance.render(currentDashboardData);
    } catch {
      // Ignore resize races.
    }
  });
}

function compactUsdJa(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0ドル";
  if (Math.abs(n) >= 1_000_000) return `${trim1(n / 1_000_000)}百万ドル`;
  if (Math.abs(n) >= 1_000) return `${trim1(n / 1_000)}千ドル`;
  return `${Math.round(n).toLocaleString("ja-JP")}ドル`;
}

function trim1(num) {
  const s = num.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function formatDateTime(value) {
  if (!value) return "不明";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function routeStatusLabel(status) {
  if (status === "disrupted") return "要対応";
  if (status === "resilient") return "代替可";
  if (status === "exposed") return "監視";
  return "通常";
}

function materialLabel(material) {
  return MATERIAL_PROFILES[material]?.label || material || "不明";
}

function scenarioAssetUrl(file) {
  return `./assets/scenarios/${String(file || "").replace(/^\.\//, "")}`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstText(items, fallback = "未特定") {
  const value = asArray(items)[0];
  if (!value) return fallback;
  if (typeof value === "string") return value;
  return value.product || value.customer || value.plant || value.name || value.order_id || value.title || fallback;
}

function joinTop(items, picker, fallback = "なし", limit = 3) {
  const values = asArray(items)
    .map((item) => (typeof picker === "function" ? picker(item) : item))
    .filter(Boolean)
    .slice(0, limit);
  return values.length ? values.join("、") : fallback;
}

function agentContextSignature(model) {
  return [
    activeScenarioId,
    activeMonthIndex,
    model?.assessment?.material,
    model?.assessment?.risk_score,
    model?.meta?.ai?.run_id || model?.meta?.cloud?.served_at || model?.meta?.generated_at,
  ].join("|");
}

function buildAgentContext(model) {
  const assessment = model?.assessment || {};
  const metrics = model?.propagation?.metrics || {};
  const ai = model?.meta?.ai || {};
  const cloud = model?.meta?.cloud || {};
  const routes = asArray(model?.route_intel?.routes);
  const affectedRoutes = routes.filter((route) => route.affected);
  const material = materialLabel(assessment.material || activeMaterial);
  const inventoryDays = metrics.inventory_days_min ?? assessment.inventory_days_min ?? "-";
  const affectedShare = metrics.affected_supply_ratio ?? model?.route_intel?.kpis?.affected_share_percent ?? 0;
  const spendAtRisk = metrics.spend_at_risk_usd ?? model?.route_intel?.kpis?.monthly_spend_at_risk ?? 0;
  return {
    material,
    score: assessment.risk_score ?? "-",
    severity: assessment.severity || model?.risk_event?.severity || "unknown",
    inventoryDays,
    affectedShare,
    spendAtRisk,
    products: asArray(assessment.impacted_products),
    customers: asArray(assessment.impacted_customers),
    orders: asArray(assessment.impacted_orders),
    plants: asArray(assessment.impacted_plants),
    actions: asArray(assessment.recommended_actions),
    approvals: asArray(assessment.approval_required),
    evidence: asArray(assessment.evidence).length ? asArray(assessment.evidence) : asArray(model?.risk_event?.evidence),
    alternatives: asArray(assessment.alternatives),
    affectedRoutes,
    ai,
    cloud,
  };
}

function agentStatusLabel(model) {
  const ai = model?.meta?.ai || {};
  const cloud = model?.meta?.cloud || {};
  const mode = ai.run_mode || (cloud.persisted ? "cloud" : "demo");
  const modelName = ai.model || "gpt-5.4-mini";
  const store = cloud.persisted ? "Cosmos保存済み" : "未保存";
  return `${modelName} / ${mode} / ${store}`;
}

function initialAgentMessage(model) {
  const ctx = buildAgentContext(model);
  const route = ctx.affectedRoutes[0];
  const product = firstText(ctx.products, "影響製品なし");
  const customer = firstText(ctx.customers, "影響顧客なし");
  const action = firstText(ctx.actions, "監視継続");
  return `
    <div class="agent-answer-title">初動判断を開始できます</div>
    <div class="agent-trace">
      <span>Risk Watcher</span>
      <span>Impact Mapper</span>
      <span>Response Planner</span>
    </div>
    <p>${esc(ctx.material)}のリスクスコアは <b>${esc(ctx.score)}</b>。影響調達比率は <b>${esc(ctx.affectedShare)}%</b>、最短在庫は <b>${esc(ctx.inventoryDays)}日</b>です。</p>
    <ul>
      <li>要注意ルート: ${esc(route ? `${route.origin?.name || route.supplier} → ${route.plant?.name || "自社工場"}` : "なし")}</li>
      <li>影響候補: ${esc(product)} / ${esc(customer)}</li>
      <li>まずの起案: ${esc(action)}</li>
    </ul>`;
}

function makeAgentAnswer(question, model) {
  const ctx = buildAgentContext(model);
  const normalized = String(question || "").toLowerCase();
  const routeText = joinTop(ctx.affectedRoutes, (route) => `${route.supplier || route.origin?.name}→${route.plant?.name || "工場"}`);
  const productText = joinTop(ctx.products, (item) => item.product || item.name || item);
  const customerText = joinTop(ctx.customers, (item) => item.customer || item.name || item);
  const evidenceText = joinTop(ctx.evidence, (item) => item.text || item.claim || item.summary || item, "根拠データなし", 4);
  const approvalText = joinTop(ctx.approvals, (item) => item.action || item.title || item, "承認事項なし");
  const alternativeText = joinTop(ctx.alternatives, (item) => {
    const name = item.alternative_material || item.material || item.name;
    const state = item.approved ? "承認済み" : "要確認";
    return name ? `${name}(${state})` : "";
  });

  let title = "初動プラン";
  let bullets = [
    `${ctx.material}はリスク${ctx.score}、影響調達比率${ctx.affectedShare}%、最短在庫${ctx.inventoryDays}日として扱います。`,
    `最初に確認すべき供給ルートは ${routeText} です。`,
    `調達・生産・営業は、${productText} / ${customerText} への波及を同じ前提で確認します。`,
  ];

  if (normalized.includes("根拠") || normalized.includes("エビデンス") || normalized.includes("なぜ")) {
    title = "判断根拠";
    bullets = [
      `外部原文から抽出した主な根拠は「${evidenceText}」です。`,
      `社内照合では、影響調達比率${ctx.affectedShare}%、最短在庫${ctx.inventoryDays}日、リスク金額${compactUsdJa(ctx.spendAtRisk)}を確認しています。`,
      "AIは確定判断ではなく、根拠と影響範囲をそろえて人の判断を早める役割です。",
    ];
  } else if (normalized.includes("代替") || normalized.includes("切替")) {
    title = "代替策";
    bullets = [
      `代替候補は ${alternativeText} です。`,
      `承認済み候補から先に引当可否を確認し、未承認候補は品質・顧客認定の確認タスクに分けます。`,
      `サプライヤ切替や正式発注変更は ${approvalText} として人の承認に残します。`,
    ];
  } else if (normalized.includes("顧客") || normalized.includes("営業")) {
    title = "顧客影響";
    bullets = [
      `優先して見る顧客は ${customerText} です。`,
      `影響製品は ${productText}。受注一覧では納期が近いものから確認します。`,
      "顧客への正式通知はAIが文案まで準備し、営業責任者が送信判断します。",
    ];
  } else if (normalized.includes("誰") || normalized.includes("まず") || normalized.includes("何")) {
    title = "最初の30分";
    bullets = [
      `調達: ${routeText} の納期・割当率・代替ロット有無をサプライヤに確認します。`,
      `生産管理: ${productText} の在庫${ctx.inventoryDays}日を前提に、止まりやすいラインを確認します。`,
      `営業: ${customerText} への影響可能性を先に把握し、正式連絡は承認後にします。`,
    ];
  }

  return `
    <div class="agent-answer-title">${esc(title)}</div>
    <div class="agent-trace">
      <span>1. 外部シグナル</span>
      <span>2. 在庫/BOM照合</span>
      <span>3. 初動起案</span>
    </div>
    <ul>${bullets.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
    <p class="agent-footnote">実行判断が必要なもの: ${esc(approvalText)}</p>`;
}

function addAgentMessage(role, html) {
  agentMessages.push({ role, html });
  renderAgentPanel(currentDashboardData);
}

function renderAgentPanel(model) {
  const status = document.getElementById("agent-status");
  const thread = document.getElementById("agent-thread");
  const suggestions = document.getElementById("agent-suggestions");
  if (!thread || !suggestions) return;

  if (status) status.textContent = agentStatusLabel(model);
  const key = agentContextSignature(model);
  if (key !== agentContextKey) {
    agentContextKey = key;
    agentMessages = [{ role: "assistant", html: initialAgentMessage(model) }];
  }

  thread.innerHTML = agentMessages
    .map(
      (message) => `
        <article class="agent-message agent-message-${message.role}">
          <span>${message.role === "user" ? "あなた" : "Supply Sentinel AI"}</span>
          <div>${message.html}</div>
        </article>`,
    )
    .join("");
  suggestions.innerHTML = ["まず何をする？", "根拠を見せて", "代替策は？", "顧客影響を要約"]
    .map((text) => `<button type="button" data-agent-question="${esc(text)}">${esc(text)}</button>`)
    .join("");
  thread.scrollTop = thread.scrollHeight;
}

function askAgent(question) {
  const trimmed = String(question || "").trim();
  if (!trimmed || !currentDashboardData) return;
  addAgentMessage("user", `<p>${esc(trimmed)}</p>`);
  window.setTimeout(() => {
    addAgentMessage("assistant", makeAgentAnswer(trimmed, currentDashboardData));
  }, 180);
}

function bindAgentChat() {
  if (agentChatBound) return;
  agentChatBound = true;
  document.getElementById("agent-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("agent-input");
    const question = input?.value || "";
    if (input) input.value = "";
    askAgent(question);
  });
  document.getElementById("agent-suggestions")?.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-agent-question]");
    if (!button) return;
    askAgent(button.getAttribute("data-agent-question"));
  });
}

function renderMapInsight(detail) {
  const el = document.getElementById("map-insight");
  if (!el) return;

  if (!detail) {
    const routes = (((currentDashboardData || {}).route_intel || {}).routes || [])
      .filter((route) => route.material === activeMaterial);
    const affectedShare = routes
      .filter((route) => route.affected)
      .reduce((sum, route) => sum + (Number(route.share_percent) || 0), 0);
    el.innerHTML = `
      <span class="map-insight-kicker">マップ分析</span>
      <strong>${esc(materialLabel(activeMaterial))}供給網の要注意地点</strong>
      <p>赤いルートは割当制限・遅延の可能性がある調達経路です。監視対象を切り替えると、同じ仕組みで他の重要物資も確認できます。</p>
      <dl>
        <div><dt>影響調達比率</dt><dd class="route-risk">${esc(affectedShare)}%</dd></div>
        <div><dt>要対応ルート</dt><dd>${esc(routes.filter((route) => route.affected).length)}件</dd></div>
      </dl>`;
    return;
  }

  if (detail.type === "route" && detail.route) {
    const route = detail.route;
    const status = routeStatusLabel(route.status);
    const riskClass = route.status === "disrupted" ? "route-risk" : "";
    el.innerHTML = `
      <span class="map-insight-kicker">選択中のルート</span>
      <strong>${esc(route.origin?.name)} → ${esc(route.plant?.name)}</strong>
      <p>${esc(route.supplier)} / ${esc(materialLabel(route.material))}。調達比率とリードタイムを見ながら、どの工場に波及するか確認できます。</p>
      <dl>
        <div><dt>状態</dt><dd class="${riskClass}">${esc(status)}</dd></div>
        <div><dt>調達比率</dt><dd>${esc(route.share_percent)}%</dd></div>
        <div><dt>月間調達額</dt><dd>${esc(compactUsdJa(route.monthly_spend_usd))}</dd></div>
        <div><dt>リードタイム</dt><dd>${esc(route.lead_time_days)}日</dd></div>
      </dl>`;
    return;
  }

  if (detail.type === "node" && detail.node) {
    const node = detail.node;
    const related = (((currentDashboardData || {}).route_intel || {}).routes || []).filter((route) => {
      return route.origin?.name === node.label || route.port?.name === node.label || route.plant?.name === node.label;
    });
    const affected = related.filter((route) => route.affected);
    el.innerHTML = `
      <span class="map-insight-kicker">選択中の拠点</span>
      <strong>${esc(node.label)}</strong>
      <p>${esc(node.sublabel || "供給網ノード")}。関連ルートの状態から、自社影響の有無を確認します。</p>
      <dl>
        <div><dt>関連ルート</dt><dd>${esc(related.length)}件</dd></div>
        <div><dt>要対応</dt><dd class="${affected.length ? "route-risk" : ""}">${esc(affected.length)}件</dd></div>
      </dl>`;
  }
}

function clearLinkHighlight() {
  document
    .querySelectorAll(".sourcing-row.is-linked, .kpi-card.is-linked")
    .forEach((el) => el.classList.remove("is-linked"));
}

// Connect a map selection to the business panels: highlight the matching
// 調達構成 row(s) and, for an affected route, the KPI cards it feeds into.
function applyLinkHighlight(detail) {
  clearLinkHighlight();
  if (!detail) return;
  const routes = ((currentDashboardData || {}).route_intel || {}).routes || [];

  let ids = [];
  let affected = false;
  if (detail.type === "route" && detail.route) {
    ids = [detail.route.route_id];
    affected = Boolean(detail.route.affected);
  } else if (detail.type === "node" && detail.node) {
    const label = detail.node.label;
    const related = routes.filter(
      (route) => route.origin?.name === label || route.port?.name === label || route.plant?.name === label,
    );
    ids = related.map((route) => route.route_id);
    affected = related.some((route) => route.affected);
  }

  for (const id of ids) {
    if (!id) continue;
    document.querySelector(`.sourcing-row[data-route-id="${id}"]`)?.classList.add("is-linked");
  }
  if (affected) {
    document
      .querySelectorAll('.kpi-card[data-kpi="affected-share"], .kpi-card[data-kpi="spend"], .kpi-card[data-kpi="routes"]')
      .forEach((el) => el.classList.add("is-linked"));
  }
}

function bindSourcingInteraction() {
  const el = document.getElementById("sourcing-mix");
  if (!el || el.dataset.bound === "1") return;
  el.dataset.bound = "1";

  function selectFromRow(row) {
    const routeId = row.getAttribute("data-route-id");
    if (!routeId) return;
    const route = (((currentDashboardData || {}).route_intel || {}).routes || []).find(
      (item) => item.route_id === routeId,
    );
    if (!route) return;
    mapInstance?.highlightRoute(routeId);
    const detail = { type: "route", route };
    renderMapInsight(detail);
    applyLinkHighlight(detail);
  }

  el.addEventListener("click", (event) => {
    const row = event.target.closest?.(".sourcing-row[data-route-id]");
    if (row) selectFromRow(row);
  });
  el.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest?.(".sourcing-row[data-route-id]");
    if (!row) return;
    event.preventDefault();
    selectFromRow(row);
  });
}

function bindMapControls(canvasEl) {
  if (mapControlsBound) return;
  mapControlsBound = true;

  document.getElementById("map-zoom-in")?.addEventListener("click", () => mapInstance?.zoomIn());
  document.getElementById("map-zoom-out")?.addEventListener("click", () => mapInstance?.zoomOut());
  document.getElementById("map-reset")?.addEventListener("click", () => {
    mapInstance?.resetView();
    renderMapInsight(null);
    clearLinkHighlight();
  });
  document.querySelectorAll("[data-map-focus]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.mapFocus === "japan") mapInstance?.focusJapan();
      else mapInstance?.focusAsia();
    });
  });
  canvasEl.addEventListener("supply-map-select", (event) => {
    renderMapInsight(event.detail);
    applyLinkHighlight(event.detail);
  });
}

function bindMaterialSwitch() {
  const el = document.getElementById("material-switch");
  if (!el) return;
  const materials = Object.keys(MATERIAL_PROFILES);
  el.innerHTML = materials
    .map((material) => `<button type="button" class="material-chip${material === activeMaterial ? " is-active" : ""}" data-material="${esc(material)}">${esc(materialLabel(material))}</button>`)
    .join("");
  el.querySelectorAll("[data-material]").forEach((button) => {
    button.addEventListener("click", async () => {
      const next = button.getAttribute("data-material");
      if (!MATERIAL_PROFILES[next] || next === activeMaterial) return;
      activeMaterial = next;
      const scenario = (scenarioIndex.scenarios || []).find((item) => item.material === next);
      if (scenario) {
        await loadScenario(scenario.id);
      }
      stopDemo();
      demoStep = activeMaterial === "naphtha" ? Math.max(0, (demoConfig.stages || []).length - 1) : 0;
      mapInstance?.resetView();
      bindMaterialSwitch();
      bindScenarioSwitch();
      renderCurrentDashboard();
    });
  });
}

function bindScenarioSwitch() {
  const el = document.getElementById("scenario-switch");
  if (!el) return;
  const items = scenarioIndex.scenarios || [];
  el.innerHTML = items
    .map((item) => {
      const active = item.id === activeScenarioId ? " is-active" : "";
      return `<button type="button" class="scenario-chip${active}" data-scenario-id="${esc(item.id)}">${esc(item.short || item.label)}</button>`;
    })
    .join("");
  el.querySelectorAll("[data-scenario-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const next = button.getAttribute("data-scenario-id");
      if (!next || next === activeScenarioId) return;
      await loadScenario(next);
      activeMaterial = activeScenario?.material || activeMaterial;
      stopDemo();
      demoStep = Math.max(0, (demoConfig.stages || []).length - 1);
      mapInstance?.resetView();
      networkInstance?.clear();
      bindMaterialSwitch();
      bindScenarioSwitch();
      renderCurrentDashboard();
    });
  });
}

async function loadScenario(id) {
  if (!id) return;
  const scenario = await fetchJson(scenarioAssetUrl(`${id}.json`));
  const timeseriesFile = scenario.timeseries_ref
    ? scenario.timeseries_ref.replace(/^\.\//, "")
    : `${id}.timeseries.json`;
  const timeseries = await fetchJson(scenarioAssetUrl(timeseriesFile)).catch(() => ({ scenario_id: id, months: [] }));
  activeScenarioId = id;
  activeScenario = scenario;
  activeTimeseries = timeseries;
  activeMonthIndex = Math.max(0, (timeseries.months || []).length - 1);
}

function scenarioByMaterial(material) {
  return (scenarioIndex.scenarios || []).find((item) => item.material === material) || null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function scoreSeverity(score, fallback = "medium") {
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  if (score >= 1) return "low";
  return fallback;
}

function visibleSlice(items, count) {
  return Array.isArray(items) ? items.slice(0, Math.max(0, Number(count) || 0)) : [];
}

function sourceTimeToIso(stageIndex) {
  const base = new Date("2026-05-31T06:30:00+09:00");
  base.setMinutes(base.getMinutes() + stageIndex);
  return base.toISOString();
}

function updateRouteState(route, stage, material = activeMaterial) {
  if (!route || route.material !== material) {
    route.affected = false;
    route.status = route.baseline_status || "normal";
    return route;
  }
  const affected = stage.affected_route_ids.includes(route.route_id);
  const resilient = stage.resilient_route_ids.includes(route.route_id);
  route.affected = affected;
  route.status = affected ? "disrupted" : resilient ? "resilient" : "normal";
  return route;
}

function recalcSourcing(model, material = activeMaterial) {
  const routes = ((model.route_intel || {}).routes || []).filter((route) => route.material === material);
  const affectedRoutes = routes.filter((route) => route.affected);
  const affectedShare = affectedRoutes.reduce((sum, route) => sum + (Number(route.share_percent) || 0), 0);
  const affectedSpend = affectedRoutes.reduce((sum, route) => sum + (Number(route.monthly_spend_usd) || 0), 0);
  const totalSpend = routes.reduce((sum, route) => sum + (Number(route.monthly_spend_usd) || 0), 0);

  const focalRoutes = routes.map((route) => ({
    route_id: route.route_id,
    origin: route.origin && route.origin.name,
    region: route.region,
    supplier: route.supplier,
    share_percent: route.share_percent,
    monthly_spend_usd: route.monthly_spend_usd,
    lead_time_days: route.lead_time_days,
    status: route.status,
    affected: route.affected,
  }));

  const focal = {
    material,
    total_share: 100,
    total_spend: totalSpend,
    affected_share: affectedShare,
    affected_spend: affectedSpend,
    route_count: routes.length,
    affected_count: affectedRoutes.length,
    routes: focalRoutes,
  };

  model.route_intel.sourcing = model.route_intel.sourcing || {};
  model.route_intel.sourcing.focal = focal;
  model.route_intel.sourcing.by_material = model.route_intel.sourcing.by_material || {};
  model.route_intel.sourcing.by_material[material] = focal;
  model.route_intel.kpis = {
    ...(model.route_intel.kpis || {}),
    total_routes: routes.length,
    affected_routes: affectedRoutes.length,
    affected_share_percent: affectedShare,
    total_monthly_spend: totalSpend,
    monthly_spend_at_risk: affectedSpend,
  };
}

function updateMapNodes(model) {
  const routeLabels = new Set();
  for (const route of (model.route_intel || {}).routes || []) {
    if (route.origin && route.origin.name) routeLabels.add(route.origin.name);
    if (route.port && route.port.name) routeLabels.add(route.port.name);
    if (route.plant && route.plant.name) routeLabels.add(route.plant.name);
  }
  model.route_intel.map_nodes = ((model.route_intel || {}).map_nodes || []).filter((node) => routeLabels.has(node.label));

  const affectedLabels = new Set();
  for (const route of (model.route_intel || {}).routes || []) {
    if (!route.affected) continue;
    if (route.origin && route.origin.name) affectedLabels.add(route.origin.name);
    if (route.port && route.port.name) affectedLabels.add(route.port.name);
    if (route.plant && route.plant.name) affectedLabels.add(route.plant.name);
  }
  for (const node of (model.route_intel || {}).map_nodes || []) {
    node.affected = affectedLabels.has(node.label);
  }
}

function buildRouteFlow(routes) {
  const nodes = [];
  const edges = [];
  const seen = new Set();

  function addNode(id, stage, label, sublabel, type, value, status = "normal") {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, stage, label, sublabel, type, value, status });
  }

  for (const route of routes || []) {
    const status = route.affected ? "disrupted" : route.status || "normal";
    const originId = `o:${route.origin?.name}`;
    const supplierId = `m:${route.supplier}`;
    const plantId = `p:${route.plant?.name}`;
    addNode(originId, 0, route.origin?.name, route.region, "origin", route.share_percent, status);
    addNode(supplierId, 1, route.supplier, route.port?.name || route.transport_mode, "supplier", route.share_percent, status);
    addNode(plantId, 2, route.plant?.name, "plant", "plant", route.share_percent, status);
    edges.push({ source: originId, target: supplierId, value: route.share_percent, status });
    edges.push({ source: supplierId, target: plantId, value: route.share_percent, status });
  }

  return { nodes, edges };
}

function networkColumnOf(node) {
  if (node.kind === "customer") return 4;
  if (node.kind === "product") return 3;
  if (node.kind === "plant" || node.kind === "self") return 2;
  if (node.tier === 1 || node.kind === "port") return 1;
  return 0;
}

function buildFlowFromNetwork(network, propagation) {
  const statusByNode = propagation?.node_status || {};
  const statusByEdge = propagation?.edge_status || {};
  const nodes = (network?.nodes || []).map((node) => ({
    id: node.id,
    stage: networkColumnOf(node),
    label: node.name,
    sublabel: node.makes || node.role_note || node.country || "",
    type: node.kind,
    value: node.priority || node.region || "",
    status: statusByNode[node.id]?.status || "normal",
  }));
  const edges = (network?.edges || []).map((edge) => ({
    source: edge.source,
    target: edge.target,
    value: edge.share_percent || edge.monthly_volume || 20,
    status: statusByEdge[edge.id] || "normal",
  }));
  return { nodes, edges };
}

function networkNodeById(network) {
  return new Map((network?.nodes || []).map((node) => [node.id, node]));
}

function inboundSelfEdges(network) {
  const byId = networkNodeById(network);
  return (network?.edges || []).filter((edge) => {
    const target = byId.get(edge.target);
    return target && (target.kind === "plant" || target.kind === "self") && edge.material === network.focal_material;
  });
}

function buildRoutesFromNetwork(network, propagation, scenario) {
  const byId = networkNodeById(network);
  const edgeStatus = propagation?.edge_status || {};
  return inboundSelfEdges(network).map((edge) => {
    const source = byId.get(edge.source) || {};
    const target = byId.get(edge.target) || {};
    const status = edgeStatus[edge.id] || "normal";
    return {
      route_id: edge.id,
      material: network.focal_material || scenario.material,
      origin: { name: source.name, lat: source.lat, lng: source.lng },
      port: null,
      plant: { name: target.name, lat: target.lat, lng: target.lng },
      region: source.region || target.region || scenario.region,
      supplier: source.name,
      share_percent: edge.share_percent,
      monthly_spend_usd: edge.monthly_spend_usd,
      lead_time_days: edge.lead_time_days,
      transport_mode: edge.transport_mode,
      status,
      baseline_status: "normal",
      affected: status === "disrupted" || status === "exposed",
    };
  });
}

function buildMapNodesFromNetwork(network, propagation) {
  const nodeStatus = propagation?.node_status || {};
  return (network?.nodes || [])
    .filter((node) => Number.isFinite(Number(node.lat)) && Number.isFinite(Number(node.lng)))
    .map((node) => ({
      id: node.id,
      label: node.name,
      sublabel: node.makes || node.role_note || node.country || "",
      lat: Number(node.lat),
      lng: Number(node.lng),
      type: node.kind === "plant" ? "plant" : "supplier",
      affected: nodeStatus[node.id]?.status === "disrupted",
    }));
}

function impactedPlants(network, propagation) {
  const byId = networkNodeById(network);
  const availability = propagation?.availability || {};
  const plantIds = new Set();
  for (const edge of network?.edges || []) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source?.kind === "plant" && target?.kind === "product" && Number(availability[target.id] ?? 1) < 0.999) {
      plantIds.add(source.name);
    }
  }
  return [...plantIds];
}

function enrichOrders(network, orders) {
  const byId = networkNodeById(network);
  const productToPlant = new Map();
  for (const edge of network?.edges || []) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source?.kind === "plant" && target?.kind === "product") {
      productToPlant.set(target.name, source.name);
    }
  }
  return asArray(orders).map((order, index) => ({
    order_id: order.order_id || `SO-DEMO-${index + 1}`,
    customer: order.customer,
    product: order.product,
    plant: productToPlant.get(order.product) || "",
    due_date: index === 0 ? "5営業日以内" : "月内",
    quantity: order.quantity,
    priority: order.priority,
  }));
}

function sourceKindLabel(kind) {
  const labels = {
    news: "ニュース",
    supplier_notice: "サプライヤ通知",
    logistics: "物流情報",
    price_feed: "価格情報",
  };
  return labels[kind] || kind || "情報源";
}

function riskTypeFromScenario(scenario) {
  const type = scenario?.disruption?.type;
  if (type === "logistics") return "logistics_delay";
  if (type === "price") return "price_spike";
  if (type === "allocation") return "allocation";
  return type || "supply_delay";
}

function buildAiInputsFromProvenance(sources) {
  return asArray(sources).map((source) => {
    if (source.kind === "supplier_notice") {
      return {
        kind: "supplier",
        supplier: source.source,
        subject: source.label || "サプライヤ通知",
        body: source.claim,
      };
    }
    return {
      kind: "news",
      source: source.source || sourceKindLabel(source.kind),
      headline: source.label || sourceKindLabel(source.kind),
      summary: source.claim,
    };
  });
}

function activeSourcesForMonth(scenario, month) {
  const selected = new Set(asArray(month?.sources));
  const all = asArray(scenario?.provenance);
  const filtered = selected.size ? all.filter((source) => selected.has(source.id)) : all;
  return filtered.length ? filtered : all;
}

function buildRecommendedActions(scenario, metrics) {
  const material = materialLabel(scenario.material);
  if (!metrics || Number(metrics.risk_score || 0) < 45) return [];
  const actions = [
    `${material}の主要サプライヤへ、次回割当数量・出荷予定・代替ルート余力を確認する。`,
    `在庫${metrics.inventory_days_min ?? "-"}日以内に影響する受注を優先順に並べ替える。`,
    `影響顧客${asArray(metrics.impacted_customers).length}社向けに、説明文案と代替提案を準備する。`,
  ];
  if (Number(metrics.spend_at_risk_usd || 0) > 0) {
    actions.splice(1, 0, `月間${compactUsdJa(metrics.spend_at_risk_usd)}相当の調達影響について、購買・生産管理で初動会議を設定する。`);
  }
  return actions;
}

function buildScenarioOverlayModel(baseModel) {
  if (!activeScenario || !activeScenario.network) return baseModel;
  const scenario = activeScenario;
  const months = asArray(activeTimeseries?.months);
  const month = months[Math.max(0, Math.min(activeMonthIndex, months.length - 1))] || {};
  const propagation = computeMetrics(scenario.network, month.disruption || scenario.disruption || {}, {
    inventory: month.inventory || scenario.inventory || [],
    alternatives: scenario.alternatives || [],
    risk_inputs: month.risk_inputs || scenario.risk_inputs || {},
  });
  const metrics = propagation.metrics || {};
  const sources = activeSourcesForMonth(scenario, month);
  const evidence = sources.map((source) => `${sourceKindLabel(source.kind)}: ${source.claim}`);
  const routes = buildRoutesFromNetwork(scenario.network, propagation, scenario);
  const affectedRoutes = routes.filter((route) => route.affected);
  const affectedShare = metrics.affected_supply_ratio ?? affectedRoutes.reduce((sum, route) => sum + (Number(route.share_percent) || 0), 0);
  const spendAtRisk = metrics.spend_at_risk_usd ?? affectedRoutes.reduce((sum, route) => sum + (Number(route.monthly_spend_usd) || 0), 0);
  const totalSpend = metrics.total_spend_usd ?? routes.reduce((sum, route) => sum + (Number(route.monthly_spend_usd) || 0), 0);
  const inventory = asArray(month.inventory || scenario.inventory).map((row) => ({
    ...row,
    days_of_supply: Number.isFinite(Number(row.stock_qty) / Number(row.daily_usage))
      ? trim1(Number(row.stock_qty) / Number(row.daily_usage))
      : row.days_of_supply,
  }));

  const overlay = cloneJson(baseModel);
  overlay.meta = overlay.meta || {};
  overlay.meta.scenario = scenario.id;
  overlay.meta.generated_at = month.month ? `${month.month}-28T09:00:00+09:00` : overlay.meta.generated_at;
  overlay.meta.ai = {
    ...(overlay.meta.ai || {}),
    provider: "Azure OpenAI",
    model: overlay.meta.ai?.model || "gpt-5.4-mini",
    model_label: overlay.meta.ai?.model_label || "Azure OpenAI · gpt-5.4-mini",
    run_mode: overlay.meta.ai?.run_mode || "cloud",
    inputs: buildAiInputsFromProvenance(sources),
  };
  overlay.risk_event = {
    ...(overlay.risk_event || {}),
    material: scenario.material,
    region: scenario.network.nodes?.find((node) => (month.disruption?.hit_nodes || scenario.disruption?.hit_nodes || []).includes(node.id))?.region || "Asia",
    risk_type: riskTypeFromScenario(scenario),
    severity: metrics.event_severity || metrics.severity || "medium",
    confidence: month.risk_inputs?.confidence || scenario.risk_inputs?.confidence || "medium",
    summary: scenario.headline,
    affected_period: "今後2〜3週間",
    delay_days_min: scenario.disruption?.type === "price" ? null : 5,
    delay_days_max: scenario.disruption?.type === "price" ? null : 14,
    allocation_rate_percent: scenario.disruption?.capacity_drop != null
      ? Math.round((1 - Number(scenario.disruption.capacity_drop)) * 100)
      : null,
    evidence,
  };
  overlay.assessment = {
    ...(overlay.assessment || {}),
    material: scenario.material,
    alert_id: scenario.id,
    risk_score: metrics.risk_score,
    severity: metrics.severity,
    inventory_days_min: metrics.inventory_days_min,
    evidence,
    scoring_factors: metrics.scoring_factors || {},
    impacted_products: metrics.impacted_products || [],
    impacted_customers: metrics.impacted_customers || [],
    impacted_orders: enrichOrders(scenario.network, metrics.impacted_orders || []),
    impacted_plants: impactedPlants(scenario.network, propagation),
    inventory,
    alternatives: cloneJson(scenario.alternatives || []),
    recommended_actions: buildRecommendedActions(scenario, metrics),
    approval_required: Number(metrics.risk_score || 0) >= 70
      ? ["Purchase order changes", "Supplier switching", "Formal customer notification", "Major production plan changes"]
      : [],
    generated_at: overlay.meta.generated_at,
  };
  const focal = {
    material: scenario.material,
    total_share: 100,
    total_spend: totalSpend,
    affected_share: affectedShare,
    affected_spend: spendAtRisk,
    route_count: routes.length,
    affected_count: affectedRoutes.length,
    routes: routes.map((route) => ({
      route_id: route.route_id,
      origin: route.origin?.name,
      region: route.region,
      supplier: route.supplier,
      share_percent: route.share_percent,
      monthly_spend_usd: route.monthly_spend_usd,
      lead_time_days: route.lead_time_days,
      status: route.status,
      affected: route.affected,
    })),
  };
  overlay.route_intel = {
    ...(overlay.route_intel || {}),
    routes,
    map_nodes: buildMapNodesFromNetwork(scenario.network, propagation),
    sourcing: { focal, by_material: { [scenario.material]: focal } },
    kpis: {
      focal_material: scenario.material,
      total_routes: routes.length,
      affected_routes: affectedRoutes.length,
      affected_share_percent: affectedShare,
      total_monthly_spend: totalSpend,
      monthly_spend_at_risk: spendAtRisk,
    },
    flow: buildFlowFromNetwork(scenario.network, propagation),
  };
  overlay.supply_network = {
    focal_material: scenario.material,
    nodes: scenario.network.nodes,
    edges: scenario.network.edges,
    node_status: propagation.node_status,
    edge_status: propagation.edge_status,
  };
  overlay.propagation = propagation;
  overlay.provenance = sources;
  overlay.month = month;
  overlay.timeline = months;
  overlay.story = scenario.layperson_story;
  overlay.demo = {
    ...(overlay.demo || {}),
    title: scenario.headline,
    detail: scenario.layperson_story,
    time_label: month.label || overlay.demo?.time_label,
    score_trend: months.map((item) => ({ time_label: item.label, score: item.metrics?.risk_score ?? computeMetrics(scenario.network, item.disruption || {}, {
      inventory: item.inventory || scenario.inventory || [],
      alternatives: scenario.alternatives || [],
      risk_inputs: item.risk_inputs || scenario.risk_inputs || {},
    }).metrics.risk_score })),
    data_sources: asArray(scenario.provenance).map((source) => ({
      name: source.label,
      candidate: source.source,
      status: sourceKindLabel(source.kind),
      freshness: source.published_at || source.received_at ? formatDateTime(source.published_at || source.received_at) : "デモ",
      confidence: source.confidence || "-",
    })),
  };
  return overlay;
}

function updateFlow(model) {
  if (activeMaterial !== "naphtha") {
    model.route_intel.flow = buildRouteFlow((model.route_intel || {}).routes || []);
  }
  const affectedIds = new Set();
  for (const route of (model.route_intel || {}).routes || []) {
    if (!route.affected) continue;
    if (route.origin && route.origin.name) affectedIds.add(`o:${route.origin.name}`);
    if (route.supplier) affectedIds.add(`m:${route.supplier}`);
    if (route.plant && route.plant.name) affectedIds.add(`p:${route.plant.name}`);
  }
  const flow = (model.route_intel || {}).flow || {};
  for (const node of flow.nodes || []) {
    node.status = affectedIds.has(node.id) ? "disrupted" : "normal";
  }
  for (const edge of flow.edges || []) {
    edge.status = affectedIds.has(edge.source) || affectedIds.has(edge.target) ? "disrupted" : "normal";
  }
}

function applyDemoStage(base, step) {
  const stages = demoConfig.stages || [];
  const stageIndex = Math.max(0, Math.min(stages.length - 1, step));
  const stage = stages[stageIndex] || {};
  const model = cloneJson(base);
  const profile = MATERIAL_PROFILES[activeMaterial] || MATERIAL_PROFILES.naphtha;
  const isNaphtha = activeMaterial === "naphtha";
  stage.affected_route_ids = Array.isArray(stage.affected_route_ids) ? stage.affected_route_ids : [];
  stage.resilient_route_ids = Array.isArray(stage.resilient_route_ids) ? stage.resilient_route_ids : [];
  const effectiveStage = isNaphtha
    ? stage
    : {
        ...stage,
        title: `${profile.label}を通常監視`,
        source: "Supply Sentinel エージェント",
        source_type: "agent",
        detail: "外部シグナルと社内データを照合しましたが、現時点で初動対応が必要な供給リスクはありません。",
        score: profile.normalScore,
        severity: "low",
        inventory_days_min: profile.inventoryDays,
        affected_route_ids: [],
        resilient_route_ids: [],
        evidence_count: 0,
        recommended_count: 0,
        approval_count: 0,
        impacted_product_count: 0,
        impacted_customer_count: 0,
        impacted_order_count: 0,
      };

  model.meta = model.meta || {};
  model.meta.generated_at = sourceTimeToIso(stageIndex);

  model.risk_event = model.risk_event || {};
  model.risk_event.material = activeMaterial;
  model.risk_event.region = profile.region;
  model.risk_event.summary = isNaphtha ? model.risk_event.summary : `${profile.label}は通常監視中。要対応シグナルなし。`;
  model.risk_event.severity = effectiveStage.severity || scoreSeverity(effectiveStage.score);
  model.risk_event.evidence = isNaphtha ? visibleSlice(base.risk_event && base.risk_event.evidence, effectiveStage.evidence_count) : [];

  model.assessment = model.assessment || {};
  model.assessment.material = activeMaterial;
  model.assessment.risk_score = effectiveStage.score ?? model.assessment.risk_score;
  model.assessment.severity = effectiveStage.severity || scoreSeverity(model.assessment.risk_score);
  model.assessment.inventory_days_min = effectiveStage.inventory_days_min ?? model.assessment.inventory_days_min;
  model.assessment.evidence = isNaphtha ? visibleSlice(base.assessment && base.assessment.evidence, effectiveStage.evidence_count) : [];
  model.assessment.recommended_actions = isNaphtha ? visibleSlice(base.assessment && base.assessment.recommended_actions, effectiveStage.recommended_count) : [];
  model.assessment.approval_required = isNaphtha ? visibleSlice(base.assessment && base.assessment.approval_required, effectiveStage.approval_count) : [];
  model.assessment.impacted_products = isNaphtha ? visibleSlice(base.assessment && base.assessment.impacted_products, effectiveStage.impacted_product_count) : [];
  model.assessment.impacted_customers = isNaphtha ? visibleSlice(base.assessment && base.assessment.impacted_customers, effectiveStage.impacted_customer_count) : [];
  model.assessment.impacted_orders = isNaphtha ? visibleSlice(base.assessment && base.assessment.impacted_orders, effectiveStage.impacted_order_count) : [];
  model.assessment.impacted_plants = isNaphtha && effectiveStage.impacted_product_count > 0
    ? visibleSlice(base.assessment && base.assessment.impacted_plants, effectiveStage.impacted_product_count > 2 ? 2 : 1)
    : [];
  model.assessment.inventory = isNaphtha ? model.assessment.inventory : cloneJson(profile.inventory || []);
  model.assessment.alternatives = isNaphtha ? model.assessment.alternatives : cloneJson(profile.alternatives || []);
  model.assessment.generated_at = model.meta.generated_at;
  for (const item of model.assessment.inventory || []) {
    if (isNaphtha && item.plant === "千葉工場") item.days_of_supply = effectiveStage.inventory_days_min ?? item.days_of_supply;
    if (isNaphtha && item.plant === "大阪工場") item.days_of_supply = Math.max(10, (effectiveStage.inventory_days_min ?? 5) + 5);
  }

  for (const route of (model.route_intel || {}).routes || []) {
    updateRouteState(route, effectiveStage, activeMaterial);
  }
  recalcSourcing(model, activeMaterial);
  model.route_intel.routes = (model.route_intel.routes || []).filter((route) => route.material === activeMaterial);
  updateMapNodes(model);
  updateFlow(model);

  model.demo = {
    ...effectiveStage,
    step_index: stageIndex,
    total_steps: stages.length,
    is_playing: demoPlaying,
    active_events: isNaphtha ? stages.slice(0, stageIndex + 1) : [effectiveStage],
    score_trend: (isNaphtha ? stages.slice(0, stageIndex + 1) : [effectiveStage]).map((event) => ({
      time_label: event.time_label,
      score: event.score,
    })),
    data_sources: demoConfig.data_sources || [],
  };
  return model;
}

function renderNetworkSelection(detail) {
  const el = document.getElementById("network-selection");
  if (!el) return;
  if (!detail || !detail.node) {
    el.innerHTML = `
      <span class="network-selection-kicker">選択すると波及を追跡</span>
      <strong>上流ノードをクリックしてください</strong>
      <p>2次サプライヤや原産地を選ぶと、その影響が1次サプライヤ、自社工場、製品、顧客へどう流れるかをハイライトします。</p>`;
    return;
  }
  el.innerHTML = `
    <span class="network-selection-kicker">選択中</span>
    <strong>${esc(detail.node.name)}</strong>
    <p>${esc(detail.node.role_note || detail.node.makes || detail.node.country || "サプライチェーン上のノード")}</p>
    <dl>
      <div><dt>波及製品</dt><dd>${esc(detail.products.join("、") || "なし")}</dd></div>
      <div><dt>影響受注</dt><dd>${esc(detail.orders.length)}件</dd></div>
      <div><dt>月間調達額</dt><dd>${esc(compactUsdJa(detail.spend))}</dd></div>
    </dl>`;
}

function renderNetworkStory(model) {
  const el = document.getElementById("network-story");
  if (!el) return;
  const metrics = model.propagation?.metrics || {};
  const month = model.month || {};
  const scenario = activeScenario || {};
  const material = materialLabel(scenario.material || model.assessment?.material);
  el.innerHTML = `
    <div class="network-story-main">
      <span>${esc(month.label || "現在")} / ${esc(material)}</span>
      <strong>${esc(scenario.headline || model.risk_event?.summary || "供給リスクを監視中")}</strong>
      <p>${esc(scenario.layperson_story || "外部シグナルを自社の製品・顧客影響へ翻訳します。")}</p>
    </div>
    <div class="network-story-kpis">
      <div><span>リスク</span><b>${esc(metrics.risk_score ?? model.assessment?.risk_score ?? "-")}</b></div>
      <div><span>調達影響</span><b>${esc(metrics.affected_supply_ratio ?? 0)}%</b></div>
      <div><span>在庫</span><b>${esc(metrics.inventory_days_min ?? "-")}日</b></div>
      <div><span>金額</span><b>${esc(compactUsdJa(metrics.spend_at_risk_usd ?? 0))}</b></div>
    </div>`;
}

function renderScenarioTimeline(model) {
  const el = document.getElementById("scenario-timeline");
  if (!el) return;
  const months = asArray(model.timeline);
  if (!months.length) {
    el.innerHTML = `<p class="empty">時系列データがありません。</p>`;
    return;
  }
  el.innerHTML = `
    <div class="timeline-bars">
      ${months
        .map((month, index) => {
          const metrics = month.metrics && Object.keys(month.metrics).length ? month.metrics : computeMetrics(activeScenario.network, month.disruption || {}, {
            inventory: month.inventory || activeScenario.inventory || [],
            alternatives: activeScenario.alternatives || [],
            risk_inputs: month.risk_inputs || activeScenario.risk_inputs || {},
          }).metrics;
          const score = Number(metrics.risk_score) || 0;
          const price = Number(month.price_index) || 100;
          const active = index === activeMonthIndex ? " is-active" : "";
          return `
            <button type="button" class="timeline-month${active}" data-month-index="${index}" aria-label="${esc(month.label)}を表示">
              <span>${esc(month.label || month.month)}</span>
              <i style="height:${Math.max(8, Math.min(100, score))}%"></i>
              <b>${esc(score)}</b>
              <em>価格 ${esc(price)}</em>
            </button>`;
        })
        .join("")}
    </div>
    <div class="timeline-events">
      ${asArray(model.month?.events)
        .map((event) => `<div><span>${esc(sourceKindLabel(event.kind))}</span><p>${esc(event.text)}</p></div>`)
        .join("") || `<div><span>監視</span><p>この月は大きなシグナルなし。基準値として利用します。</p></div>`}
    </div>`;
  el.querySelectorAll("[data-month-index]").forEach((button) => {
    button.addEventListener("click", () => {
      activeMonthIndex = Number(button.getAttribute("data-month-index")) || 0;
      stopDemo();
      renderCurrentDashboard();
    });
  });
}

function renderProvenance(model) {
  const el = document.getElementById("provenance-list");
  if (!el) return;
  const sources = asArray(model.provenance);
  el.innerHTML = sources.length
    ? sources
        .map((source) => `
          <article class="provenance-card">
            <div>
              <span>${esc(sourceKindLabel(source.kind))}</span>
              <strong>${esc(source.label || source.source)}</strong>
            </div>
            <p>${esc(source.claim)}</p>
            <footer>
              <em>${esc(source.source || "デモ情報源")}</em>
              <b>確度 ${esc(source.confidence || "-")}</b>
            </footer>
          </article>`)
        .join("")
    : `<p class="empty">根拠データはありません。</p>`;
}

function renderNetworkPanel(model) {
  const legend = document.getElementById("network-legend");
  if (legend) legend.innerHTML = networkLegendHtml();
  renderNetworkStory(model);
  renderScenarioTimeline(model);
  renderProvenance(model);
  renderNetworkSelection(null);
  const container = document.getElementById("supply-network");
  if (!container) return;
  if (!networkInstance) {
    networkInstance = createNetwork(container);
    container.addEventListener("supply-network-select", (event) => renderNetworkSelection(event.detail));
  }
  networkInstance.render(model);
}

function updateDemoControls() {
  const stage = (currentDashboardData && currentDashboardData.demo) || {};
  const title = document.getElementById("demo-stage-title");
  const detail = document.getElementById("demo-stage-detail");
  const progress = document.getElementById("demo-progress-bar");
  const play = document.getElementById("demo-play");
  if (title) title.textContent = stage.title || "巡回デモ待機中";
  if (detail) detail.textContent = stage.detail || "外部シグナルと社内データを順に照合します。";
  if (progress) {
    const denom = Math.max(1, (stage.total_steps || 1) - 1);
    progress.style.width = `${Math.round(((stage.step_index || 0) / denom) * 100)}%`;
  }
  if (play) play.textContent = demoPlaying ? "巡回中..." : "巡回デモ開始";
}

function renderCurrentDashboard() {
  currentDashboardData = buildScenarioOverlayModel(applyDemoStage(dashboardData, demoStep));
  renderPanels(currentDashboardData);
  renderNetworkPanel(currentDashboardData);
  renderAgentPanel(currentDashboardData);
  updateDemoControls();
  renderMapInsight(null);
  mapInstance?.highlightRoute(null);
  ensureMap();
}

function stopDemo() {
  if (demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
  }
  demoPlaying = false;
  updateDemoControls();
}

function startDemo() {
  stopDemo();
  demoPlaying = true;
  demoStep = 0;
  renderCurrentDashboard();
  demoTimer = setInterval(() => {
    if (demoStep >= (demoConfig.stages || []).length - 1) {
      stopDemo();
      renderCurrentDashboard();
      return;
    }
    demoStep += 1;
    renderCurrentDashboard();
  }, demoConfig.interval_ms || 1800);
}

function resetDemo() {
  stopDemo();
  demoStep = 0;
  renderCurrentDashboard();
}

function bindDemoControls() {
  const play = document.getElementById("demo-play");
  const reset = document.getElementById("demo-reset");
  if (play) play.addEventListener("click", startDemo);
  if (reset) reset.addEventListener("click", resetDemo);
}

function setActiveView(viewName) {
  if (!VIEW_TITLES[viewName]) {
    viewName = "dashboard";
  }
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.viewPanel === viewName);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewName);
  });
  const title = document.getElementById("view-title");
  if (title) title.textContent = VIEW_TITLES[viewName] || viewName;

  if (viewName === "dashboard") {
    ensureMap();
  }
}

function bindNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setActiveView(button.dataset.view));
  });
}

function bindSidebarToggle() {
  const shell = document.getElementById("app-shell");
  const button = document.getElementById("sidebar-toggle");
  if (!shell || !button) return;

  button.addEventListener("click", () => {
    const collapsed = shell.classList.toggle("sidebar-collapsed");
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", collapsed ? "サイドバーを開く" : "サイドバーを閉じる");
    button.textContent = collapsed ? "›" : "‹";
    ensureMap();
  });
}

function applyInitialSidebarState() {
  const shell = document.getElementById("app-shell");
  const button = document.getElementById("sidebar-toggle");
  if (!shell || !button) return;

  const params = new URLSearchParams(window.location.search);
  if (params.get("sidebar") !== "closed") return;

  shell.classList.add("sidebar-collapsed");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", "サイドバーを開く");
  button.textContent = "›";
}

async function init() {
  setLoaderText("Cloud API と供給網データを読み込んでいます");
  [dashboardData, worldGeojson, demoConfig, scenarioIndex] = await Promise.all([
    fetchDashboardData(),
    fetchJson("./assets/world.geojson"),
    fetchJson("./demo_events.json").catch(() => demoConfig),
    fetchJson("./assets/scenarios/index.json").catch(() => ({ scenarios: [] })),
  ]);

  setLoaderText("監視シナリオと多段サプライヤネットワークを準備しています");
  const params = new URLSearchParams(window.location.search);
  const scenarioParam = params.get("scenario");
  const defaultScenario =
    (scenarioParam && (scenarioIndex.scenarios || []).find((item) => item.id === scenarioParam)) ||
    (scenarioIndex.scenarios || []).find((item) => item.default) ||
    (scenarioIndex.scenarios || [])[0];
  if (defaultScenario) {
    await loadScenario(defaultScenario.id);
    activeMaterial = activeScenario?.material || defaultScenario.material || activeMaterial;
  }
  const materialParam = params.get("material");
  if (MATERIAL_PROFILES[materialParam]) {
    activeMaterial = materialParam;
    const scenario = scenarioByMaterial(materialParam);
    if (scenario) await loadScenario(scenario.id);
  }
  const monthParam = params.get("month");
  if (monthParam && activeTimeseries?.months) {
    const index = activeTimeseries.months.findIndex((item) => item.month === monthParam || item.label === monthParam);
    if (index >= 0) activeMonthIndex = index;
  }
  demoStep = Math.max(0, (demoConfig.stages || []).length - 1);
  bindMaterialSwitch();
  bindScenarioSwitch();
  bindAgentChat();
  setLoaderText("AI判断ログと初動対応ボードを描画しています");
  renderCurrentDashboard();

  bindNavigation();
  bindSidebarToggle();
  bindDemoControls();
  bindSourcingInteraction();
  applyInitialSidebarState();
  const initialView = params.get("view") || "dashboard";
  setActiveView(initialView);
  if (params.get("demo") === "play") {
    setTimeout(startDemo, 400);
  } else if (params.get("demo") === "reset") {
    resetDemo();
  }
  hideLoader();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => init().catch((err) => showFatalError(err.message || err)));
} else {
  init().catch((err) => showFatalError(err.message || err));
}
