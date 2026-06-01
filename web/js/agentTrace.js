// agentTrace.js — browser mirror of src/supply_sentinel/agentTrace.mjs.
//
// Kept behaviourally identical to the Node generator so the timeline can
// regenerate the same `agent_run` per month in the browser. Pure function of
// the model: no network, no Date.now, no randomness. See the .mjs for the
// design notes and the contract in data/agents/agent_trace_schema.md.

export const AGENT_ROSTER = [
  { key: "orchestrator", name: "Sentinel Orchestrator", role: "巡回の親エージェント。各エージェントへ順にタスクを割り当て、状態と失敗時fallbackを管理する。", processor: "orchestrator" },
  { key: "risk_scout", name: "Risk Scout", role: "ニュース・サプライヤ通知・物流・価格を読み、供給リスク候補を構造化する。", processor: "azure-openai" },
  { key: "evidence_verifier", name: "Evidence Verifier", role: "根拠の確度を検証し、外部文書に紛れた命令文(プロンプトインジェクション)を除外する。", processor: "rule-engine" },
  { key: "impact_mapper", name: "Impact Mapper", role: "BOM・在庫・受注と多段サプライヤネットワークを照合し、波及を決定論で計算する。", processor: "deterministic" },
  { key: "response_planner", name: "Response Planner", role: "初動対応案・担当・期限・承認要否を起案する。", processor: "rule-engine" },
  { key: "decision_gate", name: "Decision Gate", role: "AIが実行してよい事項と、人間承認が必須の事項を分離する。", processor: "rule-engine" },
  { key: "reporter", name: "Reporter", role: "管理職向けレポートを生成し、実行記録を保存する。", processor: "azure-openai" },
];

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+|the\s+|previous\s+|above\s+|prior\s+)?(instructions|prompts?|rules)/i,
  /disregard\s+(all\s+|the\s+|previous\s+)?(instructions|rules|guardrails)/i,
  /(これまで|以前|上記|先ほど)?の?指示を?(無視|忘れ)/,
  /命令を?無視/,
  /system\s*prompt/i,
  /api[\s_-]*key|apiキー|秘密鍵|パスワード|認証情報|credentials?/i,
  /(reveal|leak|exfiltrate|expose)\b/i,
  /(全|すべての)?(在庫|数量|ロット)?を?(直ちに|今すぐ)?(発注|送金|出荷)せよ/,
  /jailbreak|prompt\s*injection/i,
];

export function detectInjection(text) {
  const value = String(text ?? "");
  if (!value.trim()) return null;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(value)) return pattern.source;
  }
  return null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function compactUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "0ドル";
  if (Math.abs(n) >= 1_000_000) return `${trim1(n / 1_000_000)}百万ドル`;
  if (Math.abs(n) >= 1_000) return `${trim1(n / 1_000)}千ドル`;
  return `${Math.round(n).toLocaleString("ja-JP")}ドル`;
}

