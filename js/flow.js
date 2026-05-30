const SVG_NS = "http://www.w3.org/2000/svg";

const TEXT = "#1d2733";
const MUTED = "#637083";
const LINE = "#c8d1df";

const STATUS_COLORS = {
  disrupted: "#c9362f",
  exposed: "#b66a00",
  resilient: "#18794e",
  normal: "#2563a8",
};

const STAGE_HEADERS = ["原産地", "サプライヤ・港", "工場", "製品", "顧客"];
const VIEW_W = 1200;
const VIEW_H = 620;
const MARGIN_X = 76;
const HEADER_Y = 34;
const TOP_PAD = 78;
const NODE_W = 172;
const NODE_H = 54;
const NODE_GAP = 22;
const STAGE_COUNT = 5;

function createEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) el.setAttribute(key, String(value));
  }
  return el;
}

function statusColor(status) {
  return STATUS_COLORS[status] || STATUS_COLORS.normal;
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

function formatValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function translateTerm(value) {
  const term = String(value ?? "");
  const labels = {
    "Middle East": "中東",
    "Southeast Asia": "東南アジア",
    "East Asia": "東アジア",
    Asia: "アジア",
    Europe: "欧州",
    Japan: "日本",
    plant: "工場",
    product: "製品",
    supplier: "サプライヤ",
    origin: "原産地",
    high: "優先度 高",
    medium: "優先度 中",
    low: "優先度 低",
  };
  return labels[term] || term;
}

function groupByStage(nodes) {
  const columns = Array.from({ length: STAGE_COUNT }, () => []);
  for (const node of nodes) {
    const stage = Math.max(0, Math.min(STAGE_COUNT - 1, Number(node.stage) || 0));
    columns[stage].push(node);
  }
  return columns;
}

function buildGeometry(columns) {
  const innerW = VIEW_W - MARGIN_X * 2;
  const geom = {};

  columns.forEach((nodes, stage) => {
    const xCenter =
      MARGIN_X + NODE_W / 2 + (innerW - NODE_W) * (stage / Math.max(1, STAGE_COUNT - 1));
    const totalH = nodes.length * NODE_H + Math.max(0, nodes.length - 1) * NODE_GAP;
    let y = TOP_PAD + (VIEW_H - TOP_PAD - totalH) / 2;

    nodes.forEach((node) => {
      geom[node.id] = {
        x: xCenter - NODE_W / 2,
        y,
        w: NODE_W,
        h: NODE_H,
      };
      y += NODE_H + NODE_GAP;
    });
  });

  return geom;
}

function renderHeaders(svg, columns) {
  columns.forEach((_, stage) => {
    const x = MARGIN_X + NODE_W / 2 + (VIEW_W - MARGIN_X * 2 - NODE_W) * (stage / Math.max(1, STAGE_COUNT - 1));
    const text = createEl("text", {
      x,
      y: HEADER_Y,
      fill: MUTED,
      "font-size": 14,
      "font-weight": 700,
      "text-anchor": "middle",
      "font-family": "system-ui, sans-serif",
    });
    text.textContent = STAGE_HEADERS[stage];
    svg.appendChild(text);
  });
}

function renderEdges(svg, edges, geom) {
  for (const edge of edges) {
    const source = geom[edge.source];
    const target = geom[edge.target];
    if (!source || !target) continue;

    const x1 = source.x + source.w;
    const y1 = source.y + source.h / 2;
    const x2 = target.x;
    const y2 = target.y + target.h / 2;
    const dx = Math.max(48, (x2 - x1) * 0.45);
    const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    const color = statusColor(edge.status);
    const width = Math.max(2, Math.min(12, 2 + (Number(edge.value) || 0) / 700));

    svg.appendChild(createEl("path", {
      d,
      fill: "none",
      stroke: color,
      "stroke-width": width,
      "stroke-opacity": 0.55,
      "stroke-linecap": "round",
    }));
  }
}

function renderNodes(svg, nodes, geom) {
  for (const node of nodes) {
    const box = geom[node.id];
    if (!box) continue;

    const group = createEl("g");
    const status = node.status || "normal";
    const color = statusColor(status);

    group.appendChild(createEl("rect", {
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      rx: 8,
      fill: "#ffffff",
      stroke: LINE,
      "stroke-width": 1,
    }));

    group.appendChild(createEl("rect", {
      x: box.x,
      y: box.y,
      width: 5,
      height: box.h,
      rx: 3,
      fill: color,
    }));

    const label = createEl("text", {
      x: box.x + 14,
      y: box.y + 22,
      fill: TEXT,
      "font-size": 13,
      "font-weight": 700,
      "font-family": "system-ui, sans-serif",
    });
    label.textContent = truncate(node.label ?? node.id, 19);
    group.appendChild(label);

    const sub = createEl("text", {
      x: box.x + 14,
      y: box.y + 40,
      fill: MUTED,
      "font-size": 11,
      "font-family": "system-ui, sans-serif",
    });
    sub.textContent = truncate(translateTerm(node.sublabel ?? formatValue(node.value)), 24);
    group.appendChild(sub);

    svg.appendChild(group);
  }
}

export function renderFlow(containerEl, flow) {
  if (!containerEl) return;
  containerEl.innerHTML = "";

  const nodes = flow && Array.isArray(flow.nodes) ? flow.nodes : [];
  const edges = flow && Array.isArray(flow.edges) ? flow.edges : [];
  if (nodes.length === 0) {
    containerEl.textContent = "業務フローデータがありません。";
    return;
  }

  const svg = createEl("svg", {
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": "供給リスクの業務フロー",
  });

  const columns = groupByStage(nodes);
  const geom = buildGeometry(columns);
  renderHeaders(svg, columns);
  renderEdges(svg, edges, geom);
  renderNodes(svg, nodes, geom);
  containerEl.appendChild(svg);
}
