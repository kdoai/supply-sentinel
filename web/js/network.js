// network.js — multi-tier supply network graph (SVG, no imports except trace).
//
// Renders 自社(tier0) ← 1次(tier1) ← 2次(tier2) ← 原産地(tier3) on the supply
// side and 自社工場 → 製品 → 顧客 on the demand side, as left-to-right columns.
// Node/edge colors come from the propagation result (node_status / edge_status).
// Clicking a node highlights its entire downstream path to our products/orders
// and emits a 'supply-network-select' event with an impact summary.
//
// API: createNetwork(containerEl) -> { render(model), selectNode(id), clear() }
//   model.supply_network = { focal_material, nodes[], edges[], node_status{}, edge_status{} }

import { traceDownstream } from "./propagation.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const STATUS_COLORS = {
  disrupted: "#ff5a5a",
  exposed: "#ffae4d",
  resilient: "#39d98a",
  normal: "#5aa9ff",
};
const TEXT = "#e7eefc";
const MUTED = "#9fb0d0";

// Logical column for a node: 0 原産地 … 5 顧客.
function columnOf(node) {
  if (node.kind === "customer") return 5;
  if (node.kind === "product") return 4;
  if (node.kind === "plant" || node.kind === "self") return 3;
  if (node.tier === 1) return 2;
  if (node.tier === 2) return 1;
  if (node.tier === 3) return 0;
  return 3;
}
const COLUMN_HEADERS = ["原産地", "2次サプライヤ", "1次サプライヤ", "自社工場", "製品", "顧客"];
const COLUMN_HINTS = [
  "製油所・原料",
  "サプライヤのサプライヤ",
  "自社へ直接納入",
  "自社の製造拠点",
  "つくる製品",
  "納入先・受注",
];

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  return node;
}
function statusColor(s) {
  return STATUS_COLORS[s] || STATUS_COLORS.normal;
}
function truncate(v, max) {
  const t = String(v ?? "");
  return t.length <= max ? t : t.slice(0, Math.max(1, max - 1)) + "…";
}
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function createNetwork(containerEl) {
  let model = null;
  let network = null;
  let selected = null;

  function clear() {
    selected = null;
    if (model) render(model);
  }

  function selectNode(id) {
    selected = id;
    if (model) render(model);
  }

  function impactOf(net, id) {
    const trace = traceDownstream(net, id);
    const byId = new Map(net.nodes.map((n) => [n.id, n]));
    const products = trace.nodes.filter((n) => byId.get(n)?.kind === "product").map((n) => byId.get(n).name);
    const orders = [];
    let spend = 0;
    const traceSet = new Set(trace.nodes);
    for (const e of net.edges) {
      const tgt = byId.get(e.target);
      if (tgt?.kind === "customer" && traceSet.has(e.source)) {
        orders.push({ order_id: e.order_id, customer: tgt.name, priority: e.priority || tgt.priority });
      }
      // spend on our intake lanes that flow through this node
      const t2 = byId.get(e.target);
      if (t2 && (t2.kind === "plant" || t2.kind === "self") && e.material === net.focal_material && traceSet.has(e.source)) {
        spend += Number(e.monthly_spend_usd) || 0;
      }
    }
    return { trace, products, orders, spend, node: byId.get(id) };
  }

  function render(nextModel) {
    model = nextModel || model;
    network = (model && model.supply_network) || null;
    containerEl.innerHTML = "";
    if (!network || !Array.isArray(network.nodes) || network.nodes.length === 0) {
      containerEl.textContent = "ネットワークデータがありません。";
      return;
    }

    const nodeStatus = network.node_status || {};
    const edgeStatus = network.edge_status || {};

    // Group nodes by used columns (collapse empty columns so it stays compact).
    const byCol = new Map();
    for (const n of network.nodes) {
      const c = columnOf(n);
      if (!byCol.has(c)) byCol.set(c, []);
      byCol.get(c).push(n);
    }
    const usedCols = [...byCol.keys()].sort((a, b) => a - b);

    // Geometry.
    const NODE_W = 158;
    const NODE_H = 46;
    const GAP_Y = 14;
    const HEADER_H = 46;
    const PAD_X = 24;
    const colCount = usedCols.length;
    const maxRows = Math.max(...usedCols.map((c) => byCol.get(c).length));
    const VIEW_W = Math.max(900, colCount * (NODE_W + 90));
    const VIEW_H = Math.max(360, HEADER_H + maxRows * (NODE_H + GAP_Y) + 40);

    const colX = new Map();
    usedCols.forEach((c, i) => {
      const x = colCount === 1 ? VIEW_W / 2 : PAD_X + NODE_W / 2 + (VIEW_W - PAD_X * 2 - NODE_W) * (i / (colCount - 1));
      colX.set(c, x);
    });

    const geom = new Map();
    for (const c of usedCols) {
      const nodes = byCol.get(c);
      const totalH = nodes.length * NODE_H + (nodes.length - 1) * GAP_Y;
      let y = HEADER_H + (VIEW_H - HEADER_H - totalH) / 2;
      for (const n of nodes) {
        geom.set(n.id, { x: colX.get(c) - NODE_W / 2, y, w: NODE_W, h: NODE_H, cx: colX.get(c) });
        y += NODE_H + GAP_Y;
      }
    }

    // Selection highlight set.
    let highlight = null;
    if (selected && geom.has(selected)) highlight = new Set(impactOf(network, selected).trace.edges);

    const svg = el("svg", {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      preserveAspectRatio: "xMidYMid meet",
      class: "network-svg",
      role: "img",
      "aria-label": "多段サプライネットワーク",
    });

    // Column headers.
    usedCols.forEach((c, i) => {
      const x = colX.get(c);
      const h = el("text", { x, y: 20, fill: TEXT, "font-size": 14, "font-weight": 700, "text-anchor": "middle", "font-family": "system-ui, sans-serif" });
      h.textContent = COLUMN_HEADERS[c];
      svg.appendChild(h);
      const sub = el("text", { x, y: 36, fill: MUTED, "font-size": 10.5, "text-anchor": "middle", "font-family": "system-ui, sans-serif" });
      sub.textContent = COLUMN_HINTS[c];
      svg.appendChild(sub);
    });

    // Edges (under nodes).
    for (const e of network.edges) {
      const s = geom.get(e.source);
      const t = geom.get(e.target);
      if (!s || !t) continue;
      const x1 = s.x + s.w;
      const y1 = s.y + s.h / 2;
      const x2 = t.x;
      const y2 = t.y + t.h / 2;
      const dx = Math.max(40, (x2 - x1) * 0.45);
      const status = edgeStatus[e.id] || "normal";
      const color = statusColor(status);
      const share = Number(e.share_percent) || (Number(e.monthly_volume) ? 40 : 30);
      const width = Math.max(1.6, Math.min(9, 1.6 + share / 14));
      const dim = highlight && !highlight.has(e.id);
      const path = el("path", {
        d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`,
        fill: "none",
        stroke: color,
        "stroke-width": width,
        "stroke-opacity": dim ? 0.08 : status === "disrupted" ? 0.85 : 0.5,
        "stroke-linecap": "round",
        class: status === "disrupted" && !dim ? "net-edge net-edge-flow" : "net-edge",
      });
      svg.appendChild(path);
    }

    // Nodes.
    for (const n of network.nodes) {
      const box = geom.get(n.id);
      if (!box) continue;
      const status = nodeStatus[n.id]?.status || "normal";
      const color = statusColor(status);
      const dim = highlight && !impactOf(network, selected).trace.nodes.includes(n.id) && n.id !== selected;
      const isSel = n.id === selected;

      const g = el("g", { class: "net-node", style: `cursor:pointer;${dim ? "opacity:.22;" : ""}`, "data-node-id": n.id, tabindex: 0, role: "button" });
      g.appendChild(el("rect", {
        x: box.x, y: box.y, width: box.w, height: box.h, rx: 9,
        fill: isSel ? "#1b2742" : "#121b30",
        stroke: isSel ? color : "rgba(120,150,210,0.28)",
        "stroke-width": isSel ? 2.2 : 1,
      }));
      g.appendChild(el("rect", { x: box.x, y: box.y, width: 5, height: box.h, rx: 2.5, fill: color }));
      if (status === "disrupted") {
        g.appendChild(el("circle", { cx: box.x + box.w - 11, cy: box.y + 12, r: 4, fill: color, class: "net-node-pulse" }));
      }
      const name = el("text", { x: box.x + 14, y: box.y + 19, fill: TEXT, "font-size": 12.5, "font-weight": 700, "font-family": "system-ui, sans-serif" });
      name.textContent = truncate(n.name, 13);
      g.appendChild(name);
      const sub = el("text", { x: box.x + 14, y: box.y + 35, fill: MUTED, "font-size": 10.5, "font-family": "system-ui, sans-serif" });
      sub.textContent = truncate(n.makes || n.role_note || n.country || "", 17);
      g.appendChild(sub);

      g.addEventListener("click", () => onSelect(n.id));
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onSelect(n.id);
        }
      });
      svg.appendChild(g);
    }

    containerEl.appendChild(svg);
  }

  function onSelect(id) {
    selected = selected === id ? null : id;
    render(model);
    const detail = selected ? impactOf(network, selected) : null;
    containerEl.dispatchEvent(new CustomEvent("supply-network-select", { detail }));
  }

  return { render, selectNode, clear };
}

// Convenience: a static legend HTML for the tier columns (layperson guide).
export function networkLegendHtml() {
  const items = [
    ["#5aa9ff", "通常"],
    ["#39d98a", "代替可(影響なし)"],
    ["#ffae4d", "監視"],
    ["#ff5a5a", "要対応(供給リスク)"],
  ];
  return items
    .map((i) => `<span class="net-legend-item"><span class="net-legend-dot" style="background:${i[0]}"></span>${esc(i[1])}</span>`)
    .join("");
}
