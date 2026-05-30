// panels.js — fills the side + table panels from the data model.
// Pure vanilla JS. No imports, no libraries.
// Contract: renderPanels(data) reads/populates DOM by fixed element ids.

const SEVERITY_COLORS = {
  critical: "#c9362f",
  high: "#c9362f",
  medium: "#b66a00",
  low: "#18794e",
};

const STATUS_COLORS = {
  disrupted: "#c9362f",
  exposed: "#b66a00",
  resilient: "#18794e",
  normal: "#174a8b",
};

const PRIORITY_COLORS = {
  high: "#c9362f",
  medium: "#b66a00",
  low: "#8a93a3",
};

const STATUS_ORDER = { disrupted: 0, exposed: 1, resilient: 2, normal: 3 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function $(id) {
  return typeof document !== "undefined" ? document.getElementById(id) : null;
}

// Compact USD: 7800000 -> "$7.8M", 900000 -> "$900K", 400000 -> "$0.4M".
// >=$1M -> decimal millions ("$7.8M"); $1K..<$1M -> thousands ("$900K").
// Keeps one decimal for millions, drops a trailing ".0".
function compactUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    const s = m >= 100 ? Math.round(m).toString() : trim1(m);
    return `${sign}$${s}M`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    const s = k >= 100 ? Math.round(k).toString() : trim1(k);
    return `${sign}$${s}K`;
  }
  return `${sign}$${Math.round(abs)}`;
}

