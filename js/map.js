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

  let countryRings = []; // pre-extracted outer rings: [[ [lng,lat], ... ], ...]
  let projRoutes = [];   // projected routes ready to draw
  let projNodes = [];    // projected nodes ready to draw

  let rafId = null;
  let mouse = { x: -9999, y: -9999, inside: false };

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

  // Equirectangular projection into CSS pixel space, aspect-preserving + centered.
  function project(lng, lat) {
    if (!isNum(lng) || !isNum(lat)) return null;
    return {
      x: offX + (lng + 180) * scale,
      y: offY + (90 - lat) * scale,
    };
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
      scale *= 0.8;
    }
    offX = (W - 360 * scale) / 2;
    offY = (H - 180 * scale) / 2;
    if (W < 560) {
      offX -= 12;
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
    ctx.lineWidth = 0.5;
    for (const ring of countryRings) {
      if (!Array.isArray(ring) || ring.length < 2) continue;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < ring.length; i++) {
        const c = ring[i];
        if (!Array.isArray(c) || c.length < 2) continue;
        const x = offX + (c[0] + 180) * scale;
        const y = offY + (90 - c[1]) * scale;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
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
      ctx.shadowBlur = (disrupted ? 22 : 12) * pulse;
      ctx.strokeStyle = theme.glow;
      ctx.lineWidth = r.width;
      ctx.globalAlpha = disrupted ? 0.5 + 0.35 * pulse : 0.55;
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
        ctx.globalAlpha = 0.6 * (1 - pulse);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 16;
        ctx.arc(n.x, n.y, 6 + pulse * 9, 0, Math.PI * 2);
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
        ctx.shadowBlur = (affected ? 14 : 7) * pulse;
        const s = 3.6;
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
        ctx.shadowBlur = (affected ? 10 : 3) * pulse;
        ctx.arc(n.x, n.y, affected ? 2.6 : 1.8, 0, Math.PI * 2);
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
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.hidden = true;
  }

  function showTooltip(node, clientX, clientY) {
    if (!tooltipEl) return;
    let html = '<div class="mt-label">' + escapeHtml(node.label) + '</div>';
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
    hideTooltip();
    canvasEl.style.cursor = 'default';
  }

  canvasEl.addEventListener('mousemove', onMouseMove);
  canvasEl.addEventListener('mouseleave', onMouseLeave);

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

  return { render, resize };
}
