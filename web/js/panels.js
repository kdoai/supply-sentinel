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

const RISK_TYPE_LABELS = {
  allocation: "割当制限",
  supply_delay: "供給遅延",
  shutdown: "停止",
  logistics_delay: "物流遅延",
  price_spike: "価格急騰",
  unknown: "不明",
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

function riskTypeLabel(riskType) {
  return RISK_TYPE_LABELS[riskType] || riskType || "不明";
}

function affectedPeriodLabel(period) {
  if (!period) return "不明";
  const map = {
    "next two to three weeks": "今後2〜3週間",
    "next 2-3 weeks": "今後2〜3週間",
    "next 2 to 3 weeks": "今後2〜3週間",
    "next 1-2 weeks": "今後1〜2週間",
    "next two weeks": "今後2週間",
    "next 2 weeks": "今後2週間",
  };
  if (map[period]) return map[period];
  const range = String(period).match(/next\s+(\d+)\s*(?:-|to)\s*(\d+)\s*weeks?/i);
  if (range) return `今後${range[1]}〜${range[2]}週間`;
  const single = String(period).match(/next\s+(\d+)\s*weeks?/i);
  if (single) return `今後${single[1]}週間`;
  return period;
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
  if (String(text).startsWith("Temporary allocation control for naphtha-derived feedstock")) {
    return "ナフサ由来原料の出荷に一時的な割当制限が発生。";
  }
  if (String(text).startsWith("Confirmed shipments may be delayed by 5 to 7 days")) {
    return "確定済み出荷でも5〜7日の遅延可能性がある。";
  }
  if (String(text).startsWith("Allocation volume for the next two weeks")) {
    return "今後2週間の割当量が通常契約量の約70%に制限される可能性がある。";
  }
  return text;
}

function hasPublicUrl(source) {
  return /^https?:\/\//i.test(String(source?.url || ""));
}

function publicEvidenceSources(data) {
  return asArray(data?.provenance)
    .filter((source) => hasPublicUrl(source) && source.origin === "live_web")
    .sort((a, b) => Date.parse(b.published_at || b.fetched_at || 0) - Date.parse(a.published_at || a.fetched_at || 0));
}

function sourceKindLabel(kind) {
  const labels = {
    news: "ニュース",
    supplier: "サプライヤ通知",
    supplier_notice: "サプライヤ通知",
    logistics: "物流情報",
    price_feed: "価格情報",
  };
  return labels[kind] || kind || "情報源";
}

function scoreFactorLabel(key) {
  const labels = {
    external_event_severity: "外部イベント深刻度",
    supplier_notice_confidence: "サプライヤ通知の確度",
    inventory_days_risk: "在庫残日数リスク",
    customer_order_priority: "顧客・受注優先度",
    alternative_availability_risk: "代替材制約",
  };
  return labels[key] || key;
}

function cloudStoreLabel(store) {
  if (store === "cosmos") return "Cosmos DB";
  if (store === "static-json") return "静的JSON";
  if (store === "local") return "ローカル";
  return store || "不明";
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

function kpiCard(value, label, sub = "", atRisk = false, key = "") {
  return `
    <div class="kpi-card${atRisk ? " kpi-at-risk" : ""}"${key ? ` data-kpi="${esc(key)}"` : ""}>
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
  const material = materialLabel(assessment.material || kpis.focal_material || (data.risk_event || {}).material);

  setHtml(
    "kpi-grid",
    [
      kpiCard(`${kpis.affected_share_percent ?? 0}%`, "影響を受ける調達比率", `${material}調達量ベース`, (kpis.affected_routes ?? 0) > 0, "affected-share"),
      kpiCard(compactUsdJa(kpis.monthly_spend_at_risk), "影響を受ける月間調達額", `全体 ${compactUsdJa(kpis.total_monthly_spend)}`, Number(kpis.monthly_spend_at_risk || 0) > 0, "spend"),
      kpiCard(`${kpis.affected_routes ?? 0}/${kpis.total_routes ?? 0}`, "要対応ルート", "供給ルート数", (kpis.affected_routes ?? 0) > 0, "routes"),
      kpiCard(Number.isFinite(invDays) ? `${invDays}日` : "不明", "最短在庫残日数", "工場別在庫から算出", invDays <= 7, "inventory"),
      kpiCard(asArray(assessment.impacted_products).length, "影響製品", "BOM照合結果", false, "products"),
      kpiCard(asArray(assessment.impacted_customers).length, "影響顧客", "受注照合結果", false, "customers"),
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
        <div class="sourcing-row" data-route-id="${esc(route.route_id)}" role="button" tabindex="0" aria-label="${esc(route.origin)}の調達ルートを地図で表示">
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

function truncateText(value, max = 130) {
  const text = String(value ?? "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

function topPublicEvidence(data, limit = 3) {
  const live = publicEvidenceSources(data);
  if (live.length) return live.slice(0, limit);
  return asArray(data?.provenance)
    .filter((source) => hasPublicUrl(source))
    .sort((a, b) => Date.parse(b.published_at || b.fetched_at || 0) - Date.parse(a.published_at || a.fetched_at || 0))
    .slice(0, limit);
}

function renderSignalDecisionFlow(data) {
  const evidence = topPublicEvidence(data, 1)[0];
  const assessment = data.assessment || {};
  const risk = data.risk_event || {};
  const meta = data.meta || {};
  const collection = meta.evidence_collection || {};
  const health = collection.search_health || {};
  const kpis = data.route_intel?.kpis || {};
  const products = asArray(assessment.impacted_products);
  const actions = asArray(assessment.recommended_actions).map(translateText);
  const score = Number(assessment.risk_score);
  const scoreLabel = Number.isFinite(score) ? `${score}/100` : "判定中";
  const material = materialLabel(assessment.material || risk.material);
  const sourceLabel = evidence?.source_domain || evidence?.source || health.provider || collection.live_mode || "Web検索";
  const provider = health.provider || collection.live_mode || "search";
  const accepted = health.accepted_count ?? collection.live_count ?? 0;
  const runMode = meta.ai?.run_mode || "cloud";
  const model = meta.ai?.model || "gpt-5.4-mini";

  setHtml(
    "signal-decision-flow",
    `
      <div class="signal-flow-grid">
        <article class="signal-flow-card">
          <span>1. 市場シグナル</span>
          <strong>${esc(evidence?.title || evidence?.claim || `${material} 関連情報を監視中`)}</strong>
          <p>${esc(truncateText(evidence?.claim || "公開Web、ニュース、GDELT、内部通知を横断して供給制約の兆候を探索しています。", 120))}</p>
          ${evidence?.url ? `<a href="${esc(evidence.url)}" target="_blank" rel="noreferrer">${esc(sourceLabel)}を開く</a>` : `<em>${esc(sourceLabel)}</em>`}
        </article>
        <article class="signal-flow-card">
          <span>2. AI構造化</span>
          <strong>${esc(material)} / ${esc(riskTypeLabel(risk.risk_type))}</strong>
          <p>対象期間: ${esc(affectedPeriodLabel(risk.affected_period))}、確度: ${esc(risk.confidence || "判定中")}。検索採用 ${esc(accepted)}件。</p>
          <em>${esc(provider)} / ${esc(model)} / ${esc(runMode)}</em>
        </article>
        <article class="signal-flow-card">
          <span>3. 自社影響</span>
          <strong>リスク ${esc(scoreLabel)}</strong>
          <p>影響製品 ${products.length}件、最短在庫 ${esc(assessment.inventory_days_min ?? "-")}日、影響調達比率 ${esc(kpis.affected_share_percent ?? 0)}%。</p>
          <em>供給網・BOM・在庫を照合</em>
        </article>
        <article class="signal-flow-card signal-flow-next">
          <span>4. Next Action</span>
          <strong>${esc(actions[0] || "継続監視")}</strong>
          <p>${esc(actions[1] || "AIが起案し、発注変更・顧客通知・生産計画変更は人が承認します。")}</p>
          <em>Human-in-the-loop</em>
        </article>
      </div>
    `,
  );
}

// 初動対応の最初のパネル。AIが読んだ外部テキスト(meta.ai.inputs)と、
// そこから抽出した構造化結果(risk_event)を左右で対比し、下段に検知根拠を置く。
// meta.ai が無い段やナフサ以外の通常監視段では従来どおりの表示に縮退する。
function renderAiExtraction(data) {
  const container = $("ai-extraction");
  if (!container) return;

  const executiveAssessment = data.assessment || {};
  const executiveRisk = data.risk_event || {};
  const executiveMeta = data.meta || {};
  const executiveAi = executiveMeta.ai || {};
  const executiveCloud = executiveMeta.cloud || {};
  const executiveCollection = executiveMeta.evidence_collection || {};
  const executiveHealth = executiveCollection.search_health || {};
  const executiveSources = topPublicEvidence(data, 4);
  const executiveActions = asArray(executiveAssessment.recommended_actions).map(translateText);
  const executiveProducts = asArray(executiveAssessment.impacted_products);
  const executiveCustomers = asArray(executiveAssessment.impacted_customers);
  const executiveScore = Number(executiveAssessment.risk_score);
  const executiveSevere = Number.isFinite(executiveScore) && executiveScore >= 70;
  const executiveHeadline = executiveSevere
    ? "要注意: 外部シグナルが自社供給影響に接続しています"
    : "通常監視: 重大な初動判断はまだ不要です";
  const executiveRunMode = executiveAi.run_mode === "cloud" ? "cloud" : "demo";
  const executiveSearchLabel = executiveCollection.live_enabled === false
    ? "検索OFF"
    : `${executiveHealth.provider || executiveCollection.live_mode || "search"} / 採用 ${executiveHealth.accepted_count ?? executiveCollection.live_count ?? 0}件`;

  container.innerHTML = `
    <section class="executive-report ${executiveSevere ? "is-alert" : "is-watch"}">
      <div class="executive-report-head">
        <span>${esc(executiveAi.model_label || `Azure OpenAI · ${executiveAi.model || "gpt-5.4-mini"}`)} / ${esc(executiveRunMode)}</span>
        <strong>${esc(executiveHeadline)}</strong>
        <p>${esc(executiveRisk.summary || `${materialLabel(executiveRisk.material || executiveAssessment.material)}の公開情報と社内供給網を照合しました。`)}</p>
      </div>
      <div class="executive-report-kpis">
        <div><span>リスク</span><strong>${Number.isFinite(executiveScore) ? esc(executiveScore) : "-"}</strong><em>/100</em></div>
        <div><span>対象材料</span><strong>${esc(materialLabel(executiveRisk.material || executiveAssessment.material))}</strong><em>${esc(regionLabel(executiveRisk.region))}</em></div>
        <div><span>影響製品</span><strong>${esc(executiveProducts.length)}</strong><em>${esc(executiveProducts.slice(0, 2).join(" / ") || "なし")}</em></div>
        <div><span>最短在庫</span><strong>${esc(executiveAssessment.inventory_days_min ?? "-")}</strong><em>日</em></div>
      </div>
      <div class="executive-report-grid">
        <article>
          <h4>何が起きているか</h4>
          <p>${esc(`${materialLabel(executiveRisk.material || executiveAssessment.material)}について、${riskTypeLabel(executiveRisk.risk_type)}の兆候を検知。対象期間は${affectedPeriodLabel(executiveRisk.affected_period)}です。`)}</p>
        </article>
        <article>
          <h4>自社への意味</h4>
          <p>${esc(`影響顧客 ${executiveCustomers.length}社、影響製品 ${executiveProducts.length}件。AIは公開根拠と供給網の接続から、初動確認の必要性を判定しています。`)}</p>
        </article>
        <article>
          <h4>次に動くこと</h4>
          <ul>${(executiveActions.length ? executiveActions.slice(0, 3) : ["該当材料の公開根拠を継続監視", "サプライヤ通知が出た場合のみ初動確認"]).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
        </article>
        <article>
          <h4>実行証跡</h4>
          <dl>
            <div><dt>検索</dt><dd>${esc(executiveSearchLabel)}</dd></div>
            <div><dt>保存</dt><dd>${esc(cloudStoreLabel(executiveCloud.state_store))}${executiveCloud.persisted ? " 保存済み" : ""}</dd></div>
            <div><dt>実行ID</dt><dd>${esc(executiveAssessment.alert_id || data.agent_run?.run_id || "latest-dashboard")}</dd></div>
            <div><dt>実行時刻</dt><dd>${esc(formatDateTime(executiveCloud.served_at || executiveMeta.generated_at))}</dd></div>
          </dl>
        </article>
      </div>
      <div class="executive-evidence-strip">
        <span>判断根拠</span>
        ${
          executiveSources.length
            ? executiveSources
                .map((source) => `<a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(truncateText(source.title || source.claim || source.source, 52))}</a>`)
                .join("")
            : `<em>公開URL付き根拠を取得中です。検索OFFの場合はAI判断を採用しません。</em>`
        }
      </div>
    </section>
    <ul id="evidence-list" hidden></ul>`;
  return;

  const assessment = data.assessment || {};
  const risk = data.risk_event || {};
  const meta = data.meta || {};
  const ai = meta.ai || {};
  const cloud = meta.cloud || {};
  const inputs = asArray(ai.inputs);
  const evidence = asArray(assessment.evidence);

  // 通常監視中(ナフサ以外 / 要対応シグナルなし)は対比表示を出さない。
  const isNormalWatch =
    evidence.length === 0 ||
    Number(assessment.risk_score) < 50;

  if (isNormalWatch) {
    container.innerHTML = `
      <div class="ai-extract-empty">
        <strong>通常監視中 — 要対応シグナルなし</strong>
        <p>外部シグナルと社内データを照合中です。リスク抽出に至る入力が揃うと、ここに「入力 → 構造化」を表示します。</p>
      </div>
      <ul id="evidence-list" hidden></ul>`;
    return;
  }

  // meta.ai が未提供の段は、従来どおり検知根拠の箇条書きのみ(後方互換)。
  if (!inputs.length) {
    container.innerHTML = `
      <p class="ai-extract-note">外部情報から抽出した検知根拠です。</p>
      <ul id="evidence-list"></ul>`;
    return;
  }

  const runMode = ai.run_mode === "cloud" ? "cloud" : "demo";
  const runLabel = runMode === "cloud" ? "Azure OpenAI ライブ" : "デモ抽出(決定論)";
  const confidence = risk.confidence ? `確度 ${esc(risk.confidence)}` : "";
  // 調査エージェント(情報収集)の実行モードと検索クエリ。agent = モデルが
  // tool-calling でWeb検索を駆動、rss = 決定論の自動収集、disabled = オフ。
  const evidenceCol = meta.evidence_collection || {};
  const liveModeLabel =
    { agent: "AI調査エージェント (Web検索)", rss: "RSS自動収集", disabled: "オフ" }[evidenceCol.live_mode] ||
    (evidenceCol.live_enabled ? "RSS自動収集" : "オフ");
  const liveQueries = asArray(evidenceCol.live_queries).filter(Boolean);
  const liveCountText =
    evidenceCol.live_enabled && typeof evidenceCol.live_count === "number"
      ? ` / ${evidenceCol.live_count}件取得`
      : "";
  const cloudFacts = [
    { label: "実行モード", value: `${ai.provider || "Azure OpenAI"} / ${runMode}` },
    { label: "モデル", value: ai.model || "gpt-5.4-mini" },
    { label: "証拠収集", value: `${liveModeLabel}${liveCountText}` },
    { label: "Cloud API応答", value: cloud.served_at ? formatDateTime(cloud.served_at) : formatDateTime(meta.generated_at) },
    { label: "保存先", value: `${cloudStoreLabel(cloud.state_store)}${cloud.persisted ? " 保存済み" : " fallback"}` },
    { label: "実行ID", value: assessment.alert_id || "latest-dashboard" },
  ];

  const badges = `
    <div class="ai-extract-badges">
      <span class="ai-extract-model">${esc(ai.model_label || "Azure OpenAI · gpt-5.4-mini")}</span>
      <span class="ai-extract-mode ai-extract-mode-${runMode}">${esc(runLabel)}</span>
      <span class="ai-extract-store">${esc(cloud.persisted ? "Cosmos保存済み" : "静的fallback")}</span>
      ${confidence ? `<span class="ai-extract-confidence">${confidence}</span>` : ""}
    </div>`;

  const cloudPanel = `
    <div class="cloud-proof">
      <div>
        <span>Cloud実行証跡</span>
        <strong>${esc(ai.model_label || "Azure OpenAI · gpt-5.4-mini")} / ${esc(runMode)}</strong>
      </div>
      <dl>
        ${cloudFacts.map((item) => `<div><dt>${esc(item.label)}</dt><dd>${esc(item.value)}</dd></div>`).join("")}
      </dl>
      ${
        liveQueries.length
          ? `<div class="cloud-proof-queries"><span>調査エージェントの検索クエリ</span><div>${liveQueries
              .slice(0, 5)
              .map((q) => `<code>${esc(q)}</code>`)
              .join("")}</div></div>`
          : ""
      }
    </div>`;

  const inputCards = inputs
    .map((input) => {
      if (input.kind === "supplier") {
        return `
          <div class="ai-extract-card">
            <span class="ai-extract-kind ai-extract-kind-supplier">サプライヤ通知</span>
            <strong>${esc(input.supplier || "サプライヤ")}</strong>
            <p class="ai-extract-card-title">${esc(input.subject || "件名なし")}</p>
            <p class="ai-extract-card-body">${esc(truncateText(input.body, 150))}</p>
          </div>`;
      }
      return `
        <div class="ai-extract-card">
          <span class="ai-extract-kind ai-extract-kind-news">${esc(input.live ? "公開Web記事" : "業界ニュース")}</span>
          <strong>${esc(input.source || "ニュースソース")}</strong>
          <p class="ai-extract-card-title">${esc(input.headline || "見出しなし")}</p>
          <p class="ai-extract-card-body">${esc(truncateText(input.summary, 150))}</p>
          ${input.url ? `<a class="ai-extract-source-link" href="${esc(input.url)}" target="_blank" rel="noreferrer">記事URLを確認</a>` : ""}
        </div>`;
    })
    .join("");

  const severity = SEVERITY_LABELS[risk.severity] || risk.severity || "不明";
  const delay =
    risk.delay_days_min != null || risk.delay_days_max != null
      ? `${esc(risk.delay_days_min ?? "-")}-${esc(risk.delay_days_max ?? "-")}日`
      : "不明";
  const allocation = risk.allocation_rate_percent != null ? `${esc(risk.allocation_rate_percent)}%` : "-";

  const fields = `
    <dl class="ai-extract-fields">
      <div><dt>対象材料</dt><dd>${esc(materialLabel(risk.material))}</dd></div>
      <div><dt>リスク種別</dt><dd>${esc(riskTypeLabel(risk.risk_type))}</dd></div>
      <div><dt>深刻度</dt><dd class="ai-extract-sev">${esc(severity)}</dd></div>
      <div><dt>想定遅延</dt><dd>${delay}</dd></div>
      <div><dt>割当</dt><dd>${allocation}</dd></div>
      <div><dt>対象期間</dt><dd>${esc(affectedPeriodLabel(risk.affected_period))}</dd></div>
    </dl>`;

  const factors = Object.entries(assessment.scoring_factors || {});
  const factorRows = factors
    .map(([key, value]) => {
      const score = Math.max(0, Math.min(25, Number(value) || 0));
      return `
        <div class="factor-row">
          <span>${esc(scoreFactorLabel(key))}</span>
          <b>${esc(value)}</b>
          <em><i style="width:${score * 4}%"></i></em>
        </div>`;
    })
    .join("");

  const inventoryMin = assessment.inventory_days_min ?? "-";
  const affectedProducts = asArray(assessment.impacted_products);
  const affectedCustomers = asArray(assessment.impacted_customers);
  const kpis = ((data.route_intel || {}).kpis) || {};
  const businessTrace = `
    <div class="business-trace ai-trace-inline" aria-label="AI抽出から業務判断までの流れ">
      <div><span>1</span><strong>外部情報</strong><em>ニュース・通知 ${inputs.length}件</em></div>
      <div><span>2</span><strong>AI構造化</strong><em>${esc(materialLabel(risk.material))} / ${esc(riskTypeLabel(risk.risk_type))}</em></div>
      <div><span>3</span><strong>在庫/BOM照合</strong><em>最短 ${esc(inventoryMin)}日・製品 ${affectedProducts.length}件</em></div>
      <div><span>4</span><strong>初動案</strong><em>顧客 ${affectedCustomers.length}社・調達影響 ${esc(kpis.affected_share_percent ?? 0)}%</em></div>
    </div>`;

  const judgment = `
    <div class="judgment-proof">
      <section>
        <h4>スコア判断根拠</h4>
        <div class="factor-list">${factorRows || `<p class="empty">スコア内訳はありません。</p>`}</div>
      </section>
    </div>`;

  container.innerHTML = `
    ${badges}
    ${cloudPanel}
    ${businessTrace}
    <div class="ai-extract-flow">
      <section class="ai-extract-col ai-extract-col-input">
        <h4>AIが読んだ外部テキスト</h4>
        <div class="ai-extract-cards">${inputCards}</div>
      </section>
      <div class="ai-extract-arrow" aria-hidden="true">→</div>
      <section class="ai-extract-col ai-extract-col-output">
        <h4>構造化された抽出結果</h4>
        ${fields}
      </section>
    </div>
    ${judgment}
    <div class="ai-extract-evidence">
      <span class="ai-extract-evidence-head">検知根拠</span>
      <ul id="evidence-list"></ul>
    </div>`;
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
              <em>${esc(source.status || "監視中")} / ${esc(source.freshness || "鮮度不明")} / 確度 ${esc(source.confidence || "-")}</em>
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

function renderLiveEvidenceList(data) {
  const sources = publicEvidenceSources(data).slice(0, 5);
  const collection = data?.meta?.evidence_collection || {};
  const health = collection.search_health || {};
  const healthHtml = renderSearchHealth(collection, health);
  const html = sources.length
    ? healthHtml + sources
        .map((source) => `
          <article class="live-evidence-card">
            <div>
              <span>${esc(sourceKindLabel(source.kind))}</span>
              <time>${esc(formatDateTime(source.published_at || source.fetched_at))}</time>
            </div>
            <strong>${esc(source.source || "公開Web")}</strong>
            <p>${esc(truncateText(source.claim, 92))}</p>
            <a href="${esc(source.url)}" target="_blank" rel="noreferrer">根拠URL</a>
          </article>`)
        .join("")
    : healthHtml + `
      <div class="live-evidence-empty">
        <strong>${collection.live_enabled === false ? "ライブ検索はOFFです" : "公開URL付き根拠を取得中"}</strong>
        <p>${collection.live_enabled === false ? "この実行ではWeb検索を行っていません。Cloud環境で SUPPLY_SENTINEL_LIVE_EVIDENCE=true にすると、検索結果だけを根拠として保存します。" : "架空ソースは根拠にしません。Hosted Web Search / Google News / GDELT から取得した公開記事だけを表示します。"}</p>
      </div>`;
  setHtml("live-evidence-list", html);
}

function renderSearchHealth(collection, health) {
  const provider = health.provider || collection.live_mode || "unknown";
  const errors = asArray(health.errors || collection.live_errors);
  const queries = asArray(collection.live_queries || health.queries).slice(0, 3);
  return `
    <div class="search-health-card">
      <div>
        <span>検索ヘルス</span>
        <strong>${esc(provider)}</strong>
      </div>
      <dl>
        <div><dt>取得</dt><dd>${esc(health.retrieved_count ?? collection.live_count ?? 0)}</dd></div>
        <div><dt>採用</dt><dd>${esc(health.accepted_count ?? collection.live_count ?? 0)}</dd></div>
        <div><dt>除外</dt><dd>${esc(health.rejected_count ?? 0)}</dd></div>
        <div><dt>エラー</dt><dd>${esc(health.error_count ?? errors.length)}</dd></div>
      </dl>
      ${queries.length ? `<p>${queries.map((q) => `<code>${esc(q)}</code>`).join("")}</p>` : ""}
      ${errors.length ? `<em>${esc(errors[0].source || errors[0].provider || "search")}: ${esc(errors[0].message || "検索エラー")}</em>` : ""}
    </div>`;
}

function renderAgentActivityLog(data) {
  const run = data.agent_run || {};
  const calls = asArray(run.tool_calls).slice(0, 8);
  const html = `
    <div class="agent-log-head">
      <strong>${esc(run.run_id || "run pending")}</strong>
      <span>${esc(run.model || "gpt-5.4-mini")} / ${esc(run.run_mode || "cloud")}</span>
    </div>
    <ol class="agent-log-list">
      ${
        calls.length
          ? calls
              .map((call) => `
                <li class="${call.ok === false ? "is-error" : ""}">
                  <time>${esc(call.ts || "--:--")}</time>
                  <div>
                    <strong>${esc(call.agent || "agent")} · ${esc(call.tool || "tool")}</strong>
                    <p>${esc(call.result || "")}</p>
                  </div>
                </li>`)
              .join("")
          : `<li><time>--:--</time><div><strong>待機中</strong><p>巡回が始まると、検索・検証・照合・起案のログを表示します。</p></div></li>`
      }
    </ol>`;
  setHtml("agent-activity-log", html);
}

function productImpactRows(data) {
  const assessment = data.assessment || {};
  const kpis = data.route_intel?.kpis || {};
  const orders = asArray(assessment.impacted_orders);
  const products = asArray(assessment.impacted_products);
  const inventoryMin = assessment.inventory_days_min ?? "-";
  const evidence = publicEvidenceSources(data)[0] || asArray(data.provenance).find(hasPublicUrl) || null;
  return products.map((product, index) => {
    const relatedOrders = orders.filter((order) => order.product === product);
    const topOrder = relatedOrders[0] || {};
    const priority = relatedOrders.some((order) => String(order.priority).toLowerCase() === "high")
      ? "high"
      : relatedOrders.length
        ? "medium"
        : "low";
    const score = Math.max(1, Math.round((Number(assessment.risk_score) || 0) - index * 8));
    return {
      rank: index + 1,
      product,
      score,
      priority,
      customer: topOrder.customer || asArray(assessment.impacted_customers)[index] || "対象顧客確認中",
      plant: topOrder.plant || asArray(assessment.impacted_plants)[0] || "対象工場確認中",
      orders: relatedOrders.length,
      inventory: inventoryMin,
      impact: index === 0 ? "最優先保護" : priority === "high" ? "配分候補" : "監視継続",
      reason: `調達影響${kpis.affected_share_percent ?? 0}%・最短在庫${inventoryMin}日。公開根拠とBOM/受注を照合。`,
      evidence,
    };
  });
}

function renderProductImpactRanking(data) {
  const rows = productImpactRows(data);
  const html = rows.length
    ? `
      <div class="product-ranking-list">
        ${rows
          .map((row) => `
            <article class="product-rank-card priority-${esc(row.priority)}">
              <div class="product-rank-main">
                <span class="product-rank-no">#${esc(row.rank)}</span>
                <div>
                  <strong>${esc(row.product)}</strong>
                  <p>${esc(row.reason)}</p>
                </div>
                <b>${esc(row.score)}</b>
              </div>
              <dl>
                <div><dt>判断</dt><dd>${esc(row.impact)}</dd></div>
                <div><dt>顧客</dt><dd>${esc(row.customer)}</dd></div>
                <div><dt>工場</dt><dd>${esc(row.plant)}</dd></div>
                <div><dt>在庫</dt><dd>${esc(row.inventory)}日</dd></div>
              </dl>
              ${
                row.evidence?.url
                  ? `<a href="${esc(row.evidence.url)}" target="_blank" rel="noreferrer">根拠: ${esc(row.evidence.source || "公開記事")}</a>`
                  : `<span class="product-rank-no-evidence">公開URL付き根拠なし</span>`
              }
            </article>`)
          .join("")}
      </div>`
    : `<p class="empty">影響製品はありません。</p>`;
  setHtml("product-impact-ranking", html);
}

function renderScenarioSettings(data) {
  const assessment = data.assessment || {};
  const meta = data.meta || {};
  const collection = meta.evidence_collection || {};
  const materials = asArray(meta.materials);
  const material = assessment.material || "naphtha";
  const materialOptions = materials.length
    ? materials.map((item) => ({
        id: item.material_id || item.id || item.material || item.name,
        label: item.display_name || item.label || materialLabel(item.material_id || item.id || item.material || item.name),
      })).filter((item) => item.id)
    : ["naphtha", "packaging-film", "semiconductor-adhesive"];
  const queries = asArray(collection.live_queries).slice(0, 4);
  setHtml(
    "scenario-settings",
    `
      <div class="scenario-form-grid">
        <label><span>監視対象</span><select>${materialOptions
          .map((item) => {
            const option = typeof item === "string" ? { id: item, label: materialLabel(item) } : item;
            return `<option ${option.id === material ? "selected" : ""}>${esc(option.label)}</option>`;
          })
          .join("")}</select></label>
        <label><span>調査スパン</span><select><option selected>6時間ごと</option><option>12時間ごと</option><option>手動のみ</option></select></label>
        <label><span>検索範囲</span><select><option selected>過去30日</option><option>過去7日</option><option>過去90日</option></select></label>
        <label><span>起案しきい値</span><input type="number" min="0" max="100" value="70"></label>
      </div>
      <div class="scenario-query-box">
        <span>現在の調査クエリ</span>
        <div>${queries.length ? queries.map((query) => `<code>${esc(query)}</code>`).join("") : `<em>Cloud巡回時に生成</em>`}</div>
      </div>
      <p class="scenario-setting-note">この画面はデモ用の運用設定です。Cloud本番では Container Apps Job のスケジュールと環境変数に反映する想定です。</p>
    `,
  );
  setHtml(
    "evidence-rules",
    `
      <div class="evidence-rule-list">
        <article class="evidence-rule is-accepted">
          <strong>採用</strong>
          <p>公開URL・媒体名・公開/取得時刻があり、AIが根拠URLを返した記事。</p>
        </article>
        <article class="evidence-rule is-rejected">
          <strong>不採用</strong>
          <p>URLがない情報、架空/サンプルソース、AIが生成しただけの根拠、命令文を含む外部テキスト。</p>
        </article>
        <article class="evidence-rule">
          <strong>保存</strong>
          <p>採用根拠、AI抽出結果、BOM/在庫照合、run_id、承認状態を Cosmos DB に保存。</p>
        </article>
      </div>
    `,
  );
}

function renderTaskBoard(data) {
  const assessment = data.assessment || {};
  const kpis = (data.route_intel && data.route_intel.kpis) || {};
  const hasImpact = Number(kpis.affected_routes || 0) > 0 || asArray(assessment.recommended_actions).length > 0;

  if (!hasImpact) {
    setHtml(
      "task-board",
      `
        <div class="op-board-head">
          <span>初動タスク</span>
          <span class="op-head-meta op-head-ok">通常監視</span>
        </div>
        <div class="op-task">
          <span class="op-owner">監視</span>
          <div class="op-body">
            <strong>外部シグナルと社内データの定期照合を継続</strong>
            <span class="op-meta">Supply Sentinel · 自動巡回</span>
          </div>
          <span class="op-status op-ok">監視中</span>
        </div>`,
    );
    return;
  }

  const invDays = assessment.inventory_days_min ?? "-";
  const tasks = [
    { owner: "調達", team: "樹脂調達G", text: "サプライヤへ割当数量と出荷予定を確認", due: "本日 17:00", status: "進行中", cls: "op-progress" },
    { owner: "生産管理", team: "千葉工場", text: `${invDays}日以内に影響する生産計画を確認`, due: "24時間以内", status: "着手待ち", cls: "op-wait" },
    { owner: "品質保証", team: "材料認定", text: "NAP-ALT-01 の適用品目と品質条件を確認", due: "24時間以内", status: "着手待ち", cls: "op-wait" },
    { owner: "営業", team: "重点顧客担当", text: "高優先度顧客向けの一次説明文案を準備", due: "承認後", status: "承認後実行", cls: "op-hold" },
  ];
  const visibleCount = Math.max(1, Math.min(tasks.length, asArray(assessment.recommended_actions).length || 1));
  const shown = tasks.slice(0, visibleCount);
  const waitingApproval = shown.filter((task) => task.cls === "op-hold").length;

  const head = `
    <div class="op-board-head">
      <span>初動タスク ${shown.length}件</span>
      <span class="op-head-meta">人の判断待ち ${waitingApproval}件</span>
    </div>`;
  const rows = shown
    .map(
      (task) => `
        <div class="op-task">
          <span class="op-owner">${esc(task.owner)}</span>
          <div class="op-body">
            <strong>${esc(task.text)}</strong>
            <span class="op-meta">${esc(task.team)} · 期限 ${esc(task.due)}</span>
          </div>
          <span class="op-status ${task.cls}">${esc(task.status)}</span>
        </div>`,
    )
    .join("");
  setHtml("task-board", head + rows);
}

const APPROVAL_META = new Map([
  ["Purchase order changes", { approver: "調達部長", impact: (ctx) => `影響調達 ${ctx.share}%・月${ctx.spend} の再配分。誤発注は契約上のペナルティに直結。` }],
  ["Supplier switching", { approver: "調達部長 / 品質保証", impact: () => "代替材 NAP-ALT-01 の適用範囲拡大。品質条件の確認が前提。" }],
  ["Formal customer notification", { approver: "営業部長", impact: () => "影響顧客3社への納期・代替案の正式連絡。対外コミュニケーション。" }],
  ["Major production plan changes", { approver: "生産管理責任者", impact: () => "千葉・大阪工場の生産順序・配分の変更。" }],
]);

function renderApprovals(data) {
  const items = asArray((data.assessment || {}).approval_required);
  const kpis = (data.route_intel && data.route_intel.kpis) || {};
  const ctx = {
    share: kpis.affected_share_percent ?? 0,
    spend: compactUsdJa(kpis.monthly_spend_at_risk),
  };

  if (!items.length) {
    setHtml("approval-list", `<li class="approval-empty">承認が必要な事項はありません。</li>`);
    return;
  }

  const lead = `<li class="approval-lead">Supply Sentinel が判断材料を整理。ここでは実行ボタンを置かず、発注変更・サプライヤ切替・顧客通知は既存の承認プロセスに渡します。</li>`;
  const cards = items
    .map((raw) => {
      const meta = APPROVAL_META.get(raw) || { approver: "担当責任者", impact: () => "" };
      const label = translateText(raw);
      const impact = meta.impact(ctx);
      return `
        <li class="approval-card">
          <div class="approval-main">
            <strong>${esc(label)}</strong>
            <span>承認者: ${esc(meta.approver)}</span>
          </div>
          ${impact ? `<p class="approval-why">${esc(impact)}</p>` : ""}
          <span class="approval-status">人の判断待ち</span>
        </li>`;
    })
    .join("");
  setHtml("approval-list", lead + cards);
}

function renderManagementReport(data) {
  const assessment = data.assessment || {};
  const kpis = (data.route_intel && data.route_intel.kpis) || {};
  const demo = data.demo || {};
  const material = materialLabel(assessment.material || kpis.focal_material || (data.risk_event || {}).material);
  const hasImpact = Number(kpis.affected_routes || 0) > 0;
  setHtml(
    "management-report",
    `
      <article class="report-card">
        <header>
          <span>Supply Sentinel 自動生成</span>
          <strong>${esc(demo.time_label || formatDateTime(assessment.generated_at))}</strong>
        </header>
        <h4>${esc(material)}供給リスク: ${hasImpact ? `最短${esc(assessment.inventory_days_min ?? "-")}日で生産影響の可能性` : "現時点で要対応シグナルなし"}</h4>
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
  renderSignalDecisionFlow(model);
  renderRiskGauge(model);
  renderKpiGrid(model);
  renderSourcingMix(model);
  renderOrdersTable(model);
  renderEventLog(model);
  renderInventoryRanking(model);
  renderAlternatives(model);
  renderLiveEvidenceList(model);
  renderAgentActivityLog(model);
  renderProductImpactRanking(model);
  renderScenarioSettings(model);
  renderTaskBoard(model);
  renderApprovals(model);
  renderManagementReport(model);
  renderAiExtraction(model);
  renderList("evidence-list", assessment.evidence, "検知根拠はありません。");
  renderList("actions-list", assessment.recommended_actions, "推奨初動はありません。");
  renderMapLegend();
}