function trim1(num) {
  const s = num.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function severityColor(sev) {
  return SEVERITY_COLORS[String(sev || "").toLowerCase()] || "#607086";
}

function statusColor(status) {
  return STATUS_COLORS[String(status || "").toLowerCase()] || "#607086";
}

function priorityColor(priority) {
  return PRIORITY_COLORS[String(priority || "").toLowerCase()] || "#8a93a3";
}

function setHtml(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
  return el;
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
  return el;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderScenario(data) {
  const meta = data.meta || {};
  const risk = data.risk_event || {};
  const assessment = data.assessment || {};
  const severity = String(assessment.severity || "").toUpperCase();
  const parts = [
    meta.scenario,
    risk.region,
    severity ? `severity ${severity}` : null,
  ].filter(Boolean);
  setText("scenario", parts.join(" · "));
}

function renderGeneratedAt(data) {
  const meta = data.meta || {};
  let stamp = meta.generated_at;
  if (stamp) {
    const parsed = new Date(stamp);
    if (!Number.isNaN(parsed.getTime())) stamp = parsed.toLocaleString();
  }
  setHtml(
    "generated-at",
    `<span class="live-dot" style="color:#18794e;font-weight:700;">● LIVE</span> ` +
      `<span class="generated-text">Generated ${esc(stamp || "—")}</span>`,
  );
}

function renderRiskGauge(data) {
  const assessment = data.assessment || {};
  const rawScore = Number(assessment.risk_score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0;
  const severity = String(assessment.severity || "unknown");
  const color = severityColor(severity);

  // Geometry for the circular gauge.
  const size = 200;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (score / 100) * circumference;

  const html = `
    <div class="gauge-wrap" style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      <svg class="gauge-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
           role="img" aria-label="Risk score ${score} out of 100">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e3e8ef" stroke-width="${stroke}" />
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
                stroke-linecap="round"
                stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
                transform="rotate(-90 ${cx} ${cy})" />
        <text x="${cx}" y="${cy - 6}" text-anchor="middle" dominant-baseline="middle"
              font-size="52" font-weight="800" fill="${color}">${score}</text>
        <text x="${cx}" y="${cy + 26}" text-anchor="middle" dominant-baseline="middle"
              font-size="13" letter-spacing="1" fill="#607086">/100 RISK SCORE</text>
      </svg>
      <span class="severity-chip"
            style="display:inline-flex;padding:5px 12px;border-radius:999px;color:#fff;
                   background:${color};font-size:13px;font-weight:700;text-transform:uppercase;
                   letter-spacing:0.5px;">${esc(severity)}</span>
    </div>`;
  setHtml("risk-gauge", html);
}

function kpiCard(value, labelEn, labelJa, opts = {}) {
  const accent = opts.atRisk ? "#c9362f" : opts.color || "#174a8b";
  const valueColor = opts.valueColor || accent;
  const borderStyle = opts.atRisk
    ? "border-left:4px solid #c9362f;"
    : "border-left:4px solid #d9e0ea;";
  const sub = opts.sub
    ? `<small class="kpi-sub" style="display:block;color:#607086;font-size:12px;margin-top:2px;">${esc(opts.sub)}</small>`
    : "";
  return `
    <div class="kpi-card${opts.atRisk ? " kpi-at-risk" : ""}"
         style="background:#fff;border:1px solid #d9e0ea;${borderStyle}border-radius:8px;
                padding:14px 16px;box-shadow:0 1px 2px rgba(16,24,40,0.05);">
      <strong class="kpi-value" style="display:block;font-size:30px;font-weight:800;color:${valueColor};line-height:1.05;">${esc(value)}</strong>
      ${sub}
      <span class="kpi-label" style="display:block;color:#607086;font-size:12px;margin-top:6px;line-height:1.35;">${esc(labelJa)}<br>${esc(labelEn)}</span>
    </div>`;
}

function renderKpiGrid(data) {
  const assessment = data.assessment || {};
  const intel = data.route_intel || {};
  const kpis = intel.kpis || {};

  const cards = [];

  // 1) Affected sourcing share
  cards.push(
    kpiCard(
      `${kpis.affected_share_percent ?? 0}%`,
      "Sourcing at risk",
      "調達割合(被影響)",
      { atRisk: true },
    ),
  );

  // 2) Monthly spend at risk
  cards.push(
    kpiCard(
      compactUsd(kpis.monthly_spend_at_risk),
      "Spend at risk",
      "課金額(被影響)",
      { atRisk: true, sub: `of ${compactUsd(kpis.total_monthly_spend)}` },
    ),
  );

  // 3) Affected routes
  cards.push(
    kpiCard(
      `${kpis.affected_routes ?? 0}/${kpis.total_routes ?? 0}`,
      "Routes",
      "被影響ルート",
      { atRisk: true },
    ),
  );

  // 4) Min inventory days
  const invDays = Number(assessment.inventory_days_min);
  const lowInv = Number.isFinite(invDays) && invDays <= 7;
  cards.push(
    kpiCard(
      `${Number.isFinite(invDays) ? invDays : "—"}d`,
      "Inventory days",
      "最短在庫残",
      { valueColor: lowInv ? "#c9362f" : "#174a8b" },
    ),
  );

  // 5) Impacted products
  cards.push(
    kpiCard(
      asArray(assessment.impacted_products).length,
      "Products",
      "影響製品",
      {},
    ),
  );

  // 6) Impacted customers
  cards.push(
    kpiCard(
      asArray(assessment.impacted_customers).length,
      "Customers",
      "影響顧客",
      {},
    ),
  );

  setHtml("kpi-grid", cards.join(""));
}

function renderSourcingMix(data) {
  const intel = data.route_intel || {};
  const sourcing = intel.sourcing || {};
  const focal = sourcing.focal || {};
  const routes = asArray(focal.routes).slice();

  // Sort disrupted first.
  routes.sort((a, b) => {
    const sa = STATUS_ORDER[String(a.status || "").toLowerCase()] ?? 99;
    const sb = STATUS_ORDER[String(b.status || "").toLowerCase()] ?? 99;
    if (sa !== sb) return sa - sb;
    return (b.share_percent || 0) - (a.share_percent || 0);
  });

  const materialName = focal.material
    ? focal.material.charAt(0).toUpperCase() + focal.material.slice(1)
    : "Sourcing";

  const header = `
    <div class="sourcing-header" style="font-size:13px;color:#172033;margin-bottom:12px;font-weight:600;">
      ${esc(materialName)} sourcing: <span style="color:#c9362f;">${focal.affected_share ?? 0}% at risk</span>
      · ${esc(compactUsd(focal.affected_spend))} / ${esc(compactUsd(focal.total_spend))}
    </div>`;

  const rows = routes
    .map((route) => {
      const color = statusColor(route.status);
      const share = Number(route.share_percent) || 0;
      return `
        <div class="sourcing-row" style="margin-bottom:12px;">
          <div class="sourcing-row-top"
               style="display:flex;justify-content:space-between;align-items:baseline;font-size:13px;margin-bottom:4px;">
            <span class="sourcing-origin" style="font-weight:600;color:#172033;">
              ${esc(route.origin)}
              <span style="color:#607086;font-weight:400;"> · ${esc(route.region)} · ${esc(route.supplier)}</span>
            </span>
            <span class="sourcing-share" style="font-weight:700;color:${color};">${share}%</span>
          </div>
          <div class="sourcing-bar-track"
               style="background:#eef1f5;border-radius:4px;height:10px;overflow:hidden;">
            <div class="sourcing-bar-fill"
                 style="width:${share}%;height:100%;background:${color};border-radius:4px;"></div>
          </div>
          <div class="sourcing-row-bottom"
               style="display:flex;gap:14px;font-size:12px;color:#607086;margin-top:4px;">
            <span class="sourcing-spend">${esc(compactUsd(route.monthly_spend_usd))}/mo</span>
            <span class="sourcing-lead">${esc(route.lead_time_days ?? "—")}d lead</span>
            <span class="sourcing-status" style="color:${color};font-weight:600;text-transform:capitalize;">${esc(route.status)}</span>
          </div>
        </div>`;
    })
    .join("");

  const body = rows || `<p style="color:#607086;font-size:13px;">No sourcing data.</p>`;
  setHtml("sourcing-mix", header + body);
}

function priorityChip(priority) {
  const color = priorityColor(priority);
  const isGrey = String(priority || "").toLowerCase() === "low";
  return `<span class="priority-chip"
    style="display:inline-flex;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;
           text-transform:uppercase;color:${isGrey ? "#3a4150" : "#fff"};background:${color};">${esc(priority)}</span>`;
}

function renderOrdersTable(data) {
  const assessment = data.assessment || {};
  const orders = asArray(assessment.impacted_orders);

  const rows = orders
    .map((o) => {
      const qty = o.qty ?? o.quantity ?? "—";
      return `
        <tr>
          <td>${esc(o.order_id)}</td>
          <td>${esc(o.customer)}</td>
          <td>${esc(o.product)}</td>
          <td>${esc(o.plant)}</td>
          <td>${esc(o.due_date)}</td>
          <td style="text-align:right;">${esc(qty)}</td>
          <td>${priorityChip(o.priority)}</td>
        </tr>`;
    })
    .join("");

  const body =
    rows ||
    `<tr><td colspan="7" style="color:#607086;">No impacted orders.</td></tr>`;

  const html = `
    <table class="orders-table" style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr>
          <th style="text-align:left;color:#607086;font-weight:600;border-bottom:1px solid #d9e0ea;padding:8px;">Order</th>
          <th style="text-align:left;color:#607086;font-weight:600;border-bottom:1px solid #d9e0ea;padding:8px;">Customer</th>
          <th style="text-align:left;color:#607086;font-weight:600;border-bottom:1px solid #d9e0ea;padding:8px;">Product</th>
          <th style="text-align:left;color:#607086;font-weight:600;border-bottom:1px solid #d9e0ea;padding:8px;">Plant</th>
          <th style="text-align:left;color:#607086;font-weight:600;border-bottom:1px solid #d9e0ea;padding:8px;">Due</th>
          <th style="text-align:right;color:#607086;font-weight:600;border-bottom:1px solid #d9e0ea;padding:8px;">Qty</th>
          <th style="text-align:left;color:#607086;font-weight:600;border-bottom:1px solid #d9e0ea;padding:8px;">Priority</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
  const el = setHtml("orders-table", html);
  // Style the data-cell borders without per-cell inline noise.
  if (el) {
    el.querySelectorAll("tbody td").forEach((td) => {
      td.style.borderBottom = "1px solid #eef1f5";
      td.style.padding = "8px";
      td.style.verticalAlign = "top";
    });
  }
}

function renderList(id, items, emptyText) {
  const arr = asArray(items);
  const html = arr.length
    ? arr.map((item) => `<li>${esc(item)}</li>`).join("")
    : `<li style="color:#607086;list-style:none;">${esc(emptyText)}</li>`;
  setHtml(id, html);
}

function renderMapLegend() {
  const swatches = [
    { label: "Disrupted", color: STATUS_COLORS.disrupted },
    { label: "Resilient", color: STATUS_COLORS.resilient },
    { label: "Normal", color: STATUS_COLORS.normal },
    { label: "Our Plant", color: "#00bcd4" },
  ];
  const html = swatches
    .map(
      (s) => `
      <span class="legend-item" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#607086;margin-right:14px;">
        <span class="legend-swatch" style="width:12px;height:12px;border-radius:3px;background:${s.color};display:inline-block;"></span>
        ${esc(s.label)}
      </span>`,
    )
    .join("");
  setHtml("map-legend", html);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function renderPanels(data) {
  const model = data || {};
  const assessment = model.assessment || {};

  renderScenario(model);
  renderGeneratedAt(model);
  renderRiskGauge(model);
  renderKpiGrid(model);
  renderSourcingMix(model);
  renderOrdersTable(model);
  renderList("evidence-list", assessment.evidence, "No evidence.");
  renderList("actions-list", assessment.recommended_actions, "No recommended actions.");
  renderList("approval-list", assessment.approval_required, "No approvals required.");
  renderMapLegend();
}
