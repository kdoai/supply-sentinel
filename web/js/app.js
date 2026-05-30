import { createMap } from "./map.js";
import { renderFlow } from "./flow.js";
import { renderPanels } from "./panels.js";

const VIEW_TITLES = {
  dashboard: "監視ダッシュボード",
  analysis: "影響分析",
  response: "初動対応",
};

let dashboardData = null;
let currentDashboardData = null;
let demoConfig = { stages: [], data_sources: [], interval_ms: 1800 };
let demoStep = 0;
let demoTimer = null;
let demoPlaying = false;
let worldGeojson = null;
let mapInstance = null;

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

function updateRouteState(route, stage) {
  if (!route || route.material !== "naphtha") return route;
  const affected = stage.affected_route_ids.includes(route.route_id);
  const resilient = stage.resilient_route_ids.includes(route.route_id);
  route.affected = affected;
  route.status = affected ? "disrupted" : resilient ? "resilient" : "normal";
  return route;
}

function recalcSourcing(model) {
  const routes = ((model.route_intel || {}).routes || []).filter((route) => route.material === "naphtha");
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
    material: "naphtha",
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
  model.route_intel.sourcing.by_material.naphtha = focal;
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

function updateFlow(model) {
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
  stage.affected_route_ids = Array.isArray(stage.affected_route_ids) ? stage.affected_route_ids : [];
  stage.resilient_route_ids = Array.isArray(stage.resilient_route_ids) ? stage.resilient_route_ids : [];

  model.meta = model.meta || {};
  model.meta.generated_at = sourceTimeToIso(stageIndex);

  model.risk_event = model.risk_event || {};
  model.risk_event.severity = stage.severity || scoreSeverity(stage.score);
  model.risk_event.evidence = visibleSlice(base.risk_event && base.risk_event.evidence, stage.evidence_count);

  model.assessment = model.assessment || {};
  model.assessment.risk_score = stage.score ?? model.assessment.risk_score;
  model.assessment.severity = stage.severity || scoreSeverity(model.assessment.risk_score);
  model.assessment.inventory_days_min = stage.inventory_days_min ?? model.assessment.inventory_days_min;
  model.assessment.evidence = visibleSlice(base.assessment && base.assessment.evidence, stage.evidence_count);
  model.assessment.recommended_actions = visibleSlice(base.assessment && base.assessment.recommended_actions, stage.recommended_count);
  model.assessment.approval_required = visibleSlice(base.assessment && base.assessment.approval_required, stage.approval_count);
  model.assessment.impacted_products = visibleSlice(base.assessment && base.assessment.impacted_products, stage.impacted_product_count);
  model.assessment.impacted_customers = visibleSlice(base.assessment && base.assessment.impacted_customers, stage.impacted_customer_count);
  model.assessment.impacted_orders = visibleSlice(base.assessment && base.assessment.impacted_orders, stage.impacted_order_count);
  model.assessment.impacted_plants = stage.impacted_product_count > 0
    ? visibleSlice(base.assessment && base.assessment.impacted_plants, stage.impacted_product_count > 2 ? 2 : 1)
    : [];
  model.assessment.generated_at = model.meta.generated_at;
  for (const item of model.assessment.inventory || []) {
    if (item.plant === "千葉工場") item.days_of_supply = stage.inventory_days_min ?? item.days_of_supply;
    if (item.plant === "大阪工場") item.days_of_supply = Math.max(10, (stage.inventory_days_min ?? 5) + 5);
  }

  for (const route of (model.route_intel || {}).routes || []) {
    updateRouteState(route, stage);
  }
  recalcSourcing(model);
  updateMapNodes(model);
  updateFlow(model);

  model.demo = {
    ...stage,
    step_index: stageIndex,
    total_steps: stages.length,
    is_playing: demoPlaying,
    active_events: stages.slice(0, stageIndex + 1),
    score_trend: stages.slice(0, stageIndex + 1).map((event) => ({
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

  demoStep = Math.max(0, (demoConfig.stages || []).length - 1);
  renderCurrentDashboard();

  bindNavigation();
  bindSidebarToggle();
  bindDemoControls();
  applyInitialSidebarState();
  const params = new URLSearchParams(window.location.search);
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
