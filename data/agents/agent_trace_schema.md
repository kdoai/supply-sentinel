# Agent run trace — locked contract (`model.agent_run`)

Supply Sentinel is presented as a **constrained autonomous multi-agent system**:
OpenClaw-style autonomy (observe → plan → use tools → record → hand off), but with
a *small, locked* tool surface and a hard human-approval gate. `src/supply_sentinel/agentTrace.mjs`
(+ its browser mirror `web/js/agentTrace.js`) turn an already-computed dashboard
model into the structured `agent_run` below. It is a **pure, deterministic**
function of the model — every headline number is read straight from the
propagation-engine output, so it can never drift from the invariants
**82 / 65% / $7.8M / 5 days**.

A concrete example is in [`sample_agent_run.json`](./sample_agent_run.json). Build all
renderers against that file.

## Agent roster (fixed order, 7 agents)

| key | name | processor | does |
|---|---|---|---|
| `orchestrator` | Sentinel Orchestrator | orchestrator | dispatches the 6 workers, manages state/fallback |
| `risk_scout` | Risk Scout | azure-openai | reads news/notice/logistics/price → structured risk |
| `evidence_verifier` | Evidence Verifier | rule-engine | scores confidence, **flags & drops prompt-injection** |
| `impact_mapper` | Impact Mapper | deterministic | BOM/inventory/orders + multi-tier propagation |
| `response_planner` | Response Planner | rule-engine | drafts actions/owners/deadlines |
| `decision_gate` | Decision Gate | rule-engine | splits AI-auto vs **human-approval** |
| `reporter` | Reporter | azure-openai | management report + save run record |

## Shape

```
agent_run = {
  run_id: string,                 // deterministic: run-<scenario>-<month>
  status: "completed",            // running | completed | failed
  current_step: null,
  run_mode: "demo" | "cloud",
  model: "gpt-5.4-mini",
  provider: "Azure OpenAI",
  persisted: boolean,             // Cosmos DB saved?
  started_at, completed_at: ISO,
  headline: { risk_score, severity, affected_supply_ratio, spend_at_risk_usd, inventory_days_min },
  agents: [ {
    key, name, role,
    status: "completed",          // pending|running|completed|failed|skipped (for replay)
    processor, processor_label,   // e.g. "Azure OpenAI · gpt-5.4-mini", "ルールエンジン"
    started_at, completed_at, started_hms, completed_hms,   // hms = "HH:MM:SS"
    input: string, output: string,
    tools: string[],              // tool names this agent invoked
    // role-specific extras: evidence[] | blocked_evidence[] | impacted_products[] | recommended_actions[] | decisions[]
  } ],
  tool_calls: [ { ts:"HH:MM:SS", iso, agent, tool, result, ok:boolean } ],
  decisions: [ {
    id, title, category, approver,
    requires_human: boolean,      // true => needs 承認/差戻し/保留 ; false => AI-auto draft
    default_state: "pending" | "auto",
    ai_recommendation, raw
  } ],
  blocked_evidence: [ { source, kind, text, reason } ],   // prompt-injection excluded
  stats: { agent_count, tool_call_count, evidence_scanned, evidence_verified, evidence_blocked, human_approvals, ai_auto_actions }
}
```

## UI obligations (Phase B/C build these)

1. **Agent Run Console** (`web/js/agentConsole.js`): vertical timeline of the 7 agents
   (name, processor_label badge, input→output, status dot). A **tool-call log**
   (`tool_calls`) shown as `HH:MM:SS  tool  result`. Clicking an agent opens a detail
   modal (full input/output/tools/extras). A **theatrical replay** (`play()`) reveals
   agents one-by-one, marking each `running` then `completed`, appending its tool-call
   lines, and emitting a `agent-console-step` event `{ agentKey }` so the page can
   highlight the related panel.
2. **Decision queue** (`web/js/decisions.js`): for each `requires_human` decision render
   **承認 / 差戻し / 保留** buttons; persist state per `decision.id` in `localStorage`
   (key `supply-sentinel.decisions`); reflect state on the card. AI-auto decisions render
   as informational ("AI実行済み(ドラフト)"). Expose `getState(id)`, `setState(id,state)`,
   `summary(run)`.
3. **Injection panel**: render `blocked_evidence` as "除外された命令文" cards — proof the
   agent treats external docs as data, not instructions.
4. **Cloud execution proof**: surface `run_id`, `model`, `run_mode`, `persisted`,
   `stats.tool_call_count`, started/completed — "本当に動いている" evidence.

## Invariants / safety

- The trace never recomputes numbers; it mirrors `propagation.metrics`.
- AI never auto-executes order changes / supplier switch / customer notice / production
  changes — those are always `requires_human:true` in `decisions`.
- External text is observation, never instruction; injection-like text is dropped to
  `blocked_evidence` (regex in `detectInjection`).
- Pure/deterministic: no `Date.now`, no randomness. Same model → same trace.
