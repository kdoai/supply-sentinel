import path from "node:path";
import { loadSampleData } from "./ingestion.mjs";
import { extractRiskEvent } from "./aiClient.mjs";
import { assessImpact } from "./impactEngine.mjs";
import { buildRouteIntelligence } from "./routeEngine.mjs";
import { writeTeamsAlert } from "./alertWriter.mjs";
import { writeManagementReport } from "./reportWriter.mjs";
import { writeDashboardHtml } from "./dashboardWriter.mjs";
import { createStateStore } from "./stateStore.mjs";
import { resolveRunMode, azureOpenAiConfig, azureOpenAiConfigured } from "./config.mjs";

export async function runSupplySentinel({
  rootDir = process.cwd(),
  outputDir = path.join(rootDir, "outputs", "latest"),
  stateStore,
} = {}) {
  const data = await loadSampleData(rootDir);
  const riskEvent = await extractRiskEvent(data);
  const assessment = assessImpact(riskEvent, data);
  const routeIntel = buildRouteIntelligence(riskEvent, data);
  const teamsAlert = writeTeamsAlert(assessment);
  const managementReport = writeManagementReport(assessment);
  const dashboardHtml = writeDashboardHtml(assessment);
  const dashboardData = buildDashboardModel({ riskEvent, assessment, routeIntel, materials: data.materials, data });
  const store = stateStore || createStateStore({ outputDir });

  await store.saveRun({
    riskEvent,
    assessment,
    teamsAlert,
    managementReport,
    dashboardHtml,
    dashboardData,
  });

  return {
    riskEvent,
    assessment,
    routeIntel,
    teamsAlert,
    managementReport,
    dashboardHtml,
    dashboardData,
    outputDir,
  };
}

// Consolidated model consumed by the interactive map dashboard (web/).
// `data` (loadSampleData() の戻り値) を受け取り、AIへの入力テキスト(meta.ai.inputs)を
// 構築する。後方互換: data 省略時は meta.ai.inputs が空配列になるだけで既存挙動は不変。
export function buildDashboardModel({ riskEvent, assessment, routeIntel, materials = [], data = {} }) {
  return {
    meta: {
      app: "Supply Sentinel",
      scenario: `${riskEvent.material} supply risk`,
      generated_at: assessment.generated_at,
      // Material master enables data-driven multi-material monitoring (docs/13 §4.1, §10).
      materials,
      // AI抽出の入出力対比メタ。フロントは inputs(生テキスト)と risk_event(構造化出力)を
      // 左右で対比表示する(docs/13 §4)。
      ai: buildAiMeta(data),
    },
    risk_event: riskEvent,
    assessment,
    route_intel: routeIntel,
  };
}

// AIが読んだ生テキスト(入力)と実行モードを meta.ai として組み立てる。
// run_mode は config の resolveRunMode() を尊重しつつ、Azure資格情報が無ければ "demo" に落とす
// (ネットワークは呼ばない。aiClient の cloud 分岐と同じ条件を二重化しないよう判定を共有)。
function buildAiMeta(data = {}) {
  const config = azureOpenAiConfig();
  const requestedMode = resolveRunMode();
  const isCloud = (requestedMode === "azure" || requestedMode === "cloud") && azureOpenAiConfigured();
  const run_mode = isCloud ? "cloud" : "demo";

  return {
    run_mode,
    model: config.deployment,
    subagent_model: config.subagentDeployment,
    provider: "Azure OpenAI",
    model_label: `Azure OpenAI · ${config.deployment}`,
    sub_model_label: config.subagentDeployment,
    note: "デモは信頼性重視の決定論抽出。本番は同一スキーマ・同一プロンプトでAzure OpenAIが抽出します。",
    inputs: buildAiInputs(data),
  };
}

// loadSampleData() の newsEvents / supplierNotices 先頭要素を、データ契約の形へ変換する。
// 配列が空・未定義でも壊れないようガードする。
function buildAiInputs(data = {}) {
  const inputs = [];
  const news = Array.isArray(data.newsEvents) ? data.newsEvents[0] : null;
  const notice = Array.isArray(data.supplierNotices) ? data.supplierNotices[0] : null;

  if (news) {
    inputs.push({
      type: "news",
      kind: "news",
      id: news.id ?? null,
      source: news.source ?? null,
      published_at: news.published_at ?? null,
      headline: news.headline ?? null,
      summary: news.summary ?? null,
    });
  }

  if (notice) {
    inputs.push({
      type: "supplier_notice",
      kind: "supplier",
      id: notice.id ?? null,
      supplier: notice.supplier ?? null,
      received_at: notice.received_at ?? null,
      subject: notice.subject ?? null,
      body: notice.body ?? null,
    });
  }

  return inputs;
}
