// flow.js — process-mining style supply flow graph (inline SVG, vanilla JS)
// Shared theme contract:
//   text   #e6edff   muted #8aa0c8
//   status: disrupted=red, exposed=amber, resilient=green, normal=blue
//
// renderFlow(containerEl, flow)
//   flow = {
//     nodes: [{ id, stage, label, sublabel, type, value }],
//     edges: [{ source, target, value, status }]
//   }

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---- theme ------------------------------------------------------------------
const TEXT = '#e6edff';
const MUTED = '#8aa0c8';

const STATUS_COLORS = {
  disrupted: '#ff5470', // red
  exposed: '#ffb547', // amber
  resilient: '#3ddc97', // green
  normal: '#4d8dff', // blue
};

const STAGE_HEADERS = [
  'Upstream 原産地',
  'Midstream サプライヤー・港',
  'Plant 工場',
  'Product 製品',
  'Customer 顧客',
];

// ---- layout constants -------------------------------------------------------
const VIEW_W = 1200;
const VIEW_H = 680;
const MARGIN_X = 90; // left/right padding inside the viewBox
const HEADER_Y = 34; // baseline for column headers
const TOP_PAD = 70; // space reserved under headers before nodes start
const BOTTOM_PAD = 30;
const NODE_W = 168;
const NODE_MIN_H = 44;
const NODE_MAX_H = 120;
const NODE_GAP = 22;
const STAGE_COUNT = 5;
const EDGE_MIN_W = 2;
const EDGE_MAX_W = 16;

function createEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  if (attrs) {
    for (const k in attrs) {
      if (attrs[k] != null) el.setAttribute(k, String(attrs[k]));
    }
  }
  return el;
}

