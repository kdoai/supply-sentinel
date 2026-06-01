import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("dashboard frames the product as early warning plus scenario decision support", async () => {
  const html = await read("../web/index.html");
  assert.match(html, /AI Early Warning & Scenario Decision Support/);
  assert.match(html, /予兆検知/);
  assert.match(html, /シナリオ化/);
  assert.match(html, /製品影響・優先順位/);
  assert.match(html, /打ち手・承認/);
  assert.match(html, /今日の判断キュー/);
  assert.match(html, /判断キューと製品判断フロー/);
  assert.match(html, /decision-lane-panel/);
  assert.match(html, /guided-workflow-dashboard/);
  assert.match(html, /guided-workflow-scenario/);
  assert.match(html, /guided-workflow-analysis/);
  assert.match(html, /guided-workflow-response/);
  assert.match(html, /decision-home/);
  assert.match(html, /signal-decision-flow/);
  assert.match(html, /generated-scenario/);
  assert.match(html, /company-policy-panel/);
  assert.doesNotMatch(html, /id="sourcing-mix"/);
});

test("guided workflow makes the next user action explicit", async () => {
  const app = await read("../web/js/app.js");
  assert.match(app, /WORKFLOW_STEPS/);
  assert.match(app, /予兆を確認/);
  assert.match(app, /シナリオを採用/);
  assert.match(app, /製品影響を確認/);
  assert.match(app, /打ち手を承認/);
  assert.match(app, /Briefを出力/);
  assert.match(app, /data-workflow-action/);
  assert.match(app, /renderGuidedWorkflow/);
});

test("panel rendering includes scenario agent, company policy, and demo evidence disclosure", async () => {
  const panels = await read("../web/js/panels.js");
  assert.match(panels, /renderDecisionHome/);
  assert.match(panels, /What needs your decision now\?/);
  assert.match(panels, /Scenario Agent/);
  assert.match(panels, /Demo Manufacturing SCM Policy/);
  assert.match(panels, /demo_scenario/);
  assert.match(panels, /リアルタイムWeb取得ではありません/);
  assert.match(panels, /AI市場監視から生成|デモ用シナリオ根拠から生成/);
});

test("decision output keeps preparation, monitoring, and human approval explicit", async () => {
  const decisions = await read("../web/js/decisions.js");
  assert.match(decisions, /事前準備/);
  assert.match(decisions, /継続監視/);
  assert.match(decisions, /代替材承認プロセス開始/);
  assert.match(decisions, /AIは市場予兆の抽出、シナリオ化、影響説明、打ち手起案まで/);
});
