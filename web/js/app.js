import { createMap } from "./map.js";
import { renderFlow } from "./flow.js";
import { renderPanels } from "./panels.js";

const VIEW_TITLES = {
  dashboard: "監視ダッシュボード",
  analysis: "影響分析",
  response: "初動対応",
};

let dashboardData = null;
let worldGeojson = null;
let mapInstance = null;

function showFatalError(message) {
  const banner = document.createElement("div");
  banner.setAttribute("role", "alert");
  banner.style.cssText =
    "position:fixed;left:236px;right:0;top:0;z-index:9999;" +
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

function setActiveView(viewName) {
  if (!VIEW_TITLES[viewName]) {
    viewName = "overview";
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

function ensureMap() {
  const canvasEl = document.getElementById("world-map");
  if (!canvasEl || !dashboardData || !worldGeojson) return;

  if (!mapInstance) {
    mapInstance = createMap(canvasEl, worldGeojson);
    mapInstance.render(dashboardData);
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
      mapInstance.render(dashboardData);
    } catch {
      // Ignore resize races.
    }
  });
}

async function init() {
  [dashboardData, worldGeojson] = await Promise.all([
    fetchJson("./dashboard_data.json"),
    fetchJson("./assets/world.geojson"),
  ]);

  renderPanels(dashboardData);
  const flowEl = document.getElementById("flow-graph");
  if (flowEl) {
    renderFlow(flowEl, dashboardData.route_intel && dashboardData.route_intel.flow);
  }

  bindNavigation();
  const initialView = new URLSearchParams(window.location.search).get("view") || "dashboard";
  setActiveView(initialView);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => init().catch((err) => showFatalError(err.message || err)));
} else {
  init().catch((err) => showFatalError(err.message || err));
}