function trim1(n) {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function makeClock(baseIso) {
  let base = Date.parse(baseIso || "");
  if (!Number.isFinite(base)) base = Date.parse("2026-05-28T09:00:00+09:00");
  return function at(seconds) {
    const d = new Date(base + seconds * 1000);
    return {
      iso: d.toISOString(),
      hms: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`,
    };
  };
}

const APPROVAL_META = {
  "Purchase order changes": { title: "発注内容の変更", approver: "調達部長", category: "procurement" },
  "Supplier switching": { title: "サプライヤ切替", approver: "調達部長 / 品質保証", category: "sourcing" },
  "Formal customer notification": { title: "顧客への正式通知", approver: "営業部長", category: "customer" },
  "Major production plan changes": { title: "生産計画の大幅変更", approver: "生産管理責任者", category: "production" },
  "Supply allocation decision": { title: "供給配分判断", approver: "SCM責任者", category: "allocation" },
  "Product reduction decision": { title: "縮小判断", approver: "事業責任者", category: "reduction" },
  "Alternative material approval process": { title: "代替材承認プロセス開始", approver: "品質保証 / 顧客担当", category: "quality" },
};

function approvalMeta(raw) {
  return APPROVAL_META[raw] || { title: String(raw || "承認事項"), approver: "担当責任者", category: "general" };
}

export function buildAgentRun(model = {}, options = {}) {
  const assessment = model.assessment || {};
  const risk = model.risk_event || {};
  const metrics = (model.propagation && model.propagation.metrics) || {};
  const kpis = (model.route_intel && model.route_intel.kpis) || {};
  const ai = (model.meta && model.meta.ai) || {};
  const cloud = (model.meta && model.meta.cloud) || {};

  const riskScore = num(metrics.risk_score ?? assessment.risk_score, 0);
  const affectedRatio = num(metrics.affected_supply_ratio ?? kpis.affected_share_percent, 0);
  const spendAtRisk = num(metrics.spend_at_risk_usd ?? kpis.monthly_spend_at_risk, 0);
  const inventoryDays = metrics.inventory_days_min ?? assessment.inventory_days_min ?? null;

  const material = assessment.material || risk.material || (model.meta && model.meta.scenario) || "monitored material";
  const riskType = risk.risk_type || "supply_delay";
  const severity = metrics.severity || assessment.severity || risk.severity || "low";
  const confidence = risk.confidence || (model.month && model.month.risk_inputs && model.month.risk_inputs.confidence) || "medium";
  const allocation = risk.allocation_rate_percent;

  const provenance = asArray(model.provenance);
  const products = asArray(metrics.impacted_products ?? assessment.impacted_products);
  const customers = asArray(metrics.impacted_customers ?? assessment.impacted_customers);
  const orders = asArray(metrics.impacted_orders ?? assessment.impacted_orders);
  const plants = asArray(assessment.impacted_plants);
  const actions = asArray(assessment.recommended_actions);
  const approvals = asArray(assessment.approval_required);

  const hasImpact = riskScore >= 45 || approvals.length > 0 || affectedRatio > 0;

  const blockedEvidence = [];
  let scannedCount = 0;
  for (const source of provenance) {
    const candidates = [source.claim, source.raw_excerpt, source.note].filter(Boolean);
    scannedCount += candidates.length || 1;
    for (const text of candidates) {
      const hit = detectInjection(text);
      if (hit) {
        blockedEvidence.push({
          source: source.label || source.source || source.id || "外部ソース",
          kind: source.kind || "news",
          text: String(text),
          reason: "外部文書に含まれる命令文を検知。観測データとしてのみ扱い、指示としては実行しません。",
        });
        break;
      }
    }
  }
  const verifiedCount = Math.max(0, provenance.length - blockedEvidence.length);

  const monthKey = (model.month && model.month.month) || options.month || "current";
  const scenarioKey = (model.meta && model.meta.scenario) || assessment.alert_id || material;
  const runId = options.run_id || `run-${slug(scenarioKey)}-${slug(monthKey)}`;
  const runMode = ai.run_mode === "cloud" ? "cloud" : "demo";
  const modelName = ai.model || "gpt-5.4-mini";
  const persisted = Boolean(cloud.persisted);
  const clock = makeClock((model.meta && model.meta.generated_at) || options.now);

  const toolCalls = [];
  let t = 0;
  const tool = (agent, name, result, ok = true) => {
    const stamp = clock(t);
    toolCalls.push({ ts: stamp.hms, iso: stamp.iso, agent, tool: name, result, ok });
    t += 2;
  };

  tool("orchestrator", "start_run", `run_id ${runId} を開始 / 7エージェントを巡回`);
  tool("risk_scout", "fetch_signals", `${provenance.length}件の外部シグナルを取得`);
  tool("risk_scout", "azure_openai.extract", hasImpact
    ? `${material} / ${labelRiskType(riskType)} / 深刻度 ${severity}`
    : `${material} / 要対応シグナルなし`);
  tool("evidence_verifier", "verify_evidence", `確度 ${confidence} / 検証 ${verifiedCount}件`);
  tool("evidence_verifier", "detect_injection", blockedEvidence.length
    ? `命令文を ${blockedEvidence.length}件検出し除外`
    : "命令文なし(injection検知=0)", blockedEvidence.length === 0);
  tool("impact_mapper", "query_inventory", inventoryDays != null ? `最短在庫 ${inventoryDays}日` : "在庫影響なし");
  tool("impact_mapper", "map_bom_orders", `製品 ${products.length}件・顧客 ${customers.length}社・受注 ${orders.length}件`);
  tool("impact_mapper", "propagate_network", hasImpact
    ? `波及 ${affectedRatio}% / ${compactUsd(spendAtRisk)}`
    : "波及なし(0%)");
  tool("response_planner", "draft_actions", hasImpact ? `初動 ${actions.length}件を起案` : "起案不要");
  tool("decision_gate", "split_authority", `人間承認 ${approvals.length}件 / AI実行 ${hasImpact ? 2 : 0}件`);
  tool("reporter", "generate_report", "管理職レポートを生成");
  tool("reporter", "save_state", persisted ? `Cosmos DB に保存 (${runId})` : `ローカル保存 (${runId})`, true);

  const endStamp = clock(t);

  function agentRecord(spec, startSec, endSec, input, output, extra = {}) {
    const start = clock(startSec);
    const end = clock(endSec);
    const usesCloud = spec.processor === "azure-openai" && runMode === "cloud";
    return {
      key: spec.key,
      name: spec.name,
      role: spec.role,
      status: "completed",
      processor: spec.processor === "azure-openai" ? (usesCloud ? "azure-openai" : "deterministic-mock") : spec.processor,
      processor_label: processorLabel(spec.processor, usesCloud, modelName),
      started_at: start.iso,
      completed_at: end.iso,
      started_hms: start.hms,
      completed_hms: end.hms,
      input,
      output,
      tools: toolCalls.filter((c) => c.agent === spec.key).map((c) => c.tool),
      ...extra,
    };
  }

  const agents = [
    agentRecord(AGENT_ROSTER[0], 0, t, `シナリオ「${scenarioKey}」/ ${monthKey} / 外部シグナル ${provenance.length}件`, `7エージェントの巡回を実行 (run_id ${runId})`),
    agentRecord(AGENT_ROSTER[1], 1, 5, `ニュース・通知・物流・価格 ${provenance.length}件`, hasImpact
      ? `${labelRiskType(riskType)}を抽出: ${material} / 深刻度 ${severity} / 確度 ${confidence}${allocation != null ? ` / 割当 ${allocation}%` : ""}`
      : `${material}は通常範囲。要対応シグナルなし`, { evidence: provenance.map((p) => ({ kind: p.kind, claim: p.claim, source: p.source })) }),
    agentRecord(AGENT_ROSTER[2], 5, 9, `抽出根拠 ${provenance.length}件 + 生テキスト走査`, blockedEvidence.length
      ? `確度 ${confidence}。命令文 ${blockedEvidence.length}件を除外、有効根拠 ${verifiedCount}件`
      : `確度 ${confidence}。命令文なし、有効根拠 ${verifiedCount}件`, { blocked_evidence: blockedEvidence }),
    agentRecord(AGENT_ROSTER[3], 9, 15, "在庫 / BOM / 受注 / 多段ネットワーク", hasImpact
      ? `製品 ${products.length}件・顧客 ${customers.length}社・最短在庫 ${inventoryDays ?? "-"}日・調達影響 ${affectedRatio}% (${compactUsd(spendAtRisk)})`
      : "自社製品・顧客への波及なし", { impacted_products: products, impacted_customers: customers, impacted_plants: plants }),
    agentRecord(AGENT_ROSTER[4], 15, 19, hasImpact ? `影響範囲(製品${products.length}/顧客${customers.length})` : "通常監視", hasImpact
      ? `初動 ${actions.length}件・要承認 ${approvals.length}件を起案`
      : "定期照合を継続(初動不要)", { recommended_actions: actions }),
    null,
    agentRecord(AGENT_ROSTER[6], 19, t, "確定影響 + 起案", persisted ? "管理職レポートを生成し Cosmos DB に保存" : "管理職レポートを生成(ローカル保存)"),
  ];

  const decisions = [];
  for (const raw of approvals) {
    const meta = approvalMeta(raw);
    decisions.push({
      id: `${runId}__${slug(meta.category)}__${slug(raw)}`,
      title: meta.title,
      category: meta.category,
      approver: meta.approver,
      requires_human: true,
      default_state: "pending",
      ai_recommendation: "起案済み。人の承認後に実務アクションへ進みます。",
      raw,
    });
  }
  const autoDecisions = hasImpact
    ? [
        { id: `${runId}__auto__inventory-hold`, title: "高優先度受注向けに在庫引当ドラフトを作成", category: "inventory", approver: "—", requires_human: false, default_state: "auto", ai_recommendation: "AIがドラフトを自動作成。確定はしません。", raw: null },
        { id: `${runId}__auto__customer-draft`, title: "影響顧客向けの説明文案を作成", category: "customer", approver: "—", requires_human: false, default_state: "auto", ai_recommendation: "AIが文案を自動作成。送信は営業承認後。", raw: null },
      ]
    : [];
  const allDecisions = [...decisions, ...autoDecisions];

  agents[5] = agentRecord(AGENT_ROSTER[5], 15, 19, hasImpact ? `起案 ${actions.length}件` : "通常監視", hasImpact
    ? `AI実行可 ${autoDecisions.length}件 / 人間承認必須 ${decisions.length}件に振り分け`
    : "実行・承認とも不要", { decisions: allDecisions });

  return {
    run_id: runId,
    status: "completed",
    current_step: null,
    run_mode: runMode,
    model: modelName,
    provider: ai.provider || "Azure OpenAI",
    persisted,
    started_at: clock(0).iso,
    completed_at: endStamp.iso,
    headline: {
      risk_score: riskScore,
      severity,
      affected_supply_ratio: affectedRatio,
      spend_at_risk_usd: spendAtRisk,
      inventory_days_min: inventoryDays,
    },
    agents,
    tool_calls: toolCalls,
    decisions: allDecisions,
    blocked_evidence: blockedEvidence,
    stats: {
      agent_count: agents.length,
      tool_call_count: toolCalls.length,
      evidence_scanned: scannedCount,
      evidence_verified: verifiedCount,
      evidence_blocked: blockedEvidence.length,
      human_approvals: decisions.length,
      ai_auto_actions: autoDecisions.length,
    },
  };
}

function processorLabel(processor, usesCloud, modelName) {
  if (processor === "azure-openai") return usesCloud ? `Azure OpenAI · ${modelName}` : `決定論モック(${modelName}相当)`;
  if (processor === "rule-engine") return "ルールエンジン";
  if (processor === "deterministic") return "決定論エンジン(propagationEngine)";
  if (processor === "orchestrator") return "オーケストレータ";
  return processor;
}

function labelRiskType(riskType) {
  const labels = {
    allocation: "割当制限",
    supply_delay: "供給遅延",
    shutdown: "停止",
    logistics_delay: "物流遅延",
    price_spike: "価格急騰",
    unknown: "不明",
  };
  return labels[riskType] || riskType || "供給リスク";
}

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9一-龯ぁ-んァ-ン]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "x";
}
