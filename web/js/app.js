// Wires dashboard data and render modules into the fixed DOM skeleton.
// Plain browser ES module: no CDN, no build step.

import { createMap } from "./map.js";
import { renderFlow } from "./flow.js";
import { renderPanels } from "./panels.js";

function showFatalError(message) {
  const banner = document.createElement("div");
  banner.setAttribute("role", "alert");
  banner.style.cssText =
    "position:fixed;left:0;right:0;top:0;z-index:9999;" +
    "background:#2a0d14;color:#ffb4b4;border-bottom:1px solid #ff4d6d;" +
    "font:13px/1.5 system-ui,\"Segoe UI\",sans-serif;padding:12px 16px;white-space:pre-wrap;";
  banner.textContent = `Supply Sentinel failed to load: ${message}`;
  if (document.body) {
    document.body.appendChild(banner);
  } else {
    document.addEventListener("DOMContentLoaded", () => document.body.appendChild(banner));
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function init() {
  const [data, geojson] = await Promise.all([
    fetchJson("./dashboard_data.json"),
    fetchJson("./assets/world.geojson"),
  ]);

  renderPanels(data);

  const canvasEl = document.getElementById("world-map");
  let map = null;
  if (canvasEl) {
    map = createMap(canvasEl, geojson);
    map.render(data);
    window.addEventListener("resize", () => {
      try {
        map.resize();
      } catch {
        // Ignore resize races while the page is settling.
      }
    });
  }

  const flowEl = document.getElementById("flow-graph");
  if (flowEl) {
    renderFlow(flowEl, data.route_intel && data.route_intel.flow);
  }

  return map;
}

function start() {
  init().catch((err) => {
    const message = err && err.message ? err.message : String(err);
    showFatalError(message);
    if (typeof console !== "undefined" && console.error) {
      console.error(err);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