function statusColor(status) {
  return STATUS_COLORS[status] || STATUS_COLORS.normal;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function renderFlow(containerEl, flow) {
  if (!containerEl) return;
  containerEl.innerHTML = '';

  const nodes = (flow && Array.isArray(flow.nodes) ? flow.nodes : []).filter(
    (n) => n && n.id != null
  );
  const edges = flow && Array.isArray(flow.edges) ? flow.edges : [];

  if (nodes.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText =
      'color:' + MUTED + ';font:14px system-ui,sans-serif;padding:24px;text-align:center;';
    empty.textContent = 'No supply flow data';
    containerEl.appendChild(empty);
    return;
  }

  const svg = createEl('svg', {
    viewBox: '0 0 ' + VIEW_W + ' ' + VIEW_H,
    preserveAspectRatio: 'xMidYMid meet',
    width: '100%',
    height: '100%',
    role: 'img',
    'aria-label': 'Supply flow graph',
  });
  svg.style.display = 'block';
  svg.style.width = '100%';
  svg.style.height = 'auto';

  // ---- defs: glow filter ----------------------------------------------------
  const defs = createEl('defs');
  const filter = createEl('filter', {
    id: 'flow-glow',
    x: '-40%',
    y: '-40%',
    width: '180%',
    height: '180%',
  });
  const blur = createEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '4', result: 'b' });
  const merge = createEl('feMerge');
  merge.appendChild(createEl('feMergeNode', { in: 'b' }));
  merge.appendChild(createEl('feMergeNode', { in: 'SourceGraphic' }));
  filter.appendChild(blur);
  filter.appendChild(merge);
  defs.appendChild(filter);
  svg.appendChild(defs);

  // ---- group nodes by stage -------------------------------------------------
  const columns = [];
  for (let s = 0; s < STAGE_COUNT; s++) columns.push([]);
  for (const n of nodes) {
    const s = clamp(Number(n.stage) || 0, 0, STAGE_COUNT - 1);
    columns[s].push(n);
  }

  // value scaling for node heights (per-graph normalization)
  let maxNodeVal = 0;
  for (const n of nodes) maxNodeVal = Math.max(maxNodeVal, Math.abs(Number(n.value) || 0));
  if (maxNodeVal <= 0) maxNodeVal = 1;

  const usableH = VIEW_H - TOP_PAD - BOTTOM_PAD;

  // column x centers, evenly spaced left -> right
  const innerW = VIEW_W - MARGIN_X * 2;
  const colCenters = [];
  for (let s = 0; s < STAGE_COUNT; s++) {
    const x =
      STAGE_COUNT === 1
        ? VIEW_W / 2
        : MARGIN_X + NODE_W / 2 + (innerW - NODE_W) * (s / (STAGE_COUNT - 1));
    colCenters.push(x);
  }

  // ---- compute node geometry FIRST -----------------------------------------
  const geom = {}; // id -> { x, y, w, h, cx }
  for (let s = 0; s < STAGE_COUNT; s++) {
    const colNodes = columns[s];
    if (colNodes.length === 0) continue;

    // raw heights from value, clamped
    const heights = colNodes.map((n) => {
      const v = Math.abs(Number(n.value) || 0);
      return clamp(NODE_MIN_H + (v / maxNodeVal) * (NODE_MAX_H - NODE_MIN_H), NODE_MIN_H, NODE_MAX_H);
    });

    let totalH = heights.reduce((a, b) => a + b, 0) + NODE_GAP * (colNodes.length - 1);

    // if column overflows, scale heights down to fit
    if (totalH > usableH) {
      const gaps = NODE_GAP * (colNodes.length - 1);
      const scale = Math.max(0.2, (usableH - gaps) / Math.max(1, totalH - gaps));
      for (let i = 0; i < heights.length; i++) {
        heights[i] = Math.max(NODE_MIN_H * 0.5, heights[i] * scale);
      }
      totalH = heights.reduce((a, b) => a + b, 0) + gaps;
    }

    // vertically centered in the canvas
    let y = TOP_PAD + (usableH - totalH) / 2;
    const cx = colCenters[s];
    const left = cx - NODE_W / 2;

    for (let i = 0; i < colNodes.length; i++) {
      const h = heights[i];
      geom[colNodes[i].id] = { x: left, y, w: NODE_W, h, cx };
      y += h + NODE_GAP;
    }
  }

  // ---- edge width normalization --------------------------------------------
  let maxEdgeVal = 0;
  for (const e of edges) maxEdgeVal = Math.max(maxEdgeVal, Math.abs(Number(e.value) || 0));
  if (maxEdgeVal <= 0) maxEdgeVal = 1;

  // ---- layers: edges under nodes -------------------------------------------
  const edgeLayer = createEl('g', { class: 'flow-edges' });
  const nodeLayer = createEl('g', { class: 'flow-nodes' });

  // ---- column headers -------------------------------------------------------
  const headerLayer = createEl('g', { class: 'flow-headers' });
  for (let s = 0; s < STAGE_COUNT; s++) {
    const t = createEl('text', {
      x: colCenters[s],
      y: HEADER_Y,
      fill: MUTED,
      'font-size': 14,
      'font-weight': 600,
      'text-anchor': 'middle',
      'font-family': 'system-ui, sans-serif',
      'letter-spacing': '0.04em',
    });
    t.textContent = STAGE_HEADERS[s];
    headerLayer.appendChild(t);
  }

  // ---- edges (computed after geometry) -------------------------------------
  let dashSeed = 0;
  for (const e of edges) {
    const a = geom[e.source];
    const b = geom[e.target];
    if (!a || !b) continue;

    const x1 = a.x + a.w; // right edge of source
    const y1 = a.y + a.h / 2;
    const x2 = b.x; // left edge of target
    const y2 = b.y + b.h / 2;

    const dx = Math.max(40, (x2 - x1) * 0.5);
    const c1x = x1 + dx;
    const c2x = x2 - dx;
    const d = 'M' + x1 + ',' + y1 + ' C' + c1x + ',' + y1 + ' ' + c2x + ',' + y2 + ' ' + x2 + ',' + y2;

    const color = statusColor(e.status);
    const w = clamp(
      EDGE_MIN_W + (Math.abs(Number(e.value) || 0) / maxEdgeVal) * (EDGE_MAX_W - EDGE_MIN_W),
      EDGE_MIN_W,
      EDGE_MAX_W
    );

    // base translucent ribbon
    const base = createEl('path', {
      d: d,
      fill: 'none',
      stroke: color,
      'stroke-width': w,
      'stroke-opacity': 0.5,
      'stroke-linecap': 'round',
    });
    edgeLayer.appendChild(base);

    // animated "light" travelling left -> right via dashoffset
    const dash = Math.max(10, w * 3);
    const gap = dash * 3;
    const period = (gap + dash) * 1;
    const flowPath = createEl('path', {
      d: d,
      fill: 'none',
      stroke: color,
      'stroke-width': Math.max(EDGE_MIN_W, w * 0.7),
      'stroke-opacity': 0.95,
      'stroke-linecap': 'round',
      'stroke-dasharray': dash + ' ' + gap,
    });
    const anim = createEl('animate', {
      attributeName: 'stroke-dashoffset',
      from: period,
      to: 0,
      dur: (2.2 + (dashSeed % 5) * 0.25).toFixed(2) + 's',
      repeatCount: 'indefinite',
      begin: (-(dashSeed % 7) * 0.3).toFixed(2) + 's',
    });
    flowPath.appendChild(anim);
    edgeLayer.appendChild(flowPath);
    dashSeed++;
  }

  // ---- nodes ----------------------------------------------------------------
  for (const n of nodes) {
    const g = geom[n.id];
    if (!g) continue;

    const grp = createEl('g', { class: 'flow-node' });

    // glow underlay
    const glow = createEl('rect', {
      x: g.x,
      y: g.y,
      width: g.w,
      height: g.h,
      rx: 10,
      ry: 10,
      fill: 'rgba(77,141,255,0.18)',
      filter: 'url(#flow-glow)',
    });
    grp.appendChild(glow);

    // main box
    const rect = createEl('rect', {
      x: g.x,
      y: g.y,
      width: g.w,
      height: g.h,
      rx: 10,
      ry: 10,
      fill: 'rgba(18,28,52,0.92)',
      stroke: 'rgba(138,160,200,0.35)',
      'stroke-width': 1,
    });
    grp.appendChild(rect);

    const padX = g.x + 14;
    const cy = g.y + g.h / 2;
    const hasSub = n.sublabel != null && String(n.sublabel) !== '';
    const hasVal = n.value != null && String(n.value) !== '';

    // label (bold)
    const label = createEl('text', {
      x: padX,
      y: hasSub ? cy - 6 : cy - (hasVal ? 4 : 0),
      fill: TEXT,
      'font-size': 14,
      'font-weight': 700,
      'dominant-baseline': 'middle',
      'font-family': 'system-ui, sans-serif',
    });
    label.textContent = truncate(String(n.label != null ? n.label : n.id), 20);
    grp.appendChild(label);

    // sublabel (muted, smaller)
    if (hasSub) {
      const sub = createEl('text', {
        x: padX,
        y: cy + 11,
        fill: MUTED,
        'font-size': 11,
        'dominant-baseline': 'middle',
        'font-family': 'system-ui, sans-serif',
      });
      sub.textContent = truncate(String(n.sublabel), 24);
      grp.appendChild(sub);
    }

    // value (right-aligned, muted)
    if (hasVal) {
      const val = createEl('text', {
        x: g.x + g.w - 14,
        y: hasSub ? cy + 11 : cy + (g.h > NODE_MIN_H ? 9 : 9),
        fill: MUTED,
        'font-size': 11,
        'font-weight': 600,
        'text-anchor': 'end',
        'dominant-baseline': 'middle',
        'font-family': 'system-ui, sans-serif',
      });
      val.textContent = formatValue(n.value);
      grp.appendChild(val);
    }

    nodeLayer.appendChild(grp);
  }

  svg.appendChild(headerLayer);
  svg.appendChild(edgeLayer);
  svg.appendChild(nodeLayer);
  containerEl.appendChild(svg);
}

function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)) + '…';
}

function formatValue(v) {
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}
