const STATUS_COLORS = {
  disrupted: "#c9362f",
  exposed: "#b66a00",
  resilient: "#18794e",
  normal: "#2563a8",
};

const PRIORITY_COLORS = {
  high: "#c9362f",
  medium: "#b66a00",
  low: "#637083",
};

const STATUS_LABELS = {
  disrupted: "要対応",
  exposed: "監視",
  resilient: "代替可",
  normal: "通常",
};

const PRIORITY_LABELS = {
  high: "高",
  medium: "中",
  low: "低",
};

const SEVERITY_LABELS = {
  high: "高",
  medium: "中",
  low: "低",
};

const MATERIAL_LABELS = {
  naphtha: "ナフサ",
  "packaging-film": "包装フィルム",
  "semiconductor-adhesive": "半導体接着材",
};

const REGION_LABELS = {
  Asia: "アジア",
  "Southeast Asia": "東南アジア",
  "East Asia": "東アジア",
  "Middle East": "中東",
  Europe: "欧州",
  Japan: "日本",
};

const ACTION_TRANSLATIONS = new Map([
  [
    "Confirm latest allocation volume and shipment schedule with the supplier.",
    "サプライヤへ最新の割当数量と出荷予定を確認する。",
  ],
  [
    "Reserve available inventory for high-priority orders and plants.",
    "高優先度の受注・工場向けに利用可能在庫を確保する。",
  ],
  [
    "Check applicability of approved alternative material: NAP-ALT-01.",
    "承認済み代替材 NAP-ALT-01 の適用可否を確認する。",
  ],
  [
    "Prepare customer communication draft for high-priority customers.",
    "高優先度顧客向けの一次説明文案を準備する。",
  ],
  [
    "Assess production schedule exposure against the 5-7 day delay window.",
    "5-7日の遅延見込みに対する生産計画への影響を確認する。",
  ],
  ["Purchase order changes", "発注内容の変更"],
  ["Supplier switching", "サプライヤ切替"],
  ["Formal customer notification", "顧客への正式通知"],
  ["Major production plan changes", "生産計画の大幅変更"],
]);

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

function materialLabel(material) {
  return MATERIAL_LABELS[material] || material || "不明";
}

function regionLabel(region) {
  return REGION_LABELS[region] || region || "地域不明";
}

function compactUsdJa(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0ドル";
  if (Math.abs(n) >= 1_000_000) {
    return `${trim1(n / 1_000_000)}百万ドル`;
  }
  if (Math.abs(n) >= 1_000) {
    return `${trim1(n / 1_000)}千ドル`;
  }
  return `${Math.round(n).toLocaleString("ja-JP")}ドル`;
}

