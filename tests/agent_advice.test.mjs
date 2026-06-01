// Tests for the secure "AI consult" backend core (agentAdvice).
//
// CI has no AZURE_OPENAI_* credentials, so azureOpenAiConfigured() is false and
// the deterministic offline fallback path always runs here. No network is hit.

import test from "node:test";
import assert from "node:assert/strict";
import { agentAdvice, agentAdviceHandler } from "../src/function_app/httpAgentAdvice.mjs";

const SAMPLE_CONTEXT = {
  material: "naphtha",
  risk_score: 82,
  affected_supply_ratio: 65,
  spend_at_risk_usd: 7_800_000,
  inventory_days_min: 5,
  impacted_products: ["樹脂A", "溶剤B", "コーティングC"],
  impacted_customers: ["自動車部品A社", "包装材B社", "化学品C社"],
};

test("returns the full structured shape with 3 reasoning_steps (fallback)", async () => {
  const result = await agentAdvice({
    question: "ナフサの供給リスクへの初動対応を教えて",
    context: SAMPLE_CONTEXT,
  });

  // Top-level shape.
  assert.equal(typeof result.answer, "string");
  assert.ok(result.answer.length > 0);
  assert.ok(Array.isArray(result.evidence));
  assert.ok(Array.isArray(result.recommended_actions));
  assert.ok(Array.isArray(result.human_decision_required));

  // reasoning_steps: exactly the 3 named agents, in order, each with a result.
  assert.ok(Array.isArray(result.reasoning_steps));
  assert.equal(result.reasoning_steps.length, 3);
  assert.deepEqual(
    result.reasoning_steps.map((s) => s.agent),
    ["Risk Scout", "Impact Mapper", "Response Planner"],
  );
  for (const step of result.reasoning_steps) {
    assert.equal(typeof step.result, "string");
    assert.ok(step.result.length > 0);
  }

  // meta: this is the offline fallback path.
  assert.equal(result.meta.fallback, true);
  assert.equal(result.meta.run_mode, "demo");
  assert.equal(typeof result.meta.model, "string");
});

test("empty question is rejected with statusCode 400", async () => {
  await assert.rejects(
    () => agentAdvice({ question: "   ", context: {} }),
    (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    },
  );
});

test("a >1000-char question is rejected with statusCode 400", async () => {
  const longQuestion = "あ".repeat(1001);
  await assert.rejects(
    () => agentAdvice({ question: longQuestion }),
    (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    },
  );
});

test("an oversized context is rejected with statusCode 400", async () => {
  // JSON.stringify of this context exceeds the 6000-char cap.
  const bigContext = { blob: "x".repeat(6001) };
  await assert.rejects(
    () => agentAdvice({ question: "ok question", context: bigContext }),
    (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    },
  );
});

test("recommended_actions and human_decision_required are arrays; reflect approval_required", async () => {
  const approvals = ["発注内容の変更", "サプライヤ切替"];
  const result = await agentAdvice({
    question: "承認が必要な事項は?",
    context: { ...SAMPLE_CONTEXT, approval_required: approvals },
  });

  assert.ok(Array.isArray(result.recommended_actions));
  assert.ok(result.recommended_actions.length > 0);

  assert.ok(Array.isArray(result.human_decision_required));
  // When context.approval_required is provided, it is reflected directly.
  assert.deepEqual(result.human_decision_required, approvals);
});

test("works with no context at all (question only)", async () => {
  const result = await agentAdvice({ question: "供給リスクの概況は?" });
  assert.equal(result.reasoning_steps.length, 3);
  assert.equal(result.meta.fallback, true);
  assert.ok(Array.isArray(result.human_decision_required));
  // Safe defaults when approval_required is absent.
  assert.ok(result.human_decision_required.length > 0);
});

test("the deterministic fallback varies by question intent (not a fixed value)", async () => {
  const ask = (question) => agentAdvice({ question, context: SAMPLE_CONTEXT });
  const [evidence, alternatives, customer, inventory] = await Promise.all([
    ask("なぜこの判断? 根拠を見せて"),
    ask("代替調達への切替は?"),
    ask("顧客への通知文面の要点は?"),
    ask("在庫が尽きるまでに何をすべき?"),
  ]);

  // All are fallback (no Azure creds in CI), but the answers must differ.
  for (const r of [evidence, alternatives, customer, inventory]) {
    assert.equal(r.meta.fallback, true);
  }
  const answers = new Set([evidence.answer, alternatives.answer, customer.answer, inventory.answer]);
  assert.equal(answers.size, 4, "each intent should yield a distinct answer");

  // The framing matches the asked intent.
  assert.match(evidence.answer, /根拠/);
  assert.match(customer.answer, /通知|顧客/);
  assert.match(inventory.answer, /在庫/);
});

test("HTTP handler rate-limits repeated anonymous advice calls", async () => {
  const previous = process.env.AGENT_ADVICE_RATE_LIMIT_PER_MINUTE;
  process.env.AGENT_ADVICE_RATE_LIMIT_PER_MINUTE = "1";
  const ip = `203.0.113.${Math.floor(Math.random() * 200)}`;
  const request = () => ({
    method: "POST",
    headers: new Map([["x-forwarded-for", ip]]),
    json: async () => ({ question: "初動対応は?", context: SAMPLE_CONTEXT }),
  });

  const first = await agentAdviceHandler(request(), {});
  const second = await agentAdviceHandler(request(), {});

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.match(second.body, /rate_limited/);
  if (previous === undefined) delete process.env.AGENT_ADVICE_RATE_LIMIT_PER_MINUTE;
  else process.env.AGENT_ADVICE_RATE_LIMIT_PER_MINUTE = previous;
});
