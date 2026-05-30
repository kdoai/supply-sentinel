# Implementation Plan

## Guiding Principle

Build the smallest end-to-end path that demonstrates real business value.

Do not build a broad platform. Build a sharp demo workflow.

## Phase 0: Documentation And Design

Deliverables:

- Project summary
- Requirements
- Architecture
- Business workflow
- Demo script
- Sample data design

Success criteria:

- Team can explain the product in one sentence.
- MVP scope is fixed.
- Out-of-scope items are explicit.

## Phase 1: Local MVP

Deliverables:

- Sample external events
- Sample supplier notice
- Sample inventory/BOM/order/alternative data
- Risk extraction prompt
- Deterministic impact calculation
- Markdown alert output
- Markdown management report output

Success criteria:

- One local command can generate the full demo output.
- Output includes risk score, impacted products, customers, plants, evidence, and actions.

Current implementation:

- Node.js local MVP is implemented with no external packages.
- Run with `node src\run-demo.mjs`.
- Tests run with `npm.cmd test` on Windows PowerShell.
- Outputs are generated under `outputs/latest/`.

## Phase 2: Azure Function

Deliverables:

- Timer-triggered Azure Function
- Configuration for Azure OpenAI endpoint
- Local fallback mode

Success criteria:

- Function can run manually and on schedule.
- Demo remains reliable even if external network data is unavailable.

## Phase 3: Teams Notification

Deliverables:

- Teams webhook or Power Automate flow
- Alert payload template

Success criteria:

- High-risk event posts a concise alert to Teams.

## Phase 4: State Persistence

Deliverables:

- Cosmos DB container or local JSON fallback
- Alert status model
- Unresolved alert re-evaluation logic

Success criteria:

- Previous alerts can be referenced in the next run.
- Duplicate alerts are avoided or marked as updates.

## Phase 5: Demo Polish

Deliverables:

- Final demo script
- Sample report
- Architecture slide
- Judging message

Success criteria:

- The full story can be shown in 5 minutes.
- The team can answer why this is Agentic AI and why it is practical.

## Suggested File Ownership

| Area | Owner Type |
|---|---|
| Data samples | Business/consulting member |
| Impact engine | Backend member |
| AI prompts | AI/LLM member |
| Azure Functions | Cloud member |
| Teams/report output | Full-stack member |
| Demo story | Presenter/consulting member |

## Minimal Build Order

1. Create sample data.
2. Implement impact calculation without AI.
3. Add AI extraction for supplier/news text.
4. Generate alert and report.
5. Wrap in Azure Function.
6. Add Teams notification.

This order protects the demo. If the AI part is unstable, deterministic sample extraction can still show the business value.

## Demo Reliability Strategy

Prepare two modes:

- Live mode: calls Azure OpenAI.
- Safe demo mode: uses pre-extracted JSON.

The demo should never depend entirely on a live external website or unstable API.

## Cost Control

- Use small sample files.
- Minimize AI calls.
- Cache extracted risk events.
- Avoid long-running services.
- Prefer Azure Functions consumption model.
- Use Cosmos DB only if needed for state.

## Definition Of Done

The MVP is done when a scheduled or manual run can produce:

- Structured risk event
- Impact assessment
- Risk score
- Recommended actions
- Teams alert text
- Management report
