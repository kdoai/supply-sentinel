// map.js — glowing world map renderer (pure vanilla JS, no imports)
//
// export createMap(canvasEl, geojson) -> { render(data), resize() }
//
// Renders an equirectangular world map with country polygons, glowing
// supply routes ("光のルート") as bezier arcs, animated traveling light
// comets along each route, and pulsing nodes (origins / ports / our plants).
//
// Data shape (from dashboard_data.json):
//   data.route_intel.routes[]   : { route_id, status, share_percent, affected,
//                                    origin:{name,lat,lng}, plant:{name,lat,lng}, ... }
//   data.route_intel.map_nodes[]: { id, type:'origin'|'port'|'plant',
//                                    label, sublabel, lat, lng, affected }

export function createMap(canvasEl, geojson) {
  const ctx = canvasEl.getContext('2d');

  // --- internal state ---------------------------------------------------
  let data = null;
  let W = 0; // CSS pixel width  (projection space)
  let H = 0; // CSS pixel height
  let dpr = 1;
  // Uniform projection scale + centering offsets so the world keeps its 2:1
  // aspect ratio (letterboxed) regardless of the canvas shape.
  let scale = 1;
  let offX = 0;
  let offY = 0;
  let zoom = 1;
  let panX = 0;
  let panY = 0;

  let countryRings = []; // pre-extracted outer rings: [[ [lng,lat], ... ], ...]
  let projectedRings = [];
  let projRoutes = [];   // projected routes ready to draw
  let projNodes = [];    // projected nodes ready to draw

  let rafId = null;
  let dragging = false;
  let dragStart = { x: 0, y: 0, panX: 0, panY: 0 };
  let mouse = { x: -9999, y: -9999, inside: false };
  let selected = null;

  // --- tooltip element --------------------------------------------------
  function findTooltip() {
    let el = null;
    if (canvasEl.parentElement) {
      el = canvasEl.parentElement.querySelector('#map-tooltip');
    }
    if (!el && typeof document !== 'undefined') {
      el = document.getElementById('map-tooltip');
    }
    return el;
  }
  const tooltipEl = findTooltip();

  // --- helpers ----------------------------------------------------------
  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function baseProject(lng, lat) {
    if (!isNum(lng) || !isNum(lat)) return null;
    return {
      x: offX + (lng + 180) * scale,
      y: offY + (90 - lat) * scale,
    };
  }

  function viewPoint(pt) {
    return {
      x: W / 2 + (pt.x - W / 2) * zoom + panX,
      y: H / 2 + (pt.y - H / 2) * zoom + panY,
    };
  }

  // Equirectangular projection into CSS pixel space, aspect-preserving,
  // centered, then transformed by the user-controlled viewport.
  function project(lng, lat) {
    const base = baseProject(lng, lat);
    return base ? viewPoint(base) : null;
  }

  function clampViewport() {
    const limitX = Math.max(40, W * zoom * 0.55);
    const limitY = Math.max(40, H * zoom * 0.55);
    panX = Math.max(-limitX, Math.min(limitX, panX));
    panY = Math.max(-limitY, Math.min(limitY, panY));
  }

  function setZoom(nextZoom, anchor = { x: W / 2, y: H / 2 }) {
    const oldZoom = zoom;
    zoom = Math.max(0.85, Math.min(5.2, nextZoom));
    if (oldZoom === zoom) return;
    panX = anchor.x - W / 2 - ((anchor.x - W / 2 - panX) * zoom) / oldZoom;
    panY = anchor.y - H / 2 - ((anchor.y - H / 2 - panY) * zoom) / oldZoom;
    clampViewport();
    reproject();
  }

  function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
    selected = null;
    reproject();
    emitSelection(null);
  }

  function focusOn(lng, lat, nextZoom) {
    const base = baseProject(lng, lat);
    if (!base) return;
    zoom = Math.max(0.85, Math.min(5.2, nextZoom || 2));
    panX = W / 2 - base.x * zoom + (W / 2) * (zoom - 1);
    panY = H / 2 - base.y * zoom + (H / 2) * (zoom - 1);
    clampViewport();
    reproject();
  }

  // Extract just the outer rings from a GeoJSON FeatureCollection /
  // geometry, handling Polygon and MultiPolygon.
  function extractRings(gj) {
    const rings = [];
    if (!gj) return rings;

    function handleGeometry(geom) {
      if (!geom || !geom.type) return;
      if (geom.type === 'Polygon') {
        // coordinates: [ outerRing, hole, hole, ... ]
        if (Array.isArray(geom.coordinates) && geom.coordinates.length) {
          rings.push(geom.coordinates[0]);
        }
      } else if (geom.type === 'MultiPolygon') {
        // coordinates: [ [ outerRing, hole... ], [ outerRing, hole... ] ]
        if (Array.isArray(geom.coordinates)) {
          for (const poly of geom.coordinates) {
            if (Array.isArray(poly) && poly.length) rings.push(poly[0]);
          }
        }
      } else if (geom.type === 'GeometryCollection' && Array.isArray(geom.geometries)) {
        for (const g of geom.geometries) handleGeometry(g);
      }
    }

    if (gj.type === 'FeatureCollection' && Array.isArray(gj.features)) {
      for (const f of gj.features) {
        if (f && f.geometry) handleGeometry(f.geometry);
      }
    } else if (gj.type === 'Feature' && gj.geometry) {
      handleGeometry(gj.geometry);
    } else if (gj.type) {
      handleGeometry(gj);
    }
    return rings;
  }

  countryRings = extractRings(geojson);

  // Color theme keyed by route status.
  function statusTheme(status) {
    switch (status) {
      case 'disrupted':
        return { core: '#ff5a5a', glow: 'rgba(255,70,70,0.85)' };
      case 'resilient':
        return { core: '#3fe39b', glow: 'rgba(60,230,150,0.7)' };
      case 'normal':
      default:
        return { core: '#5aa9ff', glow: 'rgba(90,170,255,0.6)' };
    }
  }

  // --- projection / layout ---------------------------------------------
  function reproject() {
    projRoutes = [];
    projNodes = [];
    projectedRings = [];

    for (const ring of countryRings) {
      if (!Array.isArray(ring) || ring.length < 2) continue;
      const projected = [];
      for (const c of ring) {
        if (!Array.isArray(c) || c.length < 2) continue;
        const pt = project(c[0], c[1]);
        if (pt) projected.push(pt);
      }
      if (projected.length > 1) projectedRings.push(projected);
    }

    if (!data) return;

    const ri = data.route_intel || {};
    const routes = Array.isArray(ri.routes) ? ri.routes : [];
    const nodes = Array.isArray(ri.map_nodes) ? ri.map_nodes : [];

    for (const r of routes) {
      if (!r) continue;
      const o = r.origin || {};
      const p = r.plant || {};
      const a = project(o.lng, o.lat);
      const b = project(p.lng, p.lat);
      if (!a || !b) continue;

      // Midpoint pushed perpendicular "outward" (upward bow). The
      // perpendicular to the chord (dx,dy) is (-dy, dx); we bias it so the
      // control point lifts toward the top of the canvas.
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      let nx = -dy / dist;
      let ny = dx / dist;
      // Ensure the normal points upward (negative y == up on canvas).
      if (ny > 0) { nx = -nx; ny = -ny; }
      const bow = Math.min(dist * 0.28, H * 0.45) + 18;
      const cx = mx + nx * bow;
      const cy = my + ny * bow;

      const share = isNum(r.share_percent) ? r.share_percent : 0;
      projRoutes.push({
        a, b,
        cx, cy,
        status: r.status || 'normal',
        affected: !!r.affected,
        share,
        width: 1.2 + share / 12,
        route_id: r.route_id,
        origin: o,
        plant: p,
        // per-route phase offset so comets don't all line up
        phase: Math.random(),
        source: r,
      });
    }

    for (const n of nodes) {
      if (!n) continue;
      const pt = project(n.lng, n.lat);
      if (!pt) continue;
      projNodes.push({
        x: pt.x,
        y: pt.y,
        type: n.type || 'origin',
        label: n.label || n.id || '',
        sublabel: n.sublabel || '',
        affected: !!n.affected,
        id: n.id,
        lat: n.lat,
        lng: n.lng,
        source: n,
      });
    }
  }

  // Quadratic bezier point at t in [0,1].
  function bezierPoint(r, t) {
    const mt = 1 - t;
    const x = mt * mt * r.a.x + 2 * mt * t * r.cx + t * t * r.b.x;
    const y = mt * mt * r.a.y + 2 * mt * t * r.cy + t * t * r.b.y;
    return { x, y };
  }

  // --- sizing -----------------------------------------------------------
  function resize() {
    dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const cssW = canvasEl.clientWidth || canvasEl.width || 960;
    const cssH = canvasEl.clientHeight || canvasEl.height || 480;
    W = cssW;
    H = cssH;
    // Fit the full world (360° x 180°) while preserving 2:1 aspect, then center.
    scale = Math.min(W / 360, H / 180);
    if (W < 560) {
      scale *= 1.08;
    }
    offX = (W - 360 * scale) / 2;
    offY = (H - 180 * scale) / 2;
    if (W < 560) {
      offY = Math.min(offY, 128);
    }
    canvasEl.width = Math.max(1, Math.round(cssW * dpr));
    canvasEl.height = Math.max(1, Math.round(cssH * dpr));
    // Reset transform then scale so all drawing happens in CSS pixels.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    reproject();
  }

  // --- static layer drawing --------------------------------------------
  function drawOcean() {
    ctx.fillStyle = '#0a1124';
    ctx.fillRect(0, 0, W, H);
  }

  function drawGraticule() {
    ctx.save();
    ctx.strokeStyle = 'rgba(120,150,210,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lng = -180; lng <= 180; lng += 30) {
      const top = project(lng, 90);
      const bot = project(lng, -90);
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bot.x, bot.y);
    }
    for (let lat = -90; lat <= 90; lat += 30) {
      const left = project(-180, lat);
      const right = project(180, lat);
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawCountries() {
    ctx.save();
    ctx.fillStyle = '#16223d';
    ctx.strokeStyle = '#243a63';
    ctx.lineWidth = Math.max(0.45, Math.min(1.1, zoom * 0.45));
    for (const ring of projectedRings) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < ring.length; i++) {
        const pt = ring[i];
        if (!started) { ctx.moveTo(pt.x, pt.y); started = true; }
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- routes + comets --------------------------------------------------
  function drawRoutes(now) {
    for (const r of projRoutes) {
      const theme = statusTheme(r.status);
      const disrupted = r.status === 'disrupted';
      const affected = r.affected || disrupted;
      const selectedRoute = selected && selected.type === 'route' && selected.route_id === r.route_id;

      // Pulse factor for disrupted/affected routes.
      const pulse = disrupted
        ? 0.55 + 0.45 * Math.sin(now / 280 + r.phase * 6.28)
        : 1;

      // --- base glowing arc ---
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(r.a.x, r.a.y);
      ctx.quadraticCurveTo(r.cx, r.cy, r.b.x, r.b.y);
      ctx.lineCap = 'round';
      ctx.shadowColor = theme.glow;
      ctx.shadowBlur = (selectedRoute ? 30 : disrupted ? 22 : 12) * pulse;
      ctx.strokeStyle = theme.glow;
      ctx.lineWidth = r.width + (selectedRoute ? 2.4 : 0);
      ctx.globalAlpha = selectedRoute ? 0.95 : disrupted ? 0.5 + 0.35 * pulse : 0.55;
      ctx.stroke();
      // brighter core line on top
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = theme.core;
      ctx.lineWidth = Math.max(0.8, r.width * 0.6);
      ctx.stroke();
      ctx.restore();

      // --- traveling comet of light ---
      // Speed: affected/disrupted routes flow faster and brighter.
      const speed = affected ? 0.00042 : 0.00022;
      const t = ((now * speed + r.phase) % 1 + 1) % 1;
      const head = bezierPoint(r, t);

      // a short tail behind the head, drawn as a few fading segments
      const tailLen = affected ? 0.14 : 0.10;
      ctx.save();
      ctx.lineCap = 'round';
      const segs = 10;
      for (let i = 0; i < segs; i++) {
        const t1 = t - (tailLen * i) / segs;
        const t0 = t - (tailLen * (i + 1)) / segs;
        if (t0 < 0) continue;
        const p1 = bezierPoint(r, t1);
        const p0 = bezierPoint(r, t0);
        const fade = 1 - i / segs;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = theme.core;
        ctx.globalAlpha = fade * (affected ? 0.9 : 0.7);
        ctx.shadowColor = theme.glow;
        ctx.shadowBlur = (affected ? 16 : 8) * fade;
        ctx.lineWidth = Math.max(1, r.width * fade);
        ctx.stroke();
      }
      // bright head dot
      ctx.beginPath();
      ctx.globalAlpha = 1;
      ctx.shadowColor = theme.glow;
      ctx.shadowBlur = affected ? 18 : 10;
      ctx.fillStyle = '#ffffff';
      ctx.arc(head.x, head.y, affected ? 2.6 : 2.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // --- nodes ------------------------------------------------------------
  function drawNodes(now) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '11px system-ui, "Segoe UI", sans-serif';

    for (const n of projNodes) {
      const affected = n.affected;
      const t = now / 1000;
      const selectedNode = selected && selected.type === 'node' && selected.id === n.id;

      if (n.type === 'plant') {
        // OUR downstream plants — make them stand out: cyan/white pulsing
        // concentric rings. Affected plants pulse red.
        const baseColor = affected ? '#ff5a5a' : '#7df9ff';
        const glow = affected ? 'rgba(255,80,80,0.9)' : 'rgba(125,249,255,0.85)';
        const pulse = 0.5 + 0.5 * Math.sin(t * 3 + n.x * 0.01);
        // expanding ring
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = glow;
        ctx.globalAlpha = selectedNode ? 0.9 : 0.6 * (1 - pulse);
        ctx.lineWidth = selectedNode ? 2.4 : 1.5;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 16;
        ctx.arc(n.x, n.y, (selectedNode ? 10 : 6) + pulse * 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        // inner solid ring
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 2;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 12;
        ctx.arc(n.x, n.y, 5.5, 0, Math.PI * 2);
        ctx.stroke();
        // bright center
        ctx.beginPath();
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 8;
        ctx.arc(n.x, n.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // label
        drawLabel(n.label, n.x + 9, n.y, affected ? '#ffb4b4' : '#cdfbff');

      } else if (n.type === 'origin') {
        // small diamond
        const color = affected ? '#ff5a5a' : '#ffd27a';
        const glow = affected ? 'rgba(255,80,80,0.8)' : 'rgba(255,200,110,0.6)';
        const pulse = affected ? 0.5 + 0.5 * Math.sin(t * 4 + n.x * 0.02) : 1;
        ctx.save();
        ctx.translate(n.x, n.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = color;
        ctx.shadowColor = glow;
        ctx.shadowBlur = (affected ? 14 : 7) * pulse + (selectedNode ? 10 : 0);
        const s = selectedNode ? 5.6 : 3.6;
        ctx.fillRect(-s, -s, s * 2, s * 2);
        ctx.restore();
        drawLabel(n.label, n.x + 7, n.y, affected ? '#ffb4b4' : '#e7d6ac');

      } else {
        // 'port' (or unknown) -> tiny dot
        const color = affected ? '#ff5a5a' : '#8fa6cf';
        const glow = affected ? 'rgba(255,80,80,0.8)' : 'rgba(140,165,210,0.4)';
        const pulse = affected ? 0.5 + 0.5 * Math.sin(t * 4 + n.x * 0.02) : 1;
        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.shadowColor = glow;
        ctx.shadowBlur = (affected ? 10 : 3) * pulse + (selectedNode ? 8 : 0);
        ctx.arc(n.x, n.y, selectedNode ? 4 : affected ? 2.6 : 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawLabel(text, x, y, color) {
    if (!text) return;
    ctx.save();
    ctx.font = '11px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // subtle dark backing for legibility
    ctx.fillStyle = 'rgba(8,14,30,0.55)';
    const w = ctx.measureText(text).width;
    ctx.fillRect(x - 2, y - 7, w + 4, 14);
    ctx.fillStyle = color || '#dce6ff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 2;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // --- frame ------------------------------------------------------------
  function frame() {
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();

    ctx.clearRect(0, 0, W, H);
    drawOcean();
    drawGraticule();
    drawCountries();
    drawRoutes(now);
    drawNodes(now);

    rafId = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    rafId = requestAnimationFrame(frame);
  }

  // --- hover / tooltip --------------------------------------------------
  function summarizeRoutes(node) {
    if (!data) return '';
    const ri = data.route_intel || {};
    const routes = Array.isArray(ri.routes) ? ri.routes : [];
    const matchKey = node.type === 'plant' ? 'plant' : 'origin';
    const related = routes.filter((r) => {
      const side = r && r[matchKey];
      return side && side.name === node.label;
    });
    if (!related.length) return '';
    const lines = related.map((r) => {
      const other = matchKey === 'plant' ? (r.origin || {}) : (r.plant || {});
      const share = isNum(r.share_percent) ? r.share_percent + '%' : '';
      const st = r.status || 'normal';
      return '<div class="mt-route">' +
        '<span class="mt-dot mt-' + st + '"></span>' +
        escapeHtml(other.name || '') +
        (share ? ' · ' + share : '') +
        ' · ' + escapeHtml(st) +
        '</div>';
    });
    return lines.join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function hitTest(mx, my) {
    let best = null;
    let bestD = 14; // px radius
    for (const n of projNodes) {
      const d = Math.hypot(n.x - mx, n.y - my);
      if (d < bestD) { bestD = d; best = { type: 'node', item: n }; }
    }
    for (const r of projRoutes) {
      const d = routeDistance(r, mx, my);
      const threshold = Math.max(9, r.width + 6);
      if (d < threshold && d < bestD) {
        bestD = d;
        best = { type: 'route', item: r };
      }
    }
    return best;
  }

  function routeDistance(route, x, y) {
    let best = Infinity;
    let prev = bezierPoint(route, 0);
    for (let i = 1; i <= 36; i++) {
      const next = bezierPoint(route, i / 36);
      best = Math.min(best, segmentDistance(x, y, prev.x, prev.y, next.x, next.y));
      prev = next;
    }
    return best;
  }

  function segmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    const x = ax + t * dx;
    const y = ay + t * dy;
    return Math.hypot(px - x, py - y);
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.hidden = true;
  }

  function showTooltip(hit, clientX, clientY) {
    if (!tooltipEl) return;
    const node = hit.type === 'node' ? hit.item : null;
    const route = hit.type === 'route' ? hit.item : null;
    let html = '';
    if (route) {
      const status = route.status === 'disrupted' ? '要対応' : route.status === 'resilient' ? '代替可' : '通常';
      html += '<div class="mt-label">' + escapeHtml((route.origin || {}).name || '') + ' → ' + escapeHtml((route.plant || {}).name || '') + '</div>';
      html += '<div class="mt-sub">' + escapeHtml(route.share) + '% / ' + escapeHtml(status) + '</div>';
    } else {
      html = '<div class="mt-label">' + escapeHtml(node.label) + '</div>';
    }
    if (node) {
    if (node.sublabel) {
      html += '<div class="mt-sub">' + escapeHtml(node.sublabel) + '</div>';
    }
    if (node.affected) {
      html += '<div class="mt-affected">影響あり / affected</div>';
    }
    if (node.type === 'plant' || node.type === 'origin') {
      const routesHtml = summarizeRoutes(node);
      if (routesHtml) {
        html += '<div class="mt-routes">' + routesHtml + '</div>';
      }
    }
    }
    tooltipEl.innerHTML = html;
    tooltipEl.hidden = false;

    // Position near cursor, relative to the tooltip's offset parent.
    const parent = tooltipEl.offsetParent || canvasEl.parentElement;
    let left = clientX + 14;
    let top = clientY + 14;
    if (parent && parent.getBoundingClientRect) {
      const pr = parent.getBoundingClientRect();
      left = clientX - pr.left + 14;
      top = clientY - pr.top + 14;
    } else {
      const cr = canvasEl.getBoundingClientRect();
      left = clientX - cr.left + 14;
      top = clientY - cr.top + 14;
    }
    tooltipEl.style.position = 'absolute';
    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
  }

  function onMouseMove(ev) {
    const rect = canvasEl.getBoundingClientRect();
    // map client coords -> CSS-pixel projection space
    const mx = (ev.clientX - rect.left) * (W / (rect.width || W));
    const my = (ev.clientY - rect.top) * (H / (rect.height || H));
    mouse.x = mx;
    mouse.y = my;
    mouse.inside = true;

    const hit = hitTest(mx, my);
    if (hit) {
      showTooltip(hit, ev.clientX, ev.clientY);
      canvasEl.style.cursor = 'pointer';
    } else {
      hideTooltip();
      canvasEl.style.cursor = 'default';
    }
  }

  function onMouseLeave() {
    mouse.inside = false;
    dragging = false;
    hideTooltip();
    canvasEl.style.cursor = 'default';
  }

  function onPointerDown(ev) {
    dragging = true;
    dragStart = { x: ev.clientX, y: ev.clientY, panX, panY };
    if (canvasEl.setPointerCapture && ev.pointerId != null) {
      canvasEl.setPointerCapture(ev.pointerId);
    }
  }

  function onPointerMove(ev) {
    if (!dragging) return;
    panX = dragStart.panX + ev.clientX - dragStart.x;
    panY = dragStart.panY + ev.clientY - dragStart.y;
    clampViewport();
    reproject();
  }

  function onPointerUp(ev) {
    if (!dragging) return;
    const moved = Math.hypot(ev.clientX - dragStart.x, ev.clientY - dragStart.y);
    dragging = false;
    if (moved > 6) return;

    const rect = canvasEl.getBoundingClientRect();
    const mx = (ev.clientX - rect.left) * (W / (rect.width || W));
    const my = (ev.clientY - rect.top) * (H / (rect.height || H));
    const hit = hitTest(mx, my);
    if (!hit) {
      selected = null;
      emitSelection(null);
      return;
    }
    if (hit.type === 'route') {
      selected = { type: 'route', route_id: hit.item.route_id };
      emitSelection({ type: 'route', route: hit.item.source });
    } else {
      selected = { type: 'node', id: hit.item.id };
      emitSelection({ type: 'node', node: hit.item.source });
    }
  }

  function onWheel(ev) {
    ev.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const anchor = {
      x: (ev.clientX - rect.left) * (W / (rect.width || W)),
      y: (ev.clientY - rect.top) * (H / (rect.height || H)),
    };
    const factor = ev.deltaY < 0 ? 1.18 : 0.84;
    setZoom(zoom * factor, anchor);
  }

  function emitSelection(detail) {
    canvasEl.dispatchEvent(new CustomEvent('supply-map-select', { detail }));
  }

  canvasEl.addEventListener('mousemove', onMouseMove);
  canvasEl.addEventListener('mouseleave', onMouseLeave);
  canvasEl.addEventListener('pointerdown', onPointerDown);
  canvasEl.addEventListener('pointermove', onPointerMove);
  canvasEl.addEventListener('pointerup', onPointerUp);
  canvasEl.addEventListener('pointercancel', onPointerLeaveOrCancel);
  canvasEl.addEventListener('wheel', onWheel, { passive: false });

  function onPointerLeaveOrCancel() {
    dragging = false;
  }

  // --- window resize (debounced) ---------------------------------------
  let resizeTimer = null;
  function onWindowResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      resize();
    }, 120);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onWindowResize);
  }

  // --- public API -------------------------------------------------------
  function render(newData) {
    data = newData || null;
    // Cancel any prior loop so re-rendering cleanly replaces old data.
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    resize();      // (re)reads size + reprojects everything
    startLoop();   // (re)start animation
  }

  // Initial sizing so the canvas is valid even before first render().
  resize();

  return {
    render,
    resize,
    zoomIn() { setZoom(zoom * 1.25); },
    zoomOut() { setZoom(zoom / 1.25); },
    resetView,
    focusAsia() { focusOn(112, 22, W < 560 ? 2.05 : 1.75); },
    focusJapan() { focusOn(138, 35, W < 560 ? 4.6 : 3.6); },
  };
}