function trim1(num) {
  const s = num.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function formatDateTime(value) {
  if (!value) return "不明";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function translateText(text) {
  if (ACTION_TRANSLATIONS.has(text)) {
    return ACTION_TRANSLATIONS.get(text);
  }
  if (String(text).startsWith("News headline:")) {
    return "業界ニュースで、アジア地域の製油所トラブルによりナフサ供給が逼迫している兆候を確認。";
  }
  if (String(text).includes("5-7 day shipment delay")) {
    return "サプライヤ通知で、出荷が5-7日遅延する可能性を確認。";
  }
  if (String(text).includes("70% of normal volume")) {
    return "サプライヤ通知で、次回割当が通常契約量の70%程度に制限される可能性を確認。";
  }
  if (String(text).startsWith("Supplier notice subject:")) {
    return "サプライヤ通知: ナフサ由来原料の一時的な割当制限。";
  }
  return text;
}

function renderScenario(data) {
  const risk = data.risk_event || {};
  const assessment = data.assessment || {};
  const severity = assessment.severity ? `${SEVERITY_LABELS[assessment.severity] || assessment.severity}リスク` : "判定中";
  setText("scenario", `${materialLabel(risk.material)}供給リスク / ${regionLabel(risk.region)} / ${severity}`);
}

function renderGeneratedAt(data) {
  const meta = data.meta || {};
  const demo = data.demo || {};
  setHtml(
    "generated-at",
    `<span class="live-dot">監視中</span><span>${esc(demo.time_label || formatDateTime(meta.generated_at))} 更新</span>`,
  );
}

function renderRiskGauge(data) {
  const assessment = data.assessment || {};
  const rawScore = Number(assessment.risk_score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0;
  const severity = SEVERITY_LABELS[assessment.severity] || assessment.severity || "不明";
  const color = score >= 70 ? STATUS_COLORS.disrupted : STATUS_COLORS.exposed;

  setHtml(
    "risk-gauge",
    `
      <div class="risk-score">
        <div class="risk-score-main" style="color:${color};">${score}</div>
        <div class="risk-score-sub">/100 リスクスコア</div>
        <div class="risk-badge" style="background:${color};">危険度 ${esc(severity)}</div>
        ${renderRiskTrend(data)}
      </div>
    `,
  );
}

function renderRiskTrend(data) {
  const trend = asArray((data.demo || {}).score_trend);
  if (!trend.length) return "";
  const points = trend
    .map((item, index) => {
      const x = trend.length === 1 ? 50 : (index / (trend.length - 1)) * 100;
      const y = 100 - Math.max(0, Math.min(100, Number(item.score) || 0));
      return `${x},${y}`;
    })
    .join(" ");
  const last = trend[trend.length - 1] || {};
  return `
    <div class="risk-trend" aria-label="リスクスコア推移">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points="${esc(points)}"></polyline>
      </svg>
      <span>推移 ${esc(trend[0]?.score ?? "-")} → ${esc(last.score ?? "-")}</span>
    </div>`;
}

function kpiCard(value, label, sub = "", atRisk = false) {
  return `
    <div class="kpi-card${atRisk ? " kpi-at-risk" : ""}">
      <strong class="kpi-value">${esc(value)}</strong>
      ${sub ? `<span class="kpi-sub">${esc(sub)}</span>` : ""}
      <span class="kpi-label">${esc(label)}</span>
    </div>
  `;
}

function renderKpiGrid(data) {
  const assessment = data.assessment || {};
  const kpis = (data.route_intel && data.route_intel.kpis) || {};
  const invDays = Number(assessment.inventory_days_min);

  setHtml(
    "kpi-grid",
    [
      kpiCard(`${kpis.affected_share_percent ?? 0}%`, "影響を受ける調達比率", "ナフサ調達量ベース", true),
      kpiCard(compactUsdJa(kpis.monthly_spend_at_risk), "影響を受ける月間調達額", `全体 ${compactUsdJa(kpis.total_monthly_spend)}`, true),
      kpiCard(`${kpis.affected_routes ?? 0}/${kpis.total_routes ?? 0}`, "要対応ルート", "供給ルート数", true),
      kpiCard(Number.isFinite(invDays) ? `${invDays}日` : "不明", "最短在庫残日数", "工場別在庫から算出", invDays <= 7),
      kpiCard(asArray(assessment.impacted_products).length, "影響製品", "BOM照合結果"),
      kpiCard(asArray(assessment.impacted_customers).length, "影響顧客", "受注照合結果"),
    ].join(""),
  );
}

function renderSourcingMix(data) {
  const focal = (((data.route_intel || {}).sourcing || {}).focal) || {};
  const routes = asArray(focal.routes).slice().sort((a, b) => {
    const affectedDiff = Number(Boolean(b.affected)) - Number(Boolean(a.affected));
    if (affectedDiff) return affectedDiff;
    return (b.share_percent || 0) - (a.share_percent || 0);
  });

  const header = `
    <div class="sourcing-header">
      ${esc(materialLabel(focal.material))}調達:
      <span class="text-risk">${esc(focal.affected_share ?? 0)}%が要対応</span>
      <span class="sourcing-meta">${esc(compactUsdJa(focal.affected_spend))} / ${esc(compactUsdJa(focal.total_spend))}</span>
    </div>`;

  const rows = routes
    .map((route) => {
      const color = STATUS_COLORS[route.status] || STATUS_COLORS.normal;
      const status = STATUS_LABELS[route.status] || route.status || "不明";
      const share = Number(route.share_percent) || 0;
      return `
        <div class="sourcing-row">
          <div class="sourcing-row-top">
            <span class="sourcing-origin">${esc(route.origin)} <span class="sourcing-meta">${esc(regionLabel(route.region))} / ${esc(route.supplier)}</span></span>
            <span class="sourcing-share" style="color:${color};">${share}%</span>
          </div>
          <div class="sourcing-bar-track">
            <div class="sourcing-bar-fill" style="width:${share}%;background:${color};"></div>
          </div>
          <div class="sourcing-row-bottom">
            <span>${esc(compactUsdJa(route.monthly_spend_usd))}/月</span>
            <span>リードタイム ${esc(route.lead_time_days ?? "-")}日</span>
            <span class="sourcing-status" style="color:${color};">${esc(status)}</span>
          </div>
        </div>`;
    })
    .join("");

  setHtml("sourcing-mix", header + (rows || `<p class="empty">調達データがありません。</p>`));
}

function priorityChip(priority) {
  const key = String(priority || "").toLowerCase();
  const color = PRIORITY_COLORS[key] || PRIORITY_COLORS.low;
  const label = PRIORITY_LABELS[key] || priority || "-";
  return `<span class="priority-chip" style="background:${color};">${esc(label)}</span>`;
}

function renderOrdersTable(data) {
  const priorityRank = { high: 0, medium: 1, low: 2 };
  const orders = asArray((data.assessment || {}).impacted_orders)
    .slice()
    .sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9));
  const rows = orders
    .map((o) => `
      <tr>
        <td>${esc(o.order_id)}</td>
        <td>${esc(o.customer)}</td>
        <td>${esc(o.product)}</td>
        <td>${esc(o.plant)}</td>
        <td>${esc(o.due_date)}</td>
        <td class="num">${esc(o.qty ?? o.quantity ?? "-")}</td>
        <td>${priorityChip(o.priority)}</td>
      </tr>`)
    .join("");

  setHtml(
    "orders-table",
    `
      <table>
        <thead>
          <tr>
            <th>受注</th>
            <th>顧客</th>
            <th>製品</th>
            <th>工場</th>
            <th>納期</th>
            <th class="num">数量</th>
            <th>優先度</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="7">影響受注はありません。</td></tr>`}</tbody>
      </table>
    `,
  );
}

function renderList(id, items, emptyText) {
  const translated = asArray(items).map(translateText);
  const html = translated.length
    ? translated.map((item) => `<li>${esc(item)}</li>`).join("")
    : `<li>${esc(emptyText)}</li>`;
  setHtml(id, html);
}

function renderEventLog(data) {
  const demo = data.demo || {};
  const active = asArray(demo.active_events);
  const sources = asArray(demo.data_sources);
  const html = `
    <div class="event-current">
      <span>${esc(demo.time_label || "--:--")}</span>
      <strong>${esc(demo.title || "巡回待機中")}</strong>
      <p>${esc(demo.detail || "デモを開始すると、外部情報から自社影響まで順に更新されます。")}</p>
    </div>
    <div class="event-source-grid">
      ${sources
        .map(
          (source) => `
            <div class="source-chip">
              <strong>${esc(source.name)}</strong>
              <span>${esc(source.candidate)}</span>
            </div>`,
        )
        .join("")}
    </div>
    <ol class="event-list">
      ${active
        .map(
          (event) => `
            <li>
              <time>${esc(event.time_label)}</time>
              <div>
                <strong>${esc(event.title)}</strong>
                <span>${esc(event.source)}</span>
              </div>
            </li>`,
        )
        .join("") || "<li><time>--:--</time><div><strong>未開始</strong><span>巡回デモ開始を押してください</span></div></li>"}
    </ol>`;
  setHtml("event-log", html);
}

function renderInventoryRanking(data) {
  const assessment = data.assessment || {};
  const products = asArray(assessment.impacted_products);
  const plants = asArray(assessment.impacted_plants);
  const inventory = asArray(assessment.inventory).slice().sort((a, b) => (a.days_of_supply ?? 999) - (b.days_of_supply ?? 999));
  const rows = inventory
    .map((item) => {
      const days = Number(item.days_of_supply);
      const risk = Number.isFinite(days) && days <= 7;
      return `
        <div class="inventory-row${risk ? " inventory-risk" : ""}">
          <div>
            <strong>${esc(item.plant)}</strong>
            <span>${esc(materialLabel(item.material))} / ${esc(item.stock_qty)}${esc(item.unit || "")} 在庫</span>
          </div>
          <b>${Number.isFinite(days) ? `${days}日` : "不明"}</b>
        </div>`;
    })
    .join("");
  setHtml(
    "inventory-ranking",
    `
      <div class="impact-chip-row">
        ${products.map((p) => `<span>${esc(p)}</span>`).join("") || "<span>影響製品なし</span>"}
      </div>
      <p class="impact-note">対象工場: ${esc(plants.join("、") || "なし")}</p>
      <div class="inventory-list">${rows || `<p class="empty">在庫影響はありません。</p>`}</div>
    `,
  );
}

function renderAlternatives(data) {
  const alternatives = asArray((data.assessment || {}).alternatives);
  const rows = alternatives
    .map((alt) => {
      const approved = Boolean(alt.approved);
      return `
        <div class="alternative-row">
          <div>
            <strong>${esc(alt.alternative_material)}</strong>
            <span>${esc(alt.constraints)}</span>
          </div>
          <b class="${approved ? "approved" : "pending"}">${approved ? "承認済" : "評価中"}</b>
          <em>${esc(alt.lead_time_days)}日</em>
        </div>`;
    })
    .join("");
  setHtml("alternatives-table", rows || `<p class="empty">代替材候補はありません。</p>`);
}

function renderTaskBoard(data) {
  const assessment = data.assessment || {};
  const tasks = [
    { owner: "調達", text: "サプライヤへ割当数量と出荷予定を確認", due: "本日中" },
    { owner: "生産管理", text: `${assessment.inventory_days_min ?? "-"}日以内に影響する生産計画を確認`, due: "24時間以内" },
    { owner: "品質保証", text: "NAP-ALT-01 の適用品目と品質条件を確認", due: "24時間以内" },
    { owner: "営業", text: "高優先度顧客向けの一次説明文案を準備", due: "承認後" },
  ];
  const visibleCount = Math.max(1, Math.min(tasks.length, asArray(assessment.recommended_actions).length || 1));
  setHtml(
    "task-board",
    tasks
      .slice(0, visibleCount)
      .map(
        (task) => `
          <div class="task-row">
            <span>${esc(task.owner)}</span>
            <strong>${esc(task.text)}</strong>
            <em>${esc(task.due)}</em>
          </div>`,
      )
      .join(""),
  );
}

function renderManagementReport(data) {
  const assessment = data.assessment || {};
  const kpis = (data.route_intel && data.route_intel.kpis) || {};
  const demo = data.demo || {};
  setHtml(
    "management-report",
    `
      <article class="report-card">
        <header>
          <span>Supply Sentinel 自動生成</span>
          <strong>${esc(demo.time_label || formatDateTime(assessment.generated_at))}</strong>
        </header>
        <h4>ナフサ供給リスクにより、最短${esc(assessment.inventory_days_min ?? "-")}日で生産影響の可能性</h4>
        <dl>
          <div><dt>リスクスコア</dt><dd>${esc(assessment.risk_score)}/100</dd></div>
          <div><dt>影響調達額</dt><dd>${esc(compactUsdJa(kpis.monthly_spend_at_risk))}/月</dd></div>
          <div><dt>影響製品</dt><dd>${esc(asArray(assessment.impacted_products).join("、") || "なし")}</dd></div>
          <div><dt>一次判断</dt><dd>発注変更と顧客通知は人の承認後に実施</dd></div>
        </dl>
      </article>
    `,
  );
}

function renderMapLegend() {
  const swatches = [
    { label: "要対応", color: STATUS_COLORS.disrupted },
    { label: "代替可", color: STATUS_COLORS.resilient },
    { label: "通常", color: STATUS_COLORS.normal },
    { label: "自社工場", color: "#1297b8" },
  ];
  setHtml(
    "map-legend",
    swatches
      .map((s) => `<span class="legend-item"><span class="legend-swatch" style="background:${s.color};"></span>${esc(s.label)}</span>`)
      .join(""),
  );
}

export function renderPanels(data) {
  const model = data || {};
  const assessment = model.assessment || {};

  renderScenario(model);
  renderGeneratedAt(model);
  renderRiskGauge(model);
  renderKpiGrid(model);
  renderSourcingMix(model);
  renderOrdersTable(model);
  renderEventLog(model);
  renderInventoryRanking(model);
  renderAlternatives(model);
  renderTaskBoard(model);
  renderManagementReport(model);
  renderList("evidence-list", assessment.evidence, "検知根拠はありません。");
  renderList("actions-list", assessment.recommended_actions, "推奨初動はありません。");
  renderList("approval-list", assessment.approval_required, "承認が必要な事項はありません。");
  renderMapLegend();
}
