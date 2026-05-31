import { createMap } from "./map.js";
import { renderFlow } from "./flow.js";
import { renderPanels } from "./panels.js";

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
let mapControlsBound = false;
let activeMaterial = "naphtha";

function showFatalError(message) {
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

function routeStatusLabel(status) {
  if (status === "disrupted") return "要対応";
  if (status === "resilient") return "代替可";
  if (status === "exposed") return "監視";
  return "通常";
}

function materialLabel(material) {
  return MATERIAL_PROFILES[material]?.label || material || "不明";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    button.addEventListener("click", () => {
      const next = button.getAttribute("data-material");
      if (!MATERIAL_PROFILES[next] || next === activeMaterial) return;
      activeMaterial = next;
      stopDemo();
      demoStep = activeMaterial === "naphtha" ? Math.max(0, (demoConfig.stages || []).length - 1) : 0;
      mapInstance?.resetView();
      bindMaterialSwitch();
      renderCurrentDashboard();
    });
  });
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

function renderFlowPanel(model) {
  const flowEl = document.getElementById("flow-graph");
  if (flowEl) {
    renderFlow(flowEl, model.route_intel && model.route_intel.flow);
  }
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
  currentDashboardData = applyDemoStage(dashboardData, demoStep);
  renderPanels(currentDashboardData);
  renderFlowPanel(currentDashboardData);
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
  [dashboardData, worldGeojson, demoConfig] = await Promise.all([
    fetchJson("./dashboard_data.json"),
    fetchJson("./assets/world.geojson"),
    fetchJson("./demo_events.json").catch(() => demoConfig),
  ]);

  const params = new URLSearchParams(window.location.search);
  const materialParam = params.get("material");
  if (MATERIAL_PROFILES[materialParam]) {
    activeMaterial = materialParam;
  }
  demoStep = Math.max(0, (demoConfig.stages || []).length - 1);
  bindMaterialSwitch();
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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => init().catch((err) => showFatalError(err.message || err)));
} else {
  init().catch((err) => showFatalError(err.message || err));
}
