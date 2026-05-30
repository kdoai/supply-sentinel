# Source Code Plan

This directory is reserved for implementation.

Recommended minimal modules:

```text
src/
+-- function_app/
|   +-- timerTrigger.mjs
+-- supply_sentinel/
|   +-- ingestion.mjs
|   +-- riskExtraction.mjs
|   +-- impactEngine.mjs
|   +-- scoring.mjs
|   +-- alertWriter.mjs
|   +-- reportWriter.mjs
|   +-- dashboardWriter.mjs
|   +-- stateStore.mjs
|   +-- workflow.mjs
+-- run-demo.mjs
```

## Suggested Build Order

1. `ingestion.mjs`: load sample JSON/CSV.
2. `impactEngine.mjs`: match material to BOM, inventory, orders, alternatives.
3. `scoring.mjs`: calculate transparent risk score.
4. `alertWriter.mjs`: generate Teams-style markdown.
5. `reportWriter.mjs`: generate management report markdown.
6. `riskExtraction.mjs`: deterministic demo extraction now, Azure OpenAI later.
7. `timerTrigger.mjs`: run workflow from Azure Functions.

## MVP Rule

Keep the first implementation deterministic. Add live AI calls after the impact engine works.
